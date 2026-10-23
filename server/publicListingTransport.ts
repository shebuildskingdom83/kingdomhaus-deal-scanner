import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { ApiError } from "./apiSecurity";

export function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  // Permit global unicast only; exclude transition, mapped, local and special-use ranges.
  const normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  const [first, second] = normalized.split(":").map(part => parseInt(part || "0", 16));
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && !(first === 0x3fff && second < 0x1000);
}
export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
const resolveDns: Resolver = host => lookup(host, { all: true, verbatim: true });
export async function resolvePublicUrl(value: string, resolve: Resolver = resolveDns) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(400, "Enter a valid public HTTPS listing URL."); }
  if (value.length > 2000 || url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new ApiError(400, "Use a public HTTPS URL without credentials or custom ports.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new ApiError(400, "Private network URLs are not supported.");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new ApiError(400, "Private or special network URLs are not supported.");
  return { url, address: addresses[0] };
}
export function pinnedLookup(address: { address: string; family: number }): LookupFunction {
  return (_host, options, callback) => {
    // Node may request all addresses. No DNS resolution is performed at connection time.
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
}
/** Keep original hostname for Host/TLS verification; connect only to the validated IP. No pooled sockets. */
export async function publicListingFetch(value: string, init: RequestInit = {}, resolve: Resolver = resolveDns): Promise<Response> {
  const signal = AbortSignal.any([AbortSignal.timeout(12_000), ...(init.signal ? [init.signal] : [])]);
  signal.throwIfAborted();
  const resolved = await Promise.race([
    resolvePublicUrl(value, resolve),
    new Promise<never>((_, reject) => { signal.addEventListener("abort", () => reject(new ApiError(504, "Listing retrieval timed out.")), { once: true }); })
  ]);
  return new Promise((done, reject) => {
    const req = request(resolved.url, { method: "GET", agent: false, lookup: pinnedLookup(resolved.address),
      signal, headers: { Accept: "text/html,text/plain;q=0.9", "User-Agent": "KingdomHausDealScanner/1.0" } }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1_200_000) { res.destroy(); reject(new ApiError(502, "The listing page is too large.")); }
        else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        const status = res.statusCode ?? 502;
        done(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }));
      });
    });
    req.on("error", reject); req.end();
  });
}
