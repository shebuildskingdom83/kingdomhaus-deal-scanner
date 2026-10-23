import { getApps, initializeApp } from "firebase/app";
import { browserPopupRedirectResolver, browserSessionPersistence, connectAuthEmulator, getAuth, GoogleAuthProvider, initializeAuth, signInWithPopup } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, initializeFirestore, memoryLocalCache } from "firebase/firestore";
import { FirestoreAcquisitionRepository } from "./firestoreAcquisitionRepository";
import { isFounderAccount } from "./cloudPersistence";
import type { WorkspaceSession } from "./workspaceSession";

const env = import.meta.env;
export const cloudEmulator = env.MODE === "cloud-emulator";
export const founderUid = cloudEmulator ? "synthetic-founder" : env.VITE_FIREBASE_FOUNDER_UID;
const options = cloudEmulator ? {
  apiKey: "demo-key", projectId: "demo-kingdomhaus", authDomain: "demo-kingdomhaus.firebaseapp.com", appId: "demo-kingdomhaus"
} : { apiKey: env.VITE_FIREBASE_API_KEY, projectId: env.VITE_FIREBASE_PROJECT_ID,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, appId: env.VITE_FIREBASE_APP_ID };
export function cloudConfigurationError(): string | null {
  if (cloudEmulator && !["localhost", "127.0.0.1"].includes(window.location.hostname)) return "The synthetic emulator preview is available on localhost only.";
  if (!Object.values(options).every(value => typeof value === "string" && value.trim())) return "Cloud persistence is not configured. Your existing local workspace has not been changed.";
  if (founderUid && (!/^[A-Za-z0-9_-]{1,128}$/.test(founderUid) || founderUid === "FOUNDER_UID_NOT_CONFIGURED")) return "Configure the exact authorized Firebase UID before using cloud persistence.";
  return null;
}
let client: ReturnType<typeof createClient> | undefined;
function createClient() {
  // Reuse our explicitly configured memory-only client across Vite hot reloads.
  const existing = getApps().some(app => app.name === "kingdomhaus-cloud");
  const app = initializeApp(options, "kingdomhaus-cloud");
  const auth = existing ? getAuth(app) : initializeAuth(app, { persistence: browserSessionPersistence });
  const db = existing ? getFirestore(app) : initializeFirestore(app, { localCache: memoryLocalCache() });
  if (cloudEmulator && !existing) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  return { app, auth, db, repository: (session?: WorkspaceSession) => {
    session?.assert();
    const current = getAuth(app).currentUser;
    // No-session callers are the existing founder-only migration/review tools.
    if (!current || (session ? current.uid !== session.uid : !isFounderAccount(current.uid, founderUid))) throw new Error("This account is not authorized to access KingdomHaus acquisitions.");
    return new FirestoreAcquisitionRepository(db, current.uid, undefined, () => {
      session?.assert();
      if (getAuth(app).currentUser !== current) throw new Error("The account changed. Reopen the current workspace.");
    });
  } };
}
export function cloudClient() {
  const error = cloudConfigurationError();
  if (error) throw new Error(error);
  return client ??= createClient();
}
export async function cloudSignIn() {
  const { auth } = cloudClient();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider, browserPopupRedirectResolver);
}
