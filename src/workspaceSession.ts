import { isFounderAccount } from "./cloudPersistence";

export type WorkspaceUser = { uid: string; getIdTokenResult(): Promise<{ claims: Record<string, unknown> }> };
export async function workspaceAdmitted(user: WorkspaceUser, founder: string | undefined) {
  if (!founder) return false;
  if (isFounderAccount(user.uid, founder)) return true;
  if (typeof user.getIdTokenResult !== "function") return false;
  return (await user.getIdTokenResult()).claims.kingdomhausPilot === true;
}
export class WorkspaceChangedError extends Error {
  constructor() { super("The account or workspace changed. Start again in the current workspace."); }
}
let sessionEpoch = 0;
/** An in-memory capability bound to this particular SDK user/session, never a caller-supplied UID. */
export class WorkspaceSession {
  readonly epoch = ++sessionEpoch;
  private controller = new AbortController();
  constructor(readonly uid: string, readonly founder: boolean, private current: () => boolean) {}
  get signal() { return this.controller.signal; }
  get active() { return !this.signal.aborted && this.current(); }
  assert() {
    if (!this.active) { this.close(); throw new WorkspaceChangedError(); }
  }
  close() { this.controller.abort(); }
}
