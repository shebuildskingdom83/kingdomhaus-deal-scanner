// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoveryControls } from "../src/useAcquisitionRecovery";
import { syntheticLibrary } from "./syntheticSavedLibrary";
import { createCashFlowAssumptions } from "../src/acquisitionCashFlow";

const state = vi.hoisted(() => ({ user: { uid: "synthetic-founder" } as { uid: string } | null,
  configurationError: null as string | null, authFailure: null as unknown,
  changeUser: null as ((user: { uid: string } | null) => void) | null,
  recovery: null as unknown as RecoveryControls, signOut: vi.fn(async () => {}), home: vi.fn(), repository: vi.fn(() => ({})) }));
vi.mock("../src/websiteNavigation", () => ({ returnToHomepage: state.home }));
vi.mock("firebase/auth", () => ({
  onIdTokenChanged: (_auth: unknown, callback: (user: typeof state.user) => void, error: (failure: unknown) => void) => {
    state.changeUser = user => { state.user = user; callback(user); };
    let live = true;
    queueMicrotask(() => { if (live) { if (state.authFailure) error(state.authFailure); else callback(state.user); } });
    return () => { live = false; state.changeUser = null; };
  },
  signOut: state.signOut
}));
vi.mock("../src/firebaseClient", () => ({ cloudClient: () => ({ auth: { get currentUser() { return state.user; } }, repository: state.repository }),
  cloudConfigurationError: () => state.configurationError, founderUid: "synthetic-founder" }));
vi.mock("../src/useCloudAcquisitionRecovery", () => ({ useCloudAcquisitionRecovery: () => state.recovery }));
import CloudApp from "../src/CloudApp";

function controls(report = false): RecoveryControls {
  const record = syntheticLibrary(1)[0];
  const form = Object.fromEntries(Object.keys(record.state.form).map(key => [key, ""])) as typeof record.state.form;
  return { work: report ? record.state : { scan: null, form, cashFlow: createCashFlowAssumptions() },
    records: [record], active: report ? record : null, generation: 0, dirty: false, hasWork: report, savePhase: "idle",
    storageError: "", actionError: "", notice: "", confirmation: null,
    setWork: vi.fn(), save: vi.fn(), open: vi.fn(), newScan: vi.fn(), rename: vi.fn(), remove: vi.fn(), importText: vi.fn(),
    exportCurrent: vi.fn(), exportRecord: vi.fn(), exportSavedCsv: vi.fn(), exportStoredRecovery: vi.fn(), reportError: vi.fn(),
    cancelConfirmation: vi.fn(), acceptConfirmation: vi.fn(), cloud: { status: "Saved", ready: true, busy: false, retry: vi.fn() } };
}
beforeEach(() => { state.user = { uid: "synthetic-founder" }; state.configurationError = null; state.authFailure = null; state.recovery = controls(); state.repository.mockClear(); state.signOut.mockReset(); state.home.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function loaded() { render(<CloudApp />); await screen.findByRole("button", { name: "Sign out" }); }

describe("cloud workspace presentation without persistence changes", () => {
  it("shows only neutral status during session restoration, before checking founder access", async () => {
    render(<CloudApp />);
    expect(screen.getByRole("status").textContent).toBe("Checking sign-in...");
    expect(screen.queryByRole("heading", { name: "Sign in to Deal Scanner" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Acquisition Portfolio" })).toBeNull();
    expect(state.repository).not.toHaveBeenCalled();
    await screen.findByRole("heading", { name: "Acquisition Portfolio" });
  });
  it.each([null, "unauthorized-synthetic", "synthetic-founder"])("keeps the same-tab Home link across access states (%s)", async uid => {
    state.user = uid ? { uid } : null;
    render(<CloudApp />);
    if (uid) await screen.findByRole("button", { name: "Sign out" });
    else await waitFor(() => expect(state.home).toHaveBeenCalledTimes(1));
    const link = within(screen.getByRole("banner", { name: "Application header" })).getByRole("link", { name: "KingdomHaus Home" });
    expect(link.getAttribute("href")).toBe("/");
    expect(link.getAttribute("target")).toBeNull();
    if (uid !== "synthetic-founder") expect(state.repository).not.toHaveBeenCalled();
  });
  it("redirects signed-out direct access only after Firebase restores the session", async () => {
    state.user = null;
    render(<CloudApp />);
    expect(screen.getByRole("status").textContent).toBe("Checking sign-in...");
    expect(state.home).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Acquisition Portfolio" })).toBeNull();
    await waitFor(() => expect(state.home).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Sign in from the homepage");
    expect(state.repository).not.toHaveBeenCalled();
  });
  it("closes the current workspace before redirecting when the account signs out elsewhere", async () => {
    await loaded();
    await screen.findByRole("heading", { name: "Acquisition Portfolio" });
    act(() => state.changeUser?.(null));
    expect(screen.queryByRole("heading", { name: "Acquisition Portfolio" })).toBeNull();
    await waitFor(() => expect(state.home).toHaveBeenCalledTimes(1));
  });
  it("returns to the landing page after auth-restoration failure without loading acquisitions", async () => {
    state.user = null; state.authFailure = { code: "auth/network-request-failed" };
    render(<CloudApp />);
    await waitFor(() => expect(state.home).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("heading", { name: "Acquisition Portfolio" })).toBeNull();
    expect(state.repository).not.toHaveBeenCalled();
  });
  it("preserves configuration errors and keeps sign-in and acquisitions locked", () => {
    state.configurationError = "Synthetic Firebase configuration is missing.";
    render(<CloudApp />);
    expect(screen.getByRole("status").textContent).toBe(state.configurationError);
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).toBeNull();
    expect(state.repository).not.toHaveBeenCalled();
  });
  it.each([false, true])("renders one branded header and one complete recovery interface (report=%s)", async report => {
    state.recovery = controls(report); await loaded();
    expect(screen.getByRole("heading", { name: "Acquisition Portfolio" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Return to Workspace" })).toBeNull();
    expect(state.recovery.open).not.toHaveBeenCalled();
    expect(state.recovery.newScan).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^View Analysis/ })).toBeTruthy();
    const header = screen.getByRole("banner", { name: "Application header" });
    expect(within(header).getByRole("heading", { level: 1, name: "Deal Scanner" })).toBeTruthy();
    expect(within(header).queryByText("KingdomHaus Intelligence")).toBeNull();
    expect(within(header).getByRole("img", { name: "KingdomHaus logo" }).getAttribute("src")).toBe("/kingdomhaus-logo.webp");
    expect(within(header).getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Sign out" }).classList.contains("ghost-button")).toBe(true);
    expect(screen.queryByText("KingdomHaus cloud workspace", { exact: true })).toBeNull();
    expect(screen.queryByRole("region", { name: "Cloud account" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload cloud workspace" })).toBeNull();
    expect(document.querySelectorAll(".acquisition-recovery")).toHaveLength(1);
    expect(document.querySelectorAll(".saved-acquisitions")).toHaveLength(1);
    expect(document.querySelectorAll(".saved-acquisition-search")).toHaveLength(1);
    expect(document.querySelectorAll(".backup-management")).toHaveLength(1);
    expect(document.querySelectorAll(".saved-acquisitions button").length).toBeGreaterThan(0);
  });
  it("keeps portfolio export and backup controls in the single recovery interface", async () => {
    await loaded();
    const saved = document.querySelector(".saved-acquisitions") as HTMLDetailsElement; saved.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Export Portfolio as CSV" }));
    expect(state.recovery.exportSavedCsv).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[aria-label="Search saved acquisitions by business name"]')).toHaveLength(1);
    expect(document.querySelectorAll('[aria-label="Import acquisition JSON backup"]')).toHaveLength(1);
  });
  it("preserves confirmation before sign-out and does not sign out when cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await loaded(); fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(state.signOut).not.toHaveBeenCalled();
    expect(state.home).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(state.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(state.home).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Unsaved edits"));
  });
  it("returns home only after sign-out succeeds and retains a retry when sign-out fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    state.signOut.mockRejectedValueOnce(new Error("Synthetic failure"));
    await loaded(); fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Sign-out failed. Please try again.");
    expect(state.home).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(state.home).toHaveBeenCalledTimes(1));
  });
  it.each([true, false])("exposes confirmed reload only during save/recovery errors (ready=%s)", async ready => {
    state.recovery.cloud = { ...state.recovery.cloud!, status: "Error", ready };
    state.recovery.storageError = "Synthetic revision conflict";
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await loaded(); const header = screen.getByRole("banner", { name: "Application header" });
    const reload = within(header).getByRole("button", { name: "Reload cloud workspace" });
    const initial = state.repository.mock.calls.length;
    fireEvent.click(reload); expect(state.repository).toHaveBeenCalledTimes(initial);
    fireEvent.click(reload); await waitFor(() => expect(state.repository.mock.calls.length).toBeGreaterThan(initial));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("discard in-memory edits"));
    expect(screen.getAllByRole("button", { name: "Reload cloud workspace" })).toHaveLength(1);
  });
  it("keeps an unapproved account outside the workspace without showing another sign-in action", async () => {
    state.user = { uid: "unauthorized-synthetic" };
    render(<CloudApp />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).toBeNull();
    expect(state.repository).not.toHaveBeenCalled();
    expect(document.querySelector(".acquisition-recovery")).toBeNull();
  });
});
