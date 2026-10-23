import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSession } from "../src/workspaceSession";
const sdk = vi.hoisted(() => ({ user: null as { uid: string } | null, construct: vi.fn() }));
vi.mock("firebase/app", () => ({ getApps: () => [], initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => {
  const auth = { get currentUser() { return sdk.user; } };
  return { browserPopupRedirectResolver: {}, browserSessionPersistence: {}, connectAuthEmulator: vi.fn(), getAuth: () => auth,
    initializeAuth: () => auth, GoogleAuthProvider: class {}, signInWithPopup: vi.fn() };
});
vi.mock("firebase/firestore", () => ({ connectFirestoreEmulator: vi.fn(), getFirestore: () => ({}), initializeFirestore: () => ({}), memoryLocalCache: () => ({}) }));
vi.mock("../src/firestoreAcquisitionRepository", () => ({ FirestoreAcquisitionRepository: class { constructor(...args: unknown[]) { sdk.construct(...args); } } }));
beforeEach(() => {
  vi.resetModules(); sdk.construct.mockClear(); sdk.user = { uid: "synthetic-founder" };
  for (const key of ["API_KEY", "PROJECT_ID", "AUTH_DOMAIN", "APP_ID"]) vi.stubEnv("VITE_FIREBASE_" + key, "synthetic-config");
  vi.stubEnv("VITE_FIREBASE_FOUNDER_UID", "synthetic-founder");
});
describe("private repository selection", () => {
  it.each(["synthetic-founder", "synthetic-pilot"])("binds repository paths to the authenticated UID (%s)", async uid => {
    sdk.user = { uid }; const original = sdk.user;
    const session = new WorkspaceSession(uid, uid === "synthetic-founder", () => sdk.user === original);
    const { cloudClient } = await import("../src/firebaseClient"); cloudClient().repository(session);
    expect(sdk.construct.mock.calls[0][1]).toBe(uid);
    const guard = sdk.construct.mock.calls[0][3] as () => void;
    expect(guard).not.toThrow(); sdk.user = { uid: "synthetic-other" }; expect(guard).toThrow();
  });
  it("keeps existing no-session migration tools founder-only and denies signed-out repository creation", async () => {
    const { cloudClient } = await import("../src/firebaseClient"); cloudClient().repository();
    sdk.user = { uid: "synthetic-pilot" }; expect(() => cloudClient().repository()).toThrow(/not authorized/);
    sdk.user = null; expect(() => cloudClient().repository()).toThrow(/not authorized/);
  });
});
