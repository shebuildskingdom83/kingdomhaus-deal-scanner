import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { migrationFixtures } from "./cloudMigrationFixtures";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KH_PLAYWRIGHT_MODULE || "playwright");
// Fresh contexts only. Never attach to an existing Chrome profile or browser workspace.
const browser = await chromium.launch({ channel: "chrome", headless: true });
const records = migrationFixtures();
records[0].name = '<img src=x onerror="alert(1)"> Synthetic name';
const library = JSON.stringify({ schemaVersion: 2, records, draft: { recordId: records[2].id, recordRevision: records[2].revision, state: records[2].state } });
const artifacts = resolve(".cloud-test-artifacts"); mkdirSync(artifacts, { recursive: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const forbidden: string[] = [];
let downloads = 0;
await context.route("**/*", (route: any) => {
  const url = new URL(route.request().url());
  if (url.origin !== "http://localhost:5173" || url.pathname.startsWith("/api/") || url.pathname === "/src/App.tsx" || url.pathname === "/src/CloudApp.tsx") {
    forbidden.push("Unexpected request"); return route.abort();
  }
  return route.continue();
});
await context.addInitScript({ content: `(() => {
  const raw = ${JSON.stringify(library)};
  const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
  set.call(localStorage, "kingdomhaus-deal-scans:v1", raw);
  set.call(localStorage, "synthetic-unrelated-key", "unchanged");
  const audit = { reads: [], writes: 0, originalUnchanged: () =>
    get.call(localStorage, "kingdomhaus-deal-scans:v1") === raw && get.call(localStorage, "synthetic-unrelated-key") === "unchanged" };
  Object.defineProperty(window, "syntheticPreflightAudit", { value: audit });
  Storage.prototype.getItem = function(key) { audit.reads.push(key); return get.call(this, key); };
  for (const method of ["setItem", "removeItem", "clear"]) {
    Object.defineProperty(Storage.prototype, method, { value: () => { audit.writes++; throw new Error("Synthetic test blocks storage writes"); } });
  }
})();` });
const page = await context.newPage(); page.on("download", () => downloads++);
try {
  await page.goto("http://localhost:5173/preflight-inspector.html");
  const button = page.getByRole("button", { name: "Inspect saved acquisitions", exact: true });
  await button.waitFor(); assert.equal(await button.isEnabled(), true);
  assert.equal(await page.evaluate(() => (window as any).syntheticPreflightAudit.reads.length), 0);
  await page.getByText("Inspection has not run.", { exact: true }).waitFor();
  await button.click();
  await page.getByText("Read-only inspection complete. Migration remains inactive.", { exact: true }).waitFor();
  const result = JSON.parse(await page.locator("#report").innerText());
  assert.equal(result.status, "Compatible"); assert.equal(result.recordCount, 4); assert.equal(result.draft.present, true);
  assert.equal(result.cloudConflictStatus, "Not checked: no cloud access");
  assert.equal(await page.locator("img").count(), 0); assert.equal(await page.locator(".app-header").count(), 0);
  for (const privateValue of [records[0].id, records[0].state.scan.listingUrl!, records[0].state.scan.retrieval!.photographs[0].url]) assert.ok(!JSON.stringify(result).includes(privateValue));
  await button.click();
  assert.deepEqual(await page.evaluate(() => (window as any).syntheticPreflightAudit.reads), Array(4).fill("kingdomhaus-deal-scans:v1"));
  assert.equal(await page.evaluate(() => (window as any).syntheticPreflightAudit.writes), 0);
  assert.equal(await page.evaluate(() => (window as any).syntheticPreflightAudit.originalUnchanged()), true);
  await page.screenshot({ path: resolve(artifacts, "preflight-synthetic-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: resolve(artifacts, "preflight-synthetic-mobile.png"), fullPage: true });
  assert.deepEqual(forbidden, []); assert.equal(downloads, 0);
  console.log("PASS: Isolated synthetic inspector: no startup storage reads, only explicit two-read inspection, zero storage writes/downloads/API or external requests, draft unchanged, redacted output, safe text rendering, desktop/mobile.");
} finally { await context.close(); await browser.close(); }
