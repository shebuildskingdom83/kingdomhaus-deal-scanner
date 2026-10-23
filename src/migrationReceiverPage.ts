import { onAuthStateChanged } from "firebase/auth";
import { cloudClient, cloudSignIn, founderUid } from "./firebaseClient";
import { isFounderAccount } from "./cloudPersistence";
import { boundMessage, HANDOFF_CHANNEL, HANDOFF_LIFETIME_MS, MigrationHandoffSession, newChallenge, RECEIVER_ORIGIN, SOURCE_ORIGIN, validChallenge } from "./migrationHandoff";

const control = (id: string) => document.getElementById(id) as HTMLButtonElement;
const status = document.getElementById("status")!, summary = document.getElementById("summary")!;
const peer = window.opener;
let challenge = "", expires = 0, session: MigrationHandoffSession | null = null, authorized = false, running = false;
const pending = new Map<string, (unchanged: boolean) => void>();
const send = (type: string, extra = {}) => peer?.postMessage({ channel: HANDOFF_CHANNEL, type, challenge, ...extra }, SOURCE_ORIGIN);
const sourceUnchanged = () => new Promise<boolean>(resolve => {
  if (!peer || peer.closed || Date.now() >= expires || !authorized) return resolve(false);
  const nonce = newChallenge(); pending.set(nonce, resolve); send("check-source", { nonce });
  setTimeout(() => { if (pending.delete(nonce)) resolve(false); }, 5000);
});
function cancel() {
  session?.cancel(); session = null; control("review").disabled = true; control("execute").disabled = true;
  for (const resolve of pending.values()) resolve(false); pending.clear();
}
if (import.meta.env.DEV && ["cloud", "cloud-emulator"].includes(import.meta.env.MODE) && location.origin === RECEIVER_ORIGIN && peer && window.top === window.self) {
  control("connect").disabled = false;
  control("connect").onclick = () => {
    control("connect").disabled = true;
    try {
      onAuthStateChanged(cloudClient().auth, user => {
        authorized = isFounderAccount(user?.uid, founderUid);
        control("signin").hidden = authorized;
        if (authorized && !session) { send("ready"); status.textContent = "Founder session connected. Waiting for an explicitly sent source snapshot."; }
        else if (!authorized) { cancel(); status.textContent = "Founder sign-in is required. No migration will start after sign-in."; }
      }, () => { authorized = false; cancel(); status.textContent = "Founder session could not be checked. No transfer started."; });
    } catch { status.textContent = "Cloud configuration unavailable. No transfer started."; }
  };
  control("signin").onclick = async () => { try { await cloudSignIn(); } catch { status.textContent = "Google sign-in did not complete. Nothing was transferred."; } };
  window.addEventListener("message", event => {
    if (!authorized || !boundMessage(event, SOURCE_ORIGIN, peer)) return;
    const data = event.data;
    if (data.type === "challenge" && !session && !challenge && validChallenge(data.challenge)) {
      challenge = data.challenge; expires = Date.now() + HANDOFF_LIFETIME_MS;
      session = new MigrationHandoffSession(peer, challenge); control("cancel").disabled = false; send("bound"); return;
    }
    if (!session || data.challenge !== challenge || Date.now() >= expires) return;
    if (data.type === "records") {
      try { summary.textContent = JSON.stringify(session.accept(event), null, 2); control("review").disabled = false;
        status.textContent = "Four validated records received in memory. No cloud writes. Review cloud conflicts next.";
      } catch { cancel(); status.textContent = "Handoff validation failed. No automatic retry or writes."; }
    } else if (data.type === "source-status" && validChallenge(data.nonce) && typeof data.unchanged === "boolean") {
      const resolve = pending.get(data.nonce); pending.delete(data.nonce); resolve?.(data.unchanged);
    } else if (data.type === "cancel") { cancel(); status.textContent = "Source cancelled. Completed copies, if any, remain; no cleanup was performed."; }
  });
  control("review").onclick = async () => {
    if (!authorized || !session || running) return;
    running = true; control("review").disabled = true; control("execute").disabled = true;
    try {
      if (!await sourceUnchanged()) throw new Error();
      const result = await session.review(cloudClient().repository());
      summary.textContent = JSON.stringify({ records: session.summary(), ...result, cloudWrites: 0 }, null, 2);
      control("execute").disabled = false; status.textContent = "Read-only cloud conflict review passed. Explicit create-only confirmation is still required.";
    } catch { status.textContent = "Cloud conflict, source change, or access failure. Nothing was written by this review."; }
    finally { running = false; control("review").disabled = !session; }
  };
  control("execute").onclick = async () => {
    if (!authorized || !session || running || control("execute").disabled) return;
    if (!window.confirm("Create only these four approved acquisitions in Firebase, retaining IDs and historical revisions? Existing different records must never be overwritten. Local originals and recovery state will remain unchanged.")) return;
    running = true; control("execute").disabled = true; control("review").disabled = true;
    try {
      const result = await session.execute(cloudClient().repository(), { confirmed: true, sourceUnchanged, authorized: () => authorized && !peer.closed });
      summary.textContent = JSON.stringify(result, null, 2); status.textContent = "Server readback verified all four records. Local originals remain unchanged. Cutover and cleanup are not authorized.";
      send("complete"); cancel();
    } catch (error) {
      const count = error && typeof error === "object" && "completedIds" in error && Array.isArray(error.completedIds) ? error.completedIds.length : 0;
      summary.textContent = JSON.stringify({ verifiedCount: count, partialCopiesMayExist: true }, null, 2);
      status.textContent = "Migration stopped. Preserve both workspaces. Review before an explicit same-snapshot retry; nothing was overwritten or deleted.";
    } finally { running = false; control("review").disabled = !session; }
  };
  control("cancel").onclick = () => { send("cancel"); cancel(); status.textContent = "Handoff cancelled. In-flight work may finish; completed copies remain. Local records were not changed."; };
  window.addEventListener("pagehide", () => { send("cancel"); cancel(); });
  setInterval(() => { if (session && (peer.closed || Date.now() >= expires)) { cancel(); status.textContent = "Handoff expired or source closed. No automatic retry."; } }, 1000);
} else status.textContent = "Disabled without the exact local cloud origin and its bound source window.";
