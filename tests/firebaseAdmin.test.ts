import { afterEach, describe, expect, it, vi } from "vitest";
const admin = vi.hoisted(() => ({ init: vi.fn(() => ({})), verify: vi.fn(async () => ({ uid: "synthetic-founder" })), credentials: vi.fn(() => ({})) }));
vi.mock("firebase-admin/app", () => ({ applicationDefault: admin.credentials, getApps: () => [], initializeApp: admin.init }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ verifyIdToken: admin.verify }) }));
import { firebaseTokenVerifier } from "../server/firebaseAdmin";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("server-only Firebase Admin adapter", () => {
  it("uses the explicit existing project, ADC and revocation checking", async () => {
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "");
    await firebaseTokenVerifier("synthetic-project")("fictional-token");
    expect(admin.init).toHaveBeenCalledWith({ projectId: "synthetic-project", credential: {} }, "kingdomhaus-api");
    expect(admin.verify).toHaveBeenCalledWith("fictional-token", true);
  });
  it("refuses missing project configuration or accidental emulator trust", async () => {
    await expect(firebaseTokenVerifier(undefined)("fictional")).rejects.toThrow();
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
    await expect(firebaseTokenVerifier("synthetic-project")("fictional")).rejects.toThrow();
    expect(admin.verify).not.toHaveBeenCalled();
  });
  it("preserves admission claims only from the Admin-verified token result", async () => {
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "");
    admin.verify.mockResolvedValueOnce(Object.assign({ uid: "synthetic-pilot" }, { kingdomhausPilot: true }));
    expect(await firebaseTokenVerifier("synthetic-project")("fictional-token")).toEqual({ uid: "synthetic-pilot", kingdomhausPilot: true });
    expect(admin.verify).toHaveBeenCalledWith("fictional-token", true);
  });
});
