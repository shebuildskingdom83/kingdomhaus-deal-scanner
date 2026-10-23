import type { IncomingMessage } from "node:http";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
// Admission claims are trusted only after Firebase Admin verifies the complete ID token.
export type VerifiedIdentity = { uid: string; kingdomhausPilot?: unknown };
export type TokenVerifier = (token: string) => Promise<VerifiedIdentity>;
export function requireFounderPaidAccess(uid: string, founder: string | undefined) {
  if (!founder || uid !== founder) throw new ApiError(403, "Paid provider operations are available to the founder only.");
}
const invalidTokens = new Set(["auth/argument-error", "auth/invalid-argument", "auth/invalid-id-token", "auth/id-token-expired", "auth/id-token-revoked", "auth/user-disabled", "auth/user-not-found"]);
export async function authorize(header: string | undefined, founder: string | undefined, verify: TokenVerifier) {
  const token = /^Bearer ([^\s]+)$/.exec(header ?? "")?.[1];
  if (!token || token.length > 16000) throw new ApiError(401, "Sign in to continue. Your unsaved work is unchanged.");
  if (!founder || !/^[A-Za-z0-9_-]{1,128}$/.test(founder) || founder === "FOUNDER_UID_NOT_CONFIGURED") throw new ApiError(503, "API authentication is not configured.");
  let identity: VerifiedIdentity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { identity = await Promise.race([verify(token), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Verification timed out")), 8000);
  })]); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    throw new ApiError(invalidTokens.has(code) ? 401 : 503, invalidTokens.has(code) ? "Sign in again to continue. Your unsaved work is unchanged." : "Authentication verification is unavailable. Please try again later.");
  } finally { clearTimeout(timer); }
  if (typeof identity.uid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid)) throw new ApiError(401, "Sign in again to continue.");
  if (identity.uid !== founder && identity.kingdomhausPilot !== true) throw new ApiError(403, "This account does not have API access.");
  return identity.uid;
}

export function readJson(req: IncomingMessage, maxBytes = 100_000, timeoutMs = 15_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0, settled = false;
    const chunks: Buffer[] = [];
    const finish = (error?: ApiError, value?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      req.off("data", data); req.off("end", end); req.off("error", failed); req.off("aborted", failed);
      if (error) {
        // An oversized/stalled client may disconnect while the rejected body drains.
        req.once("error", () => {});
        req.resume(); reject(error);
      } else resolve(value);
    };
    const timer = setTimeout(() => finish(new ApiError(408, "Request timed out.")), timeoutMs);
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) finish(new ApiError(413, "Request body is too large."));
      else chunks.push(chunk);
    };
    const end = () => {
      try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { finish(new ApiError(400, "Request body must be valid JSON.")); }
    };
    const failed = () => finish(new ApiError(400, "Request could not be read."));
    req.on("data", data); req.on("end", end); req.on("error", failed); req.on("aborted", failed);
  });
}

/** Single-process limits. Paid quotas are explicit configuration, never inferred from credentials. */
export class UsageGuard {
  private active = 0;
  private used = 0;
  private window = { at: 0, count: 0 };
  constructor(private readonly maximum: number | null, private readonly concurrency = 2, private readonly rate = 10, private readonly now = Date.now) {}
  acquire(chargeable = true) {
    if (chargeable && this.maximum === null) throw new ApiError(503, "Paid usage limits require approved server configuration.");
    if (this.active >= this.concurrency) throw new ApiError(429, "Too many operations are active. Please try again later.");
    const now = this.now();
    if (now - this.window.at >= 60_000) this.window = { at: now, count: 0 };
    if (this.window.count >= this.rate || (chargeable && this.used >= this.maximum!)) throw new ApiError(429, "The configured usage limit has been reached.");
    this.window.count++; this.active++; if (chargeable) this.used++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
}
export function positiveInteger(value: string | undefined, max = 10000): number | null {
  return value && /^[1-9]\d*$/.test(value) && Number(value) <= max ? Number(value) : null;
}
