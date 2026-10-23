// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({ auth: { currentUser: null as { uid: string } | null }, config: null as string | null,
  initializationFailure: false,
  changed: null as ((user: unknown) => void) | null, failed: null as ((error: unknown) => void) | null,
  signIn: vi.fn(), signOut: vi.fn(), repository: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("firebase/auth", () => ({ onAuthStateChanged: (_auth: unknown, changed: typeof state.changed, failed: typeof state.failed) => {
  state.changed = changed; state.failed = failed; return state.unsubscribe;
}, signOut: state.signOut }));
vi.mock("../src/firebaseClient", () => ({ founderUid: "synthetic-founder", cloudConfigurationError: () => state.config,
  cloudClient: () => { if (state.initializationFailure) throw new Error("Synthetic initialization failure"); return { auth: state.auth, repository: state.repository }; }, cloudSignIn: state.signIn }));
import { installLandingAuth } from "../src/landingAuth";

let dispose: (() => void) | undefined;
const navigate = vi.fn();
const control = (index = 0) => document.querySelectorAll<HTMLAnchorElement>(".launch-control")[index];
const status = (index = 0) => document.getElementById(`status-${index}`)!;
function mount(restored = true) { dispose = installLandingAuth(document, navigate); if (restored) state.changed?.(state.auth.currentUser); }
beforeEach(() => {
  vi.clearAllMocks(); state.signIn.mockReset(); state.signOut.mockReset(); state.config = null; state.initializationFailure = false; state.auth.currentUser = null;
  state.changed = null; state.failed = null;
  document.body.innerHTML = Array.from({ length: 4 }, (_, i) => `<a href="/cloud" class="button gold launch-control" aria-describedby="status-${i}">Launch ${i}<span>icon</span></a><p class="sr-only" id="status-${i}">Opens the scanner</p>`).join("");
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; });

describe("public landing launch using the existing Firebase client", () => {
  it.each(["signin", "create"])("admits an SDK-confirmed pilot through the existing %s popup without loading acquisitions", async intent => {
    document.body.insertAdjacentHTML("beforeend", `<button data-cloud-auth="${intent}" aria-describedby="pilot-status">${intent}</button><p id="pilot-status"></p>`);
    const pilot = { uid: "synthetic-pilot", getIdTokenResult: vi.fn(async () => ({ claims: { kingdomhausPilot: true } })) };
    state.signIn.mockImplementationOnce(async () => { state.auth.currentUser = pilot; return { user: pilot }; });
    mount(); fireEvent.click(document.querySelector("[data-cloud-auth]")!);
    expect(state.signIn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(pilot.getIdTokenResult).toHaveBeenCalledTimes(1); expect(state.repository).not.toHaveBeenCalled();
  });
  it("discards a late pilot-admission result after a different account becomes current", async () => {
    let finish!: (value: unknown) => void;
    const pilot = { uid: "synthetic-pilot", getIdTokenResult: () => new Promise(done => { finish = done; }) };
    state.auth.currentUser = pilot; mount(); fireEvent.click(control());
    state.auth.currentUser = { uid: "synthetic-unapproved" }; state.changed?.(state.auth.currentUser);
    finish({ claims: { kingdomhausPilot: true } });
    await waitFor(() => expect(control().hasAttribute("aria-busy")).toBe(false));
    expect(navigate).not.toHaveBeenCalled(); expect(state.repository).not.toHaveBeenCalled();
  });
  it("places denial and sign-out in the shared region outside navigation", async () => {
    document.body.insertAdjacentHTML("afterbegin", '<header><button data-cloud-auth="create" aria-describedby="navigation-auth-status">Create an Account</button></header><div data-auth-feedback hidden><p id="navigation-auth-status" class="sr-only"></p></div>');
    state.auth.currentUser = { uid: "unauthorized-synthetic" }; mount();
    fireEvent.click(document.querySelector("[data-cloud-auth]")!);
    await waitFor(() => expect(document.querySelector<HTMLElement>("[data-auth-feedback]")!.hidden).toBe(false));
    expect(document.querySelector("header [role=alert]")).toBeNull();
    expect(document.querySelector("[data-auth-feedback] [data-cloud-signout]")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled(); expect(state.repository).not.toHaveBeenCalled();
    state.signOut.mockImplementation(async () => { state.auth.currentUser = null; });
    fireEvent.click(document.querySelector("[data-cloud-signout]")!);
    await waitFor(() => expect(document.querySelector<HTMLElement>("[data-auth-feedback]")!.hidden).toBe(true));
  });
  it("does not launch sign-in or access acquisition data on load", () => {
    mount(); expect(state.signIn).not.toHaveBeenCalled(); expect(state.repository).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2, 3])("starts the popup synchronously from control %s and authorizes before navigating", async index => {
    let resolve!: (result: unknown) => void;
    state.signIn.mockImplementation(() => new Promise(done => { resolve = done; }));
    mount(); control(index).focus();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true }); control(index).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(state.signIn).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(control(index));
    expect(status(index).textContent).toBe("");
    expect(status(index).classList.contains("sr-only")).toBe(true);
    for (let i = 0; i < 4; i++) { expect(control(i).getAttribute("aria-busy")).toBe("true"); fireEvent.click(control(i)); }
    expect(state.signIn).toHaveBeenCalledTimes(1); expect(navigate).not.toHaveBeenCalled();
    state.auth.currentUser = { uid: "synthetic-founder" }; resolve({ user: state.auth.currentUser });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(control(index).hasAttribute("aria-busy")).toBe(false));
    expect(state.repository).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2, 3])("opens an existing founder session immediately from control %s without another popup", index => {
    state.auth.currentUser = { uid: "synthetic-founder" }; mount(); fireEvent.click(control(index));
    expect(navigate).toHaveBeenCalledTimes(1); expect(state.signIn).not.toHaveBeenCalled(); expect(state.repository).not.toHaveBeenCalled();
  });
  it("uses the SDK's current user after auth changes, without a second stored session", async () => {
    mount(); state.auth.currentUser = { uid: "synthetic-founder" }; state.changed?.(state.auth.currentUser);
    fireEvent.click(control()); expect(navigate).toHaveBeenCalledTimes(1);
    navigate.mockClear(); state.auth.currentUser = { uid: "unauthorized-synthetic" }; state.changed?.(state.auth.currentUser);
    fireEvent.click(control()); expect(navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(status().textContent).toContain("doesn't have access")); expect(state.repository).not.toHaveBeenCalled();
  });
  it.each(["auth/popup-closed-by-user", "auth/user-cancelled"])("keeps cancellation silent and allows a deliberate retry (%s)", async code => {
    mount(); state.signIn.mockRejectedValue({ code }); fireEvent.click(control());
    await waitFor(() => expect(control().hasAttribute("aria-busy")).toBe(false));
    expect(status().textContent).toBe(""); expect(status().classList.contains("sr-only")).toBe(true);
    expect(navigate).not.toHaveBeenCalled(); fireEvent.click(control()); expect(state.signIn).toHaveBeenCalledTimes(2);
  });
  it.each(["auth/popup-blocked", "auth/network-request-failed", "auth/internal-error"])("announces failure with the existing control available to retry (%s)", async code => {
    mount(); state.signIn.mockRejectedValueOnce({ code, message: "Sensitive synthetic implementation details" }); fireEvent.click(control());
    await waitFor(() => expect(status().getAttribute("role")).toBe("alert"));
    expect(status().textContent).toContain("Please try again"); expect(status().textContent).not.toContain("Sensitive");
    await waitFor(() => expect(control().hasAttribute("aria-disabled")).toBe(false));
    state.signIn.mockRejectedValueOnce({ code: "auth/popup-closed-by-user" }); fireEvent.click(control());
    expect(state.signIn).toHaveBeenCalledTimes(2); expect(navigate).not.toHaveBeenCalled();
  });
  it("denies a newly signed-in nonfounder without entering the workspace", async () => {
    mount(); state.signIn.mockImplementation(async () => { state.auth.currentUser = { uid: "unauthorized-synthetic" }; return { user: state.auth.currentUser }; });
    fireEvent.click(control()); await waitFor(() => expect(status().textContent).toContain("doesn't have access"));
    expect(status().getAttribute("role")).toBe("alert"); expect(navigate).not.toHaveBeenCalled(); expect(state.repository).not.toHaveBeenCalled();
  });
  it("does not navigate if the authenticated session disappears before popup completion", async () => {
    mount(); state.signIn.mockResolvedValueOnce({ user: { uid: "synthetic-founder" } }); fireEvent.click(control());
    await waitFor(() => expect(status().getAttribute("role")).toBe("alert")); expect(navigate).not.toHaveBeenCalled();
  });
  it("waits safely for restoration and never starts a popup outside a new user gesture", () => {
    mount(false); fireEvent.click(control()); expect(status().textContent).toBe("Checking sign-in. Please try again.");
    expect(state.signIn).not.toHaveBeenCalled(); state.changed?.(null); expect(state.signIn).not.toHaveBeenCalled();
  });
  it("keeps configuration failures public and does not disclose their details", () => {
    state.config = "Synthetic missing configuration details"; mount(); fireEvent.click(control());
    expect(status().textContent).toBe("Sign-in is unavailable. Please try again later."); expect(state.signIn).not.toHaveBeenCalled();
  });
  it("allows a deliberate popup retry after an auth restoration failure", async () => {
    mount(false); state.failed?.({ code: "auth/network-request-failed" }); fireEvent.click(control());
    expect(status().getAttribute("role")).toBe("alert"); expect(state.signIn).not.toHaveBeenCalled();
    state.signIn.mockRejectedValueOnce({ code: "auth/popup-closed-by-user" }); fireEvent.click(control());
    expect(state.signIn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(control().hasAttribute("aria-busy")).toBe(false));
  });
  it("does not crash the public homepage when Firebase initialization fails", () => {
    state.initializationFailure = true; expect(() => mount()).not.toThrow(); fireEvent.click(control());
    expect(status().textContent).toBe("Sign-in is unavailable. Please try again later."); expect(state.signIn).not.toHaveBeenCalled();
  });
  it.each(["signin", "create"])("reuses the same popup for the local navigation action %s, without instructional messages", async intent => {
    document.body.insertAdjacentHTML("beforeend", `<button type="button" data-cloud-auth="${intent}" disabled aria-describedby="navigation-status">${intent}</button><p id="navigation-status" class="sr-only"></p>`);
    const button = document.querySelector<HTMLButtonElement>("[data-cloud-auth]")!;
    let resolve!: (value: unknown) => void;
    state.signIn.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    mount(); expect(button.disabled).toBe(false); button.focus(); fireEvent.click(button);
    expect(state.signIn).toHaveBeenCalledTimes(1);
    expect(document.getElementById("navigation-status")!.textContent).toBe("");
    expect(button.getAttribute("aria-busy")).toBe("true");
    state.auth.currentUser = { uid: "synthetic-founder" }; resolve({ user: state.auth.currentUser });
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(state.repository).not.toHaveBeenCalled();
  });
  it("connects a new identity without workspace access and offers sign-out with focus restoration", async () => {
    document.body.insertAdjacentHTML("beforeend", '<div><button type="button" data-cloud-auth="create" disabled aria-describedby="navigation-status">Create an Account</button><p id="navigation-status" class="sr-only"></p></div>');
    const button = document.querySelector<HTMLButtonElement>("[data-cloud-auth]")!;
    const description = document.getElementById("navigation-status")!;
    mount(); state.signIn.mockImplementationOnce(async () => { state.auth.currentUser = { uid: "synthetic-new-user" }; return { user: state.auth.currentUser }; });
    fireEvent.click(button);
    await waitFor(() => expect(description.textContent).toBe("Your Google account is connected. Workspace access is not enabled."));
    expect(navigate).not.toHaveBeenCalled(); expect(state.repository).not.toHaveBeenCalled();
    await waitFor(() => expect(button.hasAttribute("aria-busy")).toBe(false));
    state.signOut.mockRejectedValueOnce(new Error("Synthetic failure"));
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-cloud-signout]")!);
    await waitFor(() => expect(description.textContent).toBe("Sign-out failed. Please try again."));
    await waitFor(() => expect(document.querySelector<HTMLButtonElement>("[data-cloud-signout]")!.disabled).toBe(false));
    state.signOut.mockImplementationOnce(async () => { state.auth.currentUser = null; state.changed?.(null); });
    fireEvent.click(document.querySelector<HTMLButtonElement>("[data-cloud-signout]")!);
    await waitFor(() => expect(document.querySelector("[data-cloud-signout]")).toBeNull());
    expect(description.textContent).toBe(""); expect(document.activeElement).toBe(button);
  });
  it("keeps standalone navigation actions disconnected when authentication is unconfigured", () => {
    document.body.insertAdjacentHTML("beforeend", '<button data-cloud-auth="create" disabled>Create an Account</button>');
    state.config = "Missing configuration"; mount();
    expect(document.querySelector<HTMLButtonElement>("[data-cloud-auth]")!.disabled).toBe(true);
    expect(state.signIn).not.toHaveBeenCalled();
  });
  it("ignores popup completion after disposal and removes its listener", async () => {
    let resolve!: (value: unknown) => void;
    state.signIn.mockImplementation(() => new Promise(done => { resolve = done; })); mount(); fireEvent.click(control());
    dispose?.(); dispose = undefined; state.auth.currentUser = { uid: "synthetic-founder" }; resolve({ user: state.auth.currentUser });
    await Promise.resolve(); expect(navigate).not.toHaveBeenCalled(); expect(state.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
