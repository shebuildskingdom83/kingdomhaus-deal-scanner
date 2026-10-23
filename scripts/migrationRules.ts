import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { prepareFounderRules, renderFounderRules, syntheticFounderRules } from "./founderRules";

const candidatePath = ".firebase/firestore.migration.proposed.rules";
const reviewPath = ".firebase/migration.proposed.review.json";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function source(root: string) { return readFileSync(resolve(root, "firestore.migration.rules"), "utf8"); }
function exclusiveOrIdentical(path: string, content: string) {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content) throw new Error("Proposed migration artifacts changed. Explicit review is required; nothing was overwritten.");
  } else writeFileSync(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
}
export function prepareMigrationRules(root = process.cwd()) {
  prepareFounderRules(root);
  const env = parseEnv(readFileSync(resolve(root, ".env.cloud.local"), "utf8"));
  const current = JSON.parse(readFileSync(resolve(root, ".firebase/founder-rules.review.json"), "utf8"));
  const rules = renderFounderRules(source(root), env.VITE_FIREBASE_FOUNDER_UID!);
  exclusiveOrIdentical(resolve(root, candidatePath), rules);
  exclusiveOrIdentical(resolve(root, reviewPath), JSON.stringify({ schemaVersion: 1, proposedRulesSha256: hash(rules),
    priorRulesSha256: current.rulesSha256, projectSha256: current.projectSha256 }, null, 2) + "\n");
  return { proposedMigrationPolicyPrepared: true, founderBound: true, deploymentConfigurationUnchanged: true, published: false };
}
export function syntheticMigrationRules(root = process.cwd()) {
  syntheticFounderRules(root);
  const template = source(root), path = resolve(root, candidatePath);
  if (!existsSync(path)) return renderFounderRules(template, "synthetic-founder");
  const env = parseEnv(readFileSync(resolve(root, ".env.cloud.local"), "utf8"));
  const rules = readFileSync(path, "utf8"), review = JSON.parse(readFileSync(resolve(root, reviewPath), "utf8"));
  const prior = JSON.parse(readFileSync(resolve(root, ".firebase/founder-rules.review.json"), "utf8"));
  if (rules !== renderFounderRules(template, env.VITE_FIREBASE_FOUNDER_UID!) || review.schemaVersion !== 1 ||
    review.proposedRulesSha256 !== hash(rules) || review.priorRulesSha256 !== prior.rulesSha256 || review.projectSha256 !== prior.projectSha256) {
    throw new Error("Proposed migration policy differs from the reviewed local candidate. No configuration values were logged.");
  }
  return rules.replace("'" + env.VITE_FIREBASE_FOUNDER_UID + "'", "'synthetic-founder'");
}
