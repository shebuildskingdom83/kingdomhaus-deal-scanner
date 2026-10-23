import { onAuthStateChanged, signOut } from "firebase/auth";
import type { Auth } from "firebase/auth";
import { cloudClient, cloudConfigurationError, cloudSignIn, founderUid } from "./firebaseClient";
import { isFounderAccount } from "./cloudPersistence";
import { signInErrorMessage } from "./signInErrorMessage";
import { openCloudWorkspace } from "./websiteNavigation";
import { workspaceAdmitted } from "./workspaceSession";

/** The SDK owns the session. This adapter only handles public-page launch feedback. */
export function installLandingAuth(root: Document = document, navigate = openCloudWorkspace) {
  let pending = false;
  let restored = false;
  let disposed = false;
  let accountVersion = 0;
  let restorationError = "";
  let configurationError = cloudConfigurationError();
  let auth: Auth | null = null;
  let unsubscribe = () => {};
  try {
    if (!configurationError) {
      auth = cloudClient().auth;
      unsubscribe = onAuthStateChanged(auth, () => { ++accountVersion; restored = true; restorationError = ""; }, failure => {
        ++accountVersion;
        restored = false; restorationError = signInErrorMessage(failure) || "Unable to sign in. Please try again.";
      });
    }
  } catch {
    // Authentication initialization must not stop the public homepage's own scripts.
    configurationError = "unavailable";
  }
  const selector = ".launch-control,[data-cloud-auth]";
  const controls = () => Array.from(root.querySelectorAll<HTMLElement>(selector));
  // Standalone landing builds remain disconnected. Only this local shared integration enables them.
  if (!configurationError) root.querySelectorAll<HTMLButtonElement>("button[data-cloud-auth]").forEach(control => { control.disabled = false; });
  function feedback(control: HTMLElement, message: string, error = false) {
    const description = root.getElementById(control.getAttribute("aria-describedby") || "");
    if (!description) return;
    description.parentElement?.querySelectorAll('[data-cloud-signout]').forEach(button => button.remove());
    description.classList.toggle("sr-only", !message);
    description.classList.toggle("landing-auth-feedback", !!message);
    description.setAttribute("role", error ? "alert" : "status");
    description.textContent = message;
    const region = description.closest<HTMLElement>("[data-auth-feedback]");
    if (region) region.hidden = !message;
  }
  function denied(control: HTMLElement) {
    // Navigation descriptions live in the account region outside the header.
    feedback(control, control.dataset.cloudAuth === "create"
      ? "Your Google account is connected. Workspace access is not enabled."
      : "This account doesn't have access to Deal Scanner.", true);
    const description = root.getElementById(control.getAttribute("aria-describedby") || "");
    if (!description || !auth?.currentUser) return;
    const button = root.createElement("button");
    button.type = "button"; button.className = "landing-auth-signout"; button.dataset.cloudSignout = "";
    button.textContent = "Sign Out";
    button.addEventListener("click", () => {
      if (pending || !auth) return;
      busy(true); button.disabled = true;
      void signOut(auth).then(() => {
        if (disposed) return;
        for (const item of controls()) feedback(item, "");
        control.focus({ preventScroll: true });
      }).catch(() => {
        if (!disposed) {
          description.setAttribute("role", "alert");
          description.textContent = "Sign-out failed. Please try again.";
        }
      }).finally(() => { if (!disposed) { busy(false); button.disabled = false; } });
    });
    description.after(button);
  }
  function busy(value: boolean) {
    pending = value;
    for (const control of controls()) {
      if (value) { control.setAttribute("aria-busy", "true"); control.setAttribute("aria-disabled", "true"); }
      else { control.removeAttribute("aria-busy"); control.removeAttribute("aria-disabled"); }
    }
  }
  async function admit(control: HTMLElement, user: NonNullable<Auth["currentUser"]>) {
    const version = accountVersion;
    try {
      const allowed = await workspaceAdmitted(user, founderUid);
      if (disposed || version !== accountVersion || auth?.currentUser !== user) return;
      if (allowed) navigate(); else denied(control);
    } catch {
      if (!disposed && version === accountVersion && auth?.currentUser === user) feedback(control, "Unable to verify workspace access. Please try again.", true);
    }
  }
  function launch(event: MouseEvent) {
    const control = event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
    if (!control || !root.contains(control)) return;
    // Every activation stays in this page until the shared SDK confirms founder authorization.
    event.preventDefault();
    if (pending) return;
    for (const item of controls()) feedback(item, "");
    if (configurationError || !auth || !founderUid) {
      feedback(control, "Sign-in is unavailable. Please try again later.", true); return;
    }
    if (!restored) {
      feedback(control, restorationError || "Checking sign-in. Please try again.", !!restorationError);
      // A failed restoration can be retried through the popup, on the next user gesture.
      if (restorationError) { restorationError = ""; restored = true; }
      return;
    }
    if (auth.currentUser) {
      if (isFounderAccount(auth.currentUser.uid, founderUid)) navigate();
      else { busy(true); void admit(control, auth.currentUser).finally(() => { if (!disposed) busy(false); }); }
      return;
    }
    busy(true);
    // Call synchronously inside the user activation. Never await restoration or lazy imports here.
    void cloudSignIn().then(async result => {
      if (disposed) return;
      if (isFounderAccount(result.user.uid, founderUid) && isFounderAccount(auth?.currentUser?.uid, founderUid)) navigate();
      else if (auth?.currentUser === result.user) await admit(control, result.user);
      else feedback(control, "The signed-in account changed. Please try again.", true);
    }).catch(failure => {
      if (!disposed) feedback(control, signInErrorMessage(failure), !!signInErrorMessage(failure));
    }).finally(() => { if (!disposed) busy(false); });
  }
  root.addEventListener("click", launch);
  return () => { disposed = true; unsubscribe(); root.removeEventListener("click", launch); busy(false); };
}
