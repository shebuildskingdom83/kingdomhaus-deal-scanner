import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { loadEnv } from "vite";

const placeholder = "'FOUNDER_UID_NOT_CONFIGURED'";
export const founderRulesPath = ".firebase/firestore.founder.rules";
export const founderConfigPath = "firebase.founder.local.json";
export const founderReviewPath = ".firebase/founder-rules.review.json";

export function validateFounderConfiguration(env: Record<string, string>): { uid: string; projectId: string } {
  const required = ["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "APP_ID", "FOUNDER_UID"];
  for (const key of required) {
    if (!env["VITE_FIREBASE_" + key]?.trim()) throw new Error("Required Firebase setting is missing: " + key + ". No values were logged.");
  }
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(env.VITE_FIREBASE_API_KEY) ||
    !/^[a-z0-9.-]+$/.test(env.VITE_FIREBASE_AUTH_DOMAIN) || env.VITE_FIREBASE_AUTH_DOMAIN.includes("..") ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.VITE_FIREBASE_PROJECT_ID) ||
    !/^1:[0-9]+:web:[A-Za-z0-9]+$/.test(env.VITE_FIREBASE_APP_ID)) {
    throw new Error("Firebase Web configuration format is invalid. No values were logged.");
  }
  const uid = env.VITE_FIREBASE_FOUNDER_UID;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || uid === "FOUNDER_UID_NOT_CONFIGURED" || uid === "synthetic-founder") {
    throw new Error("Founder UID is missing, invalid, or still a test placeholder. No values were logged.");
  }
  return { uid, projectId: env.VITE_FIREBASE_PROJECT_ID };
}

export function renderFounderRules(template: string, uid: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error("Invalid UID format. No values were logged.");
  if (template.split(placeholder).length !== 2) throw new Error("Rules template must contain exactly one founder authorization placeholder.");
  return template.replace(placeholder, "'" + uid + "'");
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function readConfiguration(root: string) {
  const parsed = parseEnv(readFileSync(resolve(root, ".env.cloud.local"), "utf8"));
  const file = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const effective = loadEnv("cloud", root, "VITE_FIREBASE_");
  const configured = validateFounderConfiguration(file);
  validateFounderConfiguration(effective);
  for (const key of ["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "APP_ID", "FOUNDER_UID"]) {
    if (file["VITE_FIREBASE_" + key] !== effective["VITE_FIREBASE_" + key]) {
      throw new Error("A Firebase setting is overridden or interpolated outside the local cloud file. Resolve the mismatch before preparing rules. No values were logged.");
    }
  }
  return configured;
}

function writeNewOrIdentical(path: string, value: string) {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== value) throw new Error("A prepared rules artifact differs from current settings. It was not overwritten; review is required.");
    return;
  }
  writeFileSync(path, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export function prepareFounderRules(root = process.cwd()) {
  const { uid, projectId } = readConfiguration(root);
  const template = readFileSync(resolve(root, "firestore.rules"), "utf8");
  const candidate = renderFounderRules(template, uid);
  // Neither the raw UID nor any Web configuration value is included in the review manifest.
  const manifest = JSON.stringify({ schemaVersion: 1, rulesSha256: hash(candidate), projectSha256: hash(projectId) }, null, 2) + "\n";
  const config = JSON.stringify({ firestore: { rules: founderRulesPath } }, null, 2) + "\n";
  mkdirSync(resolve(root, ".firebase"), { recursive: true });
  writeNewOrIdentical(resolve(root, founderRulesPath), candidate);
  writeNewOrIdentical(resolve(root, founderConfigPath), config);
  writeNewOrIdentical(resolve(root, founderReviewPath), manifest);
  return { configurationValid: true, founderBound: true, candidatePrepared: true, published: false };
}

export function syntheticFounderRules(root = process.cwd()): string {
  const template = readFileSync(resolve(root, "firestore.rules"), "utf8");
  const path = resolve(root, founderRulesPath);
  if (!existsSync(path)) return renderFounderRules(template, "synthetic-founder");
  const { uid, projectId } = readConfiguration(root);
  const candidate = readFileSync(path, "utf8");
  const manifest = JSON.parse(readFileSync(resolve(root, founderReviewPath), "utf8"));
  if (candidate !== renderFounderRules(template, uid) || manifest.schemaVersion !== 1 ||
    manifest.rulesSha256 !== hash(candidate) || manifest.projectSha256 !== hash(projectId)) {
    throw new Error("Prepared founder policy or configuration changed since review. No values were logged; regenerate and review before proceeding.");
  }
  // Test the exact prepared policy with a fictional identity. Never send the
  // founder's UID or real configuration to an emulator or its diagnostic logs.
  return candidate.replace("'" + uid + "'", "'synthetic-founder'");
}
