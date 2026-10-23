import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export const pilotArtifacts = ".firebase/phase2-stage1";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function replaceOnce(source: string, before: string, after: string) {
  if (source.split(before).length !== 2) throw new Error("Deployed policy structure changed; stop for review.");
  return source.replace(before, after);
}
/** Transform only the captured deployed baseline, never the older deployment template. */
export function renderPilotRules(deployed: string, founder: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(founder)) throw new Error("Invalid founder configuration.");
  if (!deployed.includes("function founder() { return request.auth != null && request.auth.uid == '" + founder + "'; }") ||
      !deployed.includes("function unchangedOffset()") || !deployed.includes("match /{document=**} { allow read, write: if false; }")) {
    throw new Error("Deployed policy is missing required founder or revision protections.");
  }
  let result = replaceOnce(deployed,
    "function owns(uid) { return founder() && request.auth.uid == uid; }",
    "function pilot() { return request.auth != null && request.auth.token.get('kingdomhausPilot', false) == true; }\n" +
    "    function owns(uid) { return request.auth != null && request.auth.uid == uid && (founder() || pilot()); }");
  result = replaceOnce(result,
    "&& valid(id, uid) && request.resource.data.revision == 1;",
    "&& valid(id, uid) && (founder() || !request.resource.data.keys().hasAny(['migrationRevisionOffset'])) && request.resource.data.revision == 1;");
  result = replaceOnce(result,
    "&& valid(id, uid) && unchangedOffset()",
    "&& valid(id, uid) && request.resource.data.ownerUid == resource.data.ownerUid && unchangedOffset()");
  result = replaceOnce(result,
    "allow update: if owns(uid) && valid('current', uid)",
    "allow update: if owns(uid) && request.resource.data.ownerUid == resource.data.ownerUid && valid('current', uid)");
  return result;
}
function writeNewOrIdentical(path: string, content: string) {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content) throw new Error("Existing pilot review artifact differs; no file was overwritten.");
  } else writeFileSync(path, content, { flag: "wx", mode: 0o600 });
}
export function preparePilotRules(root = process.cwd()) {
  const env = parseEnv(readFileSync(resolve(root, ".env.cloud.local"), "utf8"));
  const baseline = readFileSync(resolve(root, pilotArtifacts, "deployed.rules"), "utf8");
  const review = JSON.parse(readFileSync(resolve(root, pilotArtifacts, "baseline.review.json"), "utf8"));
  if (review.projectId !== env.VITE_FIREBASE_PROJECT_ID || review.sha256 !== hash(baseline) ||
      review.release !== `projects/${review.projectId}/releases/cloud.firestore` ||
      !review.rulesetName?.startsWith(`projects/${review.projectId}/rulesets/`)) throw new Error("Deployed baseline review mismatch.");
  const candidate = renderPilotRules(baseline, env.VITE_FIREBASE_FOUNDER_UID!);
  writeNewOrIdentical(resolve(root, pilotArtifacts, "pilot.proposed.rules"), candidate);
  // The shareable review copy contains no actual founder identity. It is not selected by firebase.json.
  writeNewOrIdentical(resolve(root, "firestore.pilot.rules"),
    candidate.replace("'" + env.VITE_FIREBASE_FOUNDER_UID + "'", "'FOUNDER_UID_NOT_CONFIGURED'"));
  writeNewOrIdentical(resolve(root, pilotArtifacts, "pilot.review.json"), JSON.stringify({
    schemaVersion: 1, baselineSha256: hash(baseline), candidateSha256: hash(candidate), published: false
  }, null, 2) + "\n");
  return { capturedDeployedBaselineVerified: true, candidatePrepared: true, published: false };
}
export function syntheticPilotRules(root = process.cwd()) {
  // Require the actual reviewed candidate, then replace the identity before it ever reaches an emulator.
  const env = parseEnv(readFileSync(resolve(root, ".env.cloud.local"), "utf8"));
  const baseline = readFileSync(resolve(root, pilotArtifacts, "deployed.rules"), "utf8");
  const candidate = readFileSync(resolve(root, pilotArtifacts, "pilot.proposed.rules"), "utf8");
  const review = JSON.parse(readFileSync(resolve(root, pilotArtifacts, "pilot.review.json"), "utf8"));
  const baselineReview = JSON.parse(readFileSync(resolve(root, pilotArtifacts, "baseline.review.json"), "utf8"));
  if (baselineReview.projectId !== env.VITE_FIREBASE_PROJECT_ID || baselineReview.sha256 !== hash(baseline) ||
      review.baselineSha256 !== hash(baseline) || review.candidateSha256 !== hash(candidate) ||
      candidate !== renderPilotRules(baseline, env.VITE_FIREBASE_FOUNDER_UID!)) throw new Error("Pilot candidate changed since review.");
  return candidate.replace("'" + env.VITE_FIREBASE_FOUNDER_UID + "'", "'synthetic-founder'");
}
