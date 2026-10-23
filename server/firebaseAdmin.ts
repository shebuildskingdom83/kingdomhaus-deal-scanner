import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { TokenVerifier } from "./apiSecurity";

export function firebaseTokenVerifier(projectId: string | undefined): TokenVerifier {
  return async token => {
    if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Server authentication configuration unavailable");
    const app = getApps().find(item => item.name === "kingdomhaus-api") ?? initializeApp({ projectId, credential: applicationDefault() }, "kingdomhaus-api");
    // Admin verifies signature, issuer, audience and expiration; true also rejects revocation/disabled users.
    return getAuth(app).verifyIdToken(token, true);
  };
}
