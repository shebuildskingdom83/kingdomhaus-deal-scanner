import { boundMessage, HANDOFF_CHANNEL, HANDOFF_LIFETIME_MS, handoffSourceUnchanged, newChallenge, readHandoffSnapshot, RECEIVER_ORIGIN, SOURCE_ORIGIN, validChallenge } from "./migrationHandoff";

const control = (id: string) => document.getElementById(id) as HTMLButtonElement;
const status = document.getElementById("status")!;
let peer: Window | null = null, challenge = "", expires = 0, baseline: string | null = null, connected = false;
function cancel() {
  if (peer && challenge) peer.postMessage({ channel: HANDOFF_CHANNEL, type: "cancel", challenge }, RECEIVER_ORIGIN);
  baseline = null; connected = false; peer = null; challenge = "";
  control("send").disabled = true; control("cancel").disabled = true;
}
const active = () => Boolean(peer && !peer.closed && Date.now() < expires);
if (import.meta.env.DEV && import.meta.env.MODE === "development" && location.origin === SOURCE_ORIGIN && window.top === window.self) {
  control("connect").disabled = false;
  control("connect").onclick = () => {
    cancel(); challenge = newChallenge(); expires = Date.now() + HANDOFF_LIFETIME_MS;
    // Opener is intentionally retained only for the exact-origin, challenge-bound handshake.
    peer = window.open(RECEIVER_ORIGIN + "/migration-receiver.html", "_blank");
    control("cancel").disabled = !peer;
    status.textContent = peer ? "Receiver opened. Connect the founder session there. No local records have been read." : "Popup blocked. No local records were read.";
  };
  window.addEventListener("message", event => {
    if (!active() || !boundMessage(event, RECEIVER_ORIGIN, peer)) return;
    const data = event.data;
    if (data.type === "ready" && !connected && baseline === null) {
      peer!.postMessage({ channel: HANDOFF_CHANNEL, type: "challenge", challenge }, RECEIVER_ORIGIN); return;
    }
    if (data.challenge !== challenge) return;
    if (data.type === "bound" && !connected) {
      connected = true; control("send").disabled = false;
      status.textContent = "Founder receiver bound. Sending requires the separate source action below.";
    } else if (data.type === "check-source" && validChallenge(data.nonce)) {
      const unchanged = baseline !== null && handoffSourceUnchanged(localStorage, baseline);
      peer!.postMessage({ channel: HANDOFF_CHANNEL, type: "source-status", challenge, nonce: data.nonce, unchanged }, RECEIVER_ORIGIN);
    } else if (data.type === "complete" || data.type === "cancel") {
      cancel(); status.textContent = "Handoff closed. Local records and recovery state were not changed.";
    }
  });
  control("send").onclick = () => {
    if (!connected || !active() || baseline !== null) return;
    if (!window.confirm("Has the founder explicitly approved transferring these four acquisitions? Send an unchanged snapshot to the bound cloud receiver in memory only? No cloud writes occur until receiver confirmation.")) return;
    try {
      const snapshot = readHandoffSnapshot(localStorage); baseline = snapshot.baseline;
      peer!.postMessage({ channel: HANDOFF_CHANNEL, type: "records", challenge, records: snapshot.records }, RECEIVER_ORIGIN);
      control("send").disabled = true; status.textContent = "Four validated records sent in memory. Review and confirm in the receiver; keep this source tab open and idle.";
    } catch { cancel(); status.textContent = "Saved-record preflight failed or changed. Nothing was sent. Separate review is required."; }
  };
  control("cancel").onclick = () => { cancel(); status.textContent = "Handoff cancelled. Any completed cloud copies remain; local storage was not changed."; };
  window.addEventListener("pagehide", cancel);
  setInterval(() => { if (peer && !active()) { cancel(); status.textContent = "Handoff expired or receiver closed. No automatic retry occurred."; } }, 1000);
} else status.textContent = "Disabled outside the original localhost:5173 development workspace.";
