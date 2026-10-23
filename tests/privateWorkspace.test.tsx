// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcquisitionRecord, RecoveryDraft } from "../src/acquisitionRecord";
import { syntheticLibrary } from "./syntheticSavedLibrary";
import * as csv from "../src/csv";

type User = { uid: string; getIdToken: () => Promise<string>; getIdTokenResult: () => Promise<{ claims: Record<string, unknown> }> };
const state = vi.hoisted(() => ({ user: null as User | null, changed: null as null | ((user: User | null) => void),
  repository: vi.fn(), puter: vi.fn(), signOut: vi.fn(), home: vi.fn() }));
vi.mock("firebase/auth", () => ({ onIdTokenChanged: (_auth: unknown, callback: (user: User | null) => void) => {
  state.changed = callback; queueMicrotask(() => callback(state.user)); return () => { state.changed = null; };
}, signOut: state.signOut }));
vi.mock("../src/firebaseClient", () => ({ cloudClient: () => ({ auth: { get currentUser() { return state.user; } }, repository: state.repository }),
  founderUid: "synthetic-founder", cloudConfigurationError: () => null, cloudEmulator: false, cloudSignIn: vi.fn() }));
vi.mock("../src/websiteNavigation", () => ({ returnToHomepage: state.home }));
vi.mock("../src/puterPoc", () => ({ runPuterDealClarityPoc: state.puter, PuterResponseFormatError: class extends Error {} }));
import CloudApp from "../src/CloudApp";
import { WorkspaceSession } from "../src/workspaceSession";

const account = (uid: string, pilot = false): User => ({ uid, getIdToken: vi.fn(async () => "synthetic-token"),
  getIdTokenResult: vi.fn(async () => ({ claims: { kingdomhausPilot: pilot } })) });
const stores = new Map<string, { records: AcquisitionRecord[]; draft: RecoveryDraft | null; revision: number }>();
function store(uid: string) { if (!stores.has(uid)) stores.set(uid, { records: [], draft: null, revision: 0 }); return stores.get(uid)!; }
function switchAccount(user: User | null) { act(() => { state.user = user; state.changed?.(user); }); }
beforeEach(() => {
  vi.clearAllMocks(); stores.clear(); state.user = account("synthetic-founder");
  store(state.user.uid).records = syntheticLibrary(4);
  state.repository.mockImplementation((session: WorkspaceSession) => {
    session.assert(); const data = store(session.uid);
    return {
      list: async () => { session.assert(); return structuredClone(data.records); },
      loadDraft: async () => { session.assert(); return { revision: data.revision, value: structuredClone(data.draft) }; },
      saveDraft: async (draft: RecoveryDraft | null) => { session.assert(); data.draft = structuredClone(draft); return ++data.revision; },
      get: async (id: string) => { session.assert(); return structuredClone(data.records.find(record => record.id === id)!); },
      save: async (record: AcquisitionRecord) => { session.assert(); data.records = [...data.records.filter(item => item.id !== record.id), structuredClone(record)]; },
      remove: async (id: string) => { session.assert(); data.records = data.records.filter(item => item.id !== id); }
    };
  });
  state.signOut.mockImplementation(async () => { state.user = null; state.changed?.(null); });
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Unexpected synthetic network request"); }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("private workspace integration using synthetic SDK accounts and records", () => {
  it("preserves the founder's four-record portfolio and gives an approved pilot an empty private portfolio", async () => {
    render(<CloudApp />); await screen.findAllByText("Example Service Group 01");
    const founderSnapshot = structuredClone(store("synthetic-founder"));
    switchAccount(account("synthetic-pilot", true));
    await screen.findByRole("heading", { name: "Build your acquisition portfolio" });
    expect(screen.queryAllByText("Example Service Group 01")).toHaveLength(0);
    expect(state.repository.mock.calls.at(-1)?.[0].uid).toBe("synthetic-pilot");
    expect(store("synthetic-founder")).toEqual(founderSnapshot);
    expect(store("synthetic-pilot")).toEqual({ records: [], draft: null, revision: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("denies unapproved accounts and discards a delayed pilot-claim result after another account is selected", async () => {
    let finish!: (value: { claims: Record<string, unknown> }) => void;
    const pilot = account("synthetic-pilot"); pilot.getIdTokenResult = () => new Promise(done => { finish = done; });
    state.user = pilot; render(<CloudApp />);
    await waitFor(() => expect(state.changed).not.toBeNull());
    switchAccount(account("synthetic-unapproved"));
    await screen.findByText("This account doesn't have access to Deal Scanner.");
    await act(async () => { finish({ claims: { kingdomhausPilot: true } }); });
    expect(state.repository).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Acquisition Portfolio" })).toBeNull();
  });
  it("clears the visible portfolio immediately when sign-out starts, even before SDK completion", async () => {
    state.signOut.mockImplementationOnce(() => new Promise(() => {}));
    render(<CloudApp />); await screen.findAllByText("Example Service Group 01");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.queryAllByText("Example Service Group 01")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Acquisition Portfolio" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("workspace is closed");
    expect(state.repository.mock.calls[0][0].signal.aborted).toBe(true);
  });
  it("exports only the active pilot's records and does not retain founder exports in component state", async () => {
    const record = syntheticLibrary(1)[0]; record.name = "Pilot-only acquisition"; store("synthetic-pilot").records = [record];
    const download = vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
    render(<CloudApp />); await screen.findAllByText("Example Service Group 01");
    switchAccount(account("synthetic-pilot", true)); await screen.findAllByText("Pilot-only acquisition");
    fireEvent.click(screen.getByRole("button", { name: "Export Portfolio as CSV" }));
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][0]).toContain("Pilot-only acquisition");
    expect(download.mock.calls[0][0]).not.toContain("Example Service Group");
  });
  it("keeps Puter unavailable to pilots without invoking its SDK", async () => {
    const record = syntheticLibrary(1)[0]; state.user = account("synthetic-pilot", true);
    store(state.user.uid).draft = { recordId: null, recordRevision: null, state: record.state };
    render(<CloudApp />); fireEvent.click(await screen.findByRole("button", { name: /Continue Analysis/ }));
    const button = screen.getByRole("button", { name: /Analyze Deal/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); fireEvent.click(button);
    expect(screen.queryByRole("button", { name: "Confirm and analyze" })).toBeNull();
    expect(state.puter).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("discards founder Puter results after an account switch", async () => {
    const record = syntheticLibrary(1)[0]; store("synthetic-founder").draft = { recordId: null, recordRevision: null, state: record.state };
    let finish!: (value: unknown) => void; state.puter.mockImplementationOnce(() => new Promise(done => { finish = done; }));
    render(<CloudApp />); fireEvent.click(await screen.findByRole("button", { name: /Continue Analysis/ }));
    fireEvent.click(screen.getByRole("button", { name: /Analyze Deal/ })); fireEvent.click(screen.getByRole("button", { name: "Confirm and analyze" }));
    expect(state.puter).toHaveBeenCalledTimes(1);
    switchAccount(account("synthetic-pilot", true)); await screen.findByRole("heading", { name: "Build your acquisition portfolio" });
    await act(async () => { finish({ summary: { strategicFit: "Founder-private analysis" } }); });
    expect(screen.queryByText("Founder-private analysis")).toBeNull();
  });
  it("aborts scanning on account switch and discards the former account's delayed HTTP result", async () => {
    state.user = account("synthetic-pilot", true);
    let finish!: (response: Response) => void;
    const transport = vi.fn(() => new Promise<Response>(done => { finish = done; })); vi.stubGlobal("fetch", transport);
    render(<CloudApp />); fireEvent.click(await screen.findByRole("button", { name: "Analyze an Opportunity" }));
    await screen.findByRole("button", { name: "Scan business" });
    fireEvent.change(screen.getByLabelText("Listing text"), { target: { value: "Synthetic pilot A acquisition listing with sufficient fictional information." } });
    fireEvent.click(screen.getByRole("button", { name: "Scan business" }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    const signal = (transport.mock.calls[0] as unknown as [string, RequestInit])[1].signal;
    switchAccount(account("synthetic-pilot-B", true)); await screen.findByRole("heading", { name: "Build your acquisition portfolio" });
    expect(signal?.aborted).toBe(true);
    await act(async () => { finish(new Response(JSON.stringify({ ok: true, scan: syntheticLibrary(1)[0].state.scan }))); });
    expect(screen.queryByRole("heading", { name: "Executive Overview" })).toBeNull();
    expect(store("synthetic-pilot-B").draft).toBeNull(); expect(transport).toHaveBeenCalledTimes(1);
    expect(state.user!.getIdToken).not.toHaveBeenCalled();
  });
  it("shows a clear fail-closed message when a pilot scan is denied by the paid-provider guard", async () => {
    state.user = account("synthetic-pilot", true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    render(<CloudApp />); fireEvent.click(await screen.findByRole("button", { name: "Analyze an Opportunity" }));
    await screen.findByRole("button", { name: "Scan business" });
    fireEvent.change(screen.getByLabelText("Listing text"), { target: { value: "Synthetic pilot A acquisition listing with sufficient fictional information." } });
    fireEvent.click(screen.getByRole("button", { name: "Scan business" }));
    await screen.findByText(/Paid provider access is reserved for the founder/);
    expect(state.puter).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Listing text") as HTMLTextAreaElement).value).toContain("Synthetic pilot A");
  });
  it("clears unsaved state on a fresh SDK session even if the same founder UID signs in again", async () => {
    render(<CloudApp />); fireEvent.click(await screen.findByRole("button", { name: "Analyze an Opportunity" }));
    await screen.findByRole("button", { name: "Scan business" });
    fireEvent.change(screen.getByLabelText("Listing text"), { target: { value: "Unsaved synthetic data from the old founder session." } });
    const old = state.repository.mock.calls[0][0] as WorkspaceSession;
    switchAccount(account("synthetic-founder"));
    await screen.findByRole("heading", { name: "Acquisition Portfolio" });
    expect(old.signal.aborted).toBe(true);
    expect(state.repository.mock.calls.at(-1)?.[0].epoch).not.toBe(old.epoch);
    expect(screen.queryByRole("button", { name: /Continue Analysis/ })).toBeNull();
    expect(store("synthetic-founder").draft).toBeNull();
  });
  it("does not clear a newly selected pilot when an older sign-out promise finishes", async () => {
    let finish!: () => void; state.signOut.mockImplementationOnce(() => new Promise<void>(done => { finish = done; }));
    render(<CloudApp />); await screen.findAllByText("Example Service Group 01");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    switchAccount(account("synthetic-pilot", true));
    await act(async () => { finish(); });
    await screen.findByRole("heading", { name: "Build your acquisition portfolio" });
    expect(state.home).not.toHaveBeenCalled(); expect(state.user?.uid).toBe("synthetic-pilot");
  });
});
