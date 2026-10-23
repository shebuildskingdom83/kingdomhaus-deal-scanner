// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPuterDealClarityPoc } from "../src/puterPoc";
import { WorkspaceSession } from "../src/workspaceSession";
import { syntheticLibrary } from "./syntheticSavedLibrary";
afterEach(() => { delete window.puter; });
describe("Puter boundaries without any provider calls", () => {
  it("does not submit listing content if the account changes while Puter session status is pending", async () => {
    const session = new WorkspaceSession("synthetic-founder", true, () => true);
    let finish!: (value: boolean) => void;
    const signedIn = vi.fn(() => new Promise<boolean>(done => { finish = done; })), chat = vi.fn();
    window.puter = { auth: { isSignedIn: signedIn, signIn: vi.fn() }, ai: { chat } };
    const pending = runPuterDealClarityPoc(syntheticLibrary(1)[0].state.scan, () => session.assert());
    const rejected = expect(pending).rejects.toThrow(/account or workspace changed/);
    await vi.waitFor(() => expect(signedIn).toHaveBeenCalledTimes(1));
    session.close(); finish(true); await rejected; expect(chat).not.toHaveBeenCalled();
  });
  it("discards an already-started synthetic analysis result after sign-out", async () => {
    const session = new WorkspaceSession("synthetic-founder", true, () => true);
    let finish!: (value: unknown) => void;
    const chat = vi.fn(() => new Promise(done => { finish = done; }));
    window.puter = { auth: { isSignedIn: async () => true }, ai: { chat } };
    const pending = runPuterDealClarityPoc(syntheticLibrary(1)[0].state.scan, () => session.assert());
    const rejected = expect(pending).rejects.toThrow(/account or workspace changed/);
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    session.close(); finish("synthetic late response"); await rejected;
  });
});
