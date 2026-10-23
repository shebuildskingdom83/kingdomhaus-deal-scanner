import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceChangedError, WorkspaceSession, workspaceAdmitted } from "../src/workspaceSession";
const state = vi.hoisted(() => ({ user: null as null | { uid: string; getIdToken: () => Promise<string> } }));
vi.mock("../src/firebaseClient", () => ({ cloudClient: () => ({ auth: { get currentUser() { return state.user; } } }) }));
import { workspaceApi } from "../src/authenticatedApi";
afterEach(() => { vi.unstubAllGlobals(); state.user = null; });

describe("account-bound workspace sessions", () => {
  it("admits the unchanged founder or exact pilot claim, and denies other claims", async () => {
    for (const claim of [undefined, false, "true", 1]) {
      expect(await workspaceAdmitted({ uid: "pilot", getIdTokenResult: async () => ({ claims: { kingdomhausPilot: claim } }) }, "founder")).toBe(false);
    }
    expect(await workspaceAdmitted({ uid: "pilot", getIdTokenResult: async () => ({ claims: { kingdomhausPilot: true } }) }, "founder")).toBe(true);
    const token = vi.fn();
    expect(await workspaceAdmitted({ uid: "founder", getIdTokenResult: token }, "founder")).toBe(true);
    expect(token).not.toHaveBeenCalled();
  });
  it("never sends previous-account content with a new account's token during token refresh", async () => {
    let finish!: (token: string) => void;
    const user = { uid: "synthetic-A", getIdToken: vi.fn(() => new Promise<string>(done => { finish = done; })) };
    state.user = user;
    const session = new WorkspaceSession(user.uid, false, () => state.user === user);
    const transport = vi.fn(); vi.stubGlobal("fetch", transport);
    const pending = workspaceApi(session)("/api/scan", { method: "POST", body: "synthetic-A-content" });
    const rejected = expect(pending).rejects.toBeInstanceOf(WorkspaceChangedError);
    await vi.waitFor(() => expect(user.getIdToken).toHaveBeenCalledTimes(1));
    const replacement = { uid: "synthetic-B", getIdToken: vi.fn(async () => "synthetic-B-token") };
    state.user = replacement; finish("synthetic-A-token"); await rejected;
    expect(transport).not.toHaveBeenCalled(); expect(replacement.getIdToken).not.toHaveBeenCalled();
    expect(session.signal.aborted).toBe(true);
  });
  it("aborts an in-flight request and rejects its result after switching accounts", async () => {
    const user = { uid: "synthetic-A", getIdToken: async () => "synthetic-A-token" }; state.user = user;
    const session = new WorkspaceSession(user.uid, false, () => state.user === user);
    let finish!: (response: Response) => void;
    const transport = vi.fn(() => new Promise<Response>(done => { finish = done; })); vi.stubGlobal("fetch", transport);
    const pending = workspaceApi(session)("/api/scan", { method: "POST", body: "synthetic-A-content" });
    const rejected = expect(pending).rejects.toBeInstanceOf(WorkspaceChangedError);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    state.user = null; session.close(); finish(new Response("{}")); await rejected;
    expect((transport.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
  });
  it("does not resurrect an old session when the same UID signs in again", () => {
    let current = {}; const original = current;
    const session = new WorkspaceSession("synthetic-A", true, () => current === original);
    current = {}; expect(() => session.assert()).toThrow(WorkspaceChangedError);
    current = original; expect(() => session.assert()).toThrow(WorkspaceChangedError);
  });
});
