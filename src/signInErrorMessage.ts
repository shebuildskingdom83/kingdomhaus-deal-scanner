/** Presentation only: never interpret cancellation as authentication success. */
export function signInErrorMessage(failure: unknown): string {
  const code = failure && typeof failure === "object" && "code" in failure && typeof failure.code === "string" ? failure.code : "";
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/user-cancelled": return "";
    case "auth/network-request-failed": return "Connection issue. Please try again.";
    case "auth/user-disabled":
    case "auth/admin-restricted-operation": return "This account doesn't have access to Deal Scanner.";
    default: return "Unable to sign in. Please try again.";
  }
}
