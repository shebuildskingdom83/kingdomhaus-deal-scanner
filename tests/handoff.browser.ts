import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { migrationFixtures } from "./cloudMigrationFixtures";
import { syntheticMigrationRules } from "../scripts/migrationRules";
import { sameMigrationContent } from "../src/cloudMigration";
import { FirestoreAcquisitionRepository } from "../src/firestoreAcquisitionRepository";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") throw new Error("Demo emulators required. Live Firebase forbidden.");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KH_PLAYWRIGHT_MODULE || "playwright");
const environment = await initializeTestEnvironment({ projectId: "demo-kingdomhaus", firestore: { host: "127.0.0.1", port: 8080, rules: syntheticMigrationRules() } });
await environment.clearFirestore();
const db = environment.authenticatedContext("synthetic-founder").firestore() as unknown as Firestore;
const repository = new FirestoreAcquisitionRepository(db, "synthetic-founder");
const records = migrationFixtures();
const draftSentinel = "SYNTHETIC-RECOVERY-DRAFT-NEVER-TRANSFER";
const draft = { recordId: null, recordRevision: null, state: { ...records[0].state,
  cashFlow: { ...records[0].state.cashFlow, normalizationNotes: draftSentinel } } };
const raw = JSON.stringify({ schemaVersion: 2, records, draft });
const imported = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-kingdomhaus/accounts:batchCreate", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
  body: JSON.stringify({ users: [{ localId: "synthetic-founder", email: "founder@example.test", emailVerified: true,
    providerUserInfo: [{ providerId: "google.com", rawId: "synthetic-handoff-founder", email: "founder@example.test" }] }] })
});
assert.equal(imported.ok, true);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
const forbidden: string[] = [], failedOrigins: string[] = []; let downloads = 0, cspErrors = 0;
// Exact origins exercise postMessage. Only the static receiver HTML uses its real
// loopback server (so Chrome knows its address space); ALL modules use demo code.
// No live Firebase API or existing browser profile is used.
await context.route("**/*", async (route: any) => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith("/api/") || ["/src/App.tsx", "/src/CloudApp.tsx"].includes(url.pathname)) {
    forbidden.push(url.origin); return route.abort();
  }
  if (url.origin === "http://localhost:5176") {
    if (url.pathname === "/migration-receiver.html" && route.request().isNavigationRequest()) return route.continue();
    const response = await route.fetch({ url: "http://127.0.0.1:5178" + url.pathname + url.search });
    return route.fulfill({ response });
  }
  if (!["http://localhost:5173", "http://127.0.0.1:8080", "http://127.0.0.1:9099"].includes(url.origin)) {
    forbidden.push(url.origin); return route.abort();
  }
  return route.continue();
});
await context.routeWebSocket("**", (socket: any) => socket.close());
await context.addInitScript({ content: `(() => {
  const payloadAudit = { containsDraft: false, recordPackets: 0 };
  Object.defineProperty(window, "syntheticPayloadAudit", { value: payloadAudit });
  window.addEventListener("message", event => {
    if (event.origin !== "http://localhost:5173" || event.data?.type !== "records") return;
    payloadAudit.recordPackets++;
    if (JSON.stringify(event.data).includes(${JSON.stringify(draftSentinel)}) || "draft" in event.data) payloadAudit.containsDraft = true;
  });
  if (location.origin !== "http://localhost:5173") return;
  const raw = ${JSON.stringify(raw)}, get = Storage.prototype.getItem, set = Storage.prototype.setItem;
  if (get.call(localStorage, "kingdomhaus-deal-scans:v1") === null) set.call(localStorage, "kingdomhaus-deal-scans:v1", raw);
  const audit = { reads: 0, writes: 0, unchanged: () => get.call(localStorage, "kingdomhaus-deal-scans:v1") === raw };
  Object.defineProperty(window, "syntheticHandoffAudit", { value: audit });
  Storage.prototype.getItem = function(key) { if (this === localStorage && key === "kingdomhaus-deal-scans:v1") audit.reads++; return get.call(this,key); };
  for (const method of ["setItem", "removeItem", "clear"]) Object.defineProperty(Storage.prototype, method, { value: function(...args) {
    if (this === localStorage) { audit.writes++; throw new Error("Source storage writes forbidden"); }
    return method === "setItem" ? set.apply(this,args) : undefined;
  } });
})();` });
context.on("page", (page: any) => {
  page.on("download", () => downloads++);
  page.on("requestfailed", (request: any) => failedOrigins.push(new URL(request.url()).origin + " " + (request.failure()?.errorText ?? "failed")));
  page.on("console", (message: any) => { if (/Content Security Policy|connect-src/i.test(message.text())) cspErrors++; });
});
const source = await context.newPage();
async function syntheticSignIn(receiver: any) {
  await receiver.evaluate(async () => {
    const path = "/src/firebaseClient.ts", sdkPath = "/node_modules/.vite/deps/firebase_auth.js";
    const client = await import(/* @vite-ignore */ path), sdk = await import(/* @vite-ignore */ sdkPath);
    if (!client.cloudEmulator || client.cloudClient().app.options.projectId !== "demo-kingdomhaus") throw new Error("Live Firebase forbidden.");
    await sdk.signInWithCredential(client.cloudClient().auth, sdk.GoogleAuthProvider.credential(JSON.stringify({
      sub: "synthetic-handoff-founder", email: "founder@example.test", email_verified: true
    })));
  });
}
try {
  await source.goto("http://localhost:5173/migration-source.html");
  await source.getByRole("button", { name: "Connect receiver", exact: true }).waitFor();
  assert.equal(await source.evaluate(() => (window as any).syntheticHandoffAudit.reads), 0);
  assert.equal((await repository.list()).length, 0);
  for (const retry of [false, true]) {
    const popup = source.waitForEvent("popup");
    await source.getByRole("button", { name: "Connect receiver", exact: true }).click();
    const receiver = await popup;
    await receiver.getByRole("button", { name: "Connect founder session", exact: true }).waitFor();
    assert.equal(await receiver.getByRole("button", { name: "Confirm create-only migration", exact: true }).isEnabled(), false);
    assert.equal((await repository.list()).length, retry ? 4 : 0);
    await receiver.getByRole("button", { name: "Connect founder session", exact: true }).click();
    await syntheticSignIn(receiver);
    const send = source.getByRole("button", { name: "Send four approved records in memory", exact: true });
    await send.waitFor({ state: "visible" });
    for (let i = 0; i < 50 && !await send.isEnabled(); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await send.isEnabled(), true);
    assert.equal((await repository.list()).length, retry ? 4 : 0);
    if (!retry) {
      assert.equal(await source.evaluate(() => (window as any).syntheticHandoffAudit.reads), 0);
      source.once("dialog", (dialog: any) => dialog.dismiss()); await send.click();
      assert.equal(await source.evaluate(() => (window as any).syntheticHandoffAudit.reads), 0);
    }
    source.once("dialog", (dialog: any) => dialog.accept()); await send.click();
    await receiver.getByText("Four validated records received in memory. No cloud writes. Review cloud conflicts next.", { exact: true }).waitFor();
    assert.deepEqual(await receiver.evaluate(() => (window as any).syntheticPayloadAudit), { containsDraft: false, recordPackets: 1 });
    assert.equal((await repository.list()).length, retry ? 4 : 0);
    await receiver.getByRole("button", { name: "Review cloud conflicts", exact: true }).click();
    await receiver.getByText("Read-only cloud conflict review passed. Explicit create-only confirmation is still required.", { exact: true }).waitFor();
    const execute = receiver.getByRole("button", { name: "Confirm create-only migration", exact: true });
    receiver.once("dialog", (dialog: any) => dialog.dismiss()); await execute.click();
    assert.equal((await repository.list()).length, retry ? 4 : 0);
    receiver.once("dialog", (dialog: any) => dialog.accept()); await execute.click();
    await receiver.getByText("Server readback verified all four records. Local originals remain unchanged. Cutover and cleanup are not authorized.", { exact: true }).waitFor({ timeout: 60000 });
    const receipt = JSON.parse(await receiver.locator("#summary").innerText());
    assert.deepEqual(receipt, { verifiedCount: 4, createdCount: retry ? 0 : 4, identicalRetryCount: retry ? 4 : 0 });
    for (const record of records) {
      assert.equal(sameMigrationContent(await repository.getForMigration(record.id), record), true);
      const data = (await getDoc(doc(db, "users", "synthetic-founder", "acquisitions", record.id))).data()!;
      assert.equal(data.revision, 1); assert.equal(data.migrationRevisionOffset ?? 0, record.revision - 1);
      assert.equal(JSON.stringify(data).includes(draftSentinel), false);
    }
    assert.equal((await getDocs(collection(db, "users", "synthetic-founder", "sourceKeys"))).size, 4);
    assert.deepEqual(await repository.loadDraft(), { revision: 0, value: null });
    assert.equal(await source.evaluate(() => (window as any).syntheticHandoffAudit.unchanged()), true);
    assert.equal(await source.evaluate(() => (window as any).syntheticHandoffAudit.writes), 0);
    await receiver.reload();
    await receiver.getByRole("button", { name: "Connect founder session", exact: true }).waitFor();
    assert.equal(await receiver.getByRole("button", { name: "Confirm create-only migration", exact: true }).isEnabled(), false);
    assert.equal((await repository.list()).length, 4);
    await receiver.close();
  }
  await source.reload();
  await source.getByText("Not connected. No storage has been read.", { exact: true }).waitFor();
  assert.equal(await source.evaluate(() => (window as any).syntheticHandoffAudit.reads), 0);
  assert.equal(await source.getByRole("button", { name: "Send four approved records in memory", exact: true }).isEnabled(), false);
  const direct = await context.newPage(); await direct.goto("http://localhost:5176/migration-receiver.html");
  await direct.getByText("Disabled without the exact local cloud origin and its bound source window.", { exact: true }).waitFor();
  assert.equal((await repository.list()).length, 4); assert.equal(downloads, 0); assert.deepEqual(forbidden, []);
  console.log("PASS: Synthetic two-window handoff with populated recovery draft, complete original storage byte-for-byte unchanged, draft absent from transfer payloads and cloud copies, exact origins/window binding, manual consent and cloud confirmation, four exact historical readbacks, zero duplicate retries, no draft writes/downloads/live requests, refresh/direct-entry cannot auto-run.");
} catch (error) {
  console.log("Synthetic handoff diagnostics:", JSON.stringify({ forbiddenOrigins: forbidden, failedOrigins, cspErrors }));
  throw error;
} finally { await context.close(); await browser.close(); await environment.cleanup(); }
