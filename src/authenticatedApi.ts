export function createAuthenticatedRequest(getToken: () => Promise<string>, transport: typeof fetch) {
  return async (input: string, init: RequestInit = {}) => {
    if (!input.startsWith("/api/") || input.includes("\\") || input.includes("#")) throw new Error("Invalid API destination.");
    const token = await getToken();
    if (!token || /\s/.test(token)) throw new Error("Sign in to continue. Your unsaved work is unchanged.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    // No automatic replay: a failed response may follow a chargeable provider operation.
    const response = await transport(input, { ...init, headers, redirect: "error", cache: "no-store" });
    if ([401, 403, 503].includes(response.status)) throw new Error(response.status === 403
      ? "This account does not have API access. Your unsaved work is unchanged."
      : response.status === 401 ? "Sign in again to continue. Your unsaved work is unchanged."
      : "The API is unavailable or requires server setup. Your unsaved work is unchanged.");
    return response;
  };
}
export const authenticatedApi = createAuthenticatedRequest(async () => {
  const { cloudClient } = await import("./firebaseClient");
  const auth = cloudClient().auth;
  await auth.authStateReady();
  if (!auth.currentUser) throw new Error("Sign in to continue. Your unsaved work is unchanged.");
  return auth.currentUser.getIdToken();
}, (...args) => fetch(...args));
import type { WorkspaceSession } from "./workspaceSession";

/** Capture the originating workspace before any SDK import, token refresh, or request awaits. */
export function workspaceApi(session: WorkspaceSession) {
  return async (input: string, init: RequestInit = {}) => {
    session.assert();
    const send = createAuthenticatedRequest(async () => {
      session.assert();
      const { cloudClient } = await import("./firebaseClient");
      session.assert();
      const user = cloudClient().auth.currentUser;
      if (!user || user.uid !== session.uid) throw new Error("The account changed. Reopen the current workspace.");
      const token = await user.getIdToken();
      session.assert();
      if (cloudClient().auth.currentUser !== user) throw new Error("The account changed. Reopen the current workspace.");
      return token;
    }, async (url, options) => {
      session.assert();
      const response = await fetch(url, options);
      session.assert();
      return response;
    });
    return send(input, { ...init, signal: init.signal ? AbortSignal.any([session.signal, init.signal]) : session.signal });
  };
}
