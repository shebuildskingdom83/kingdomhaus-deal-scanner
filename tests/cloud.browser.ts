import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
import { FirestoreAcquisitionRepository } from "../src/firestoreAcquisitionRepository";
import { syntheticLibrary } from "./syntheticSavedLibrary";
import { serializeBackup } from "../src/storage";
import { syntheticFounderRules } from "../scripts/founderRules";

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") throw new Error("Local synthetic emulators are required. Live Firebase is forbidden.");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KH_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.KH_CLOUD_BROWSER_BASE || "http://localhost:5176";
const target = new URL(base);
if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.protocol !== "http:" || target.pathname !== "/" || target.search || target.hash) throw new Error("Cloud browser tests require a loopback-only base URL.");
const artifacts = resolve(".cloud-test-artifacts"); mkdirSync(artifacts, { recursive: true });
const environment = await initializeTestEnvironment({ projectId: "demo-kingdomhaus", firestore: {
  host: "127.0.0.1", port: 8080, rules: syntheticFounderRules()
} });
await environment.clearFirestore();
const repo = new FirestoreAcquisitionRepository(environment.authenticatedContext("synthetic-founder").firestore() as unknown as Firestore, "synthetic-founder");
const records = syntheticLibrary();
for (const record of records) await repo.save(record, null);
const imported = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-kingdomhaus/accounts:batchCreate", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
  body: JSON.stringify({ users: [{ localId: "synthetic-founder", email: "founder@example.test", emailVerified: true,
    providerUserInfo: [{ providerId: "google.com", rawId: "synthetic-google-founder", email: "founder@example.test" }] }] })
});
assert.equal(imported.ok, true);
const browser = await chromium.launch({ channel: "chrome", headless: true });
let downloads = 0;
const forbidden: string[] = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
// Test browser is isolated. Only loopback resources are permitted, including images.
await context.route("**/*", (route: any) => {
  const url = new URL(route.request().url());
  if (!["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol !== "data:") { forbidden.push(url.origin); return route.abort(); }
  if (url.pathname.startsWith("/api/")) { forbidden.push(url.pathname); return route.abort(); }
  return route.continue();
});
const page = await context.newPage();
page.on("download", () => downloads++);
const cloudSettled = async (target = page) => {
  await target.locator(".acquisition-recovery").waitFor();
  await target.locator(".recovery-state").filter({ hasText: /^(Saving|Offline|Error)/ }).waitFor({ state: "hidden" });
};
const signIn = async (target = page) => {
  await target.goto(base + "/cloud");
  await target.getByRole("button", { name: "Sign in with Google" }).waitFor();
  if (target === page) {
    for (const [label, width, height] of [["desktop", 1440, 1000], ["tablet", 768, 1024], ["mobile", 390, 844], ["small-mobile", 320, 740]] as const) {
      await target.setViewportSize({ width, height });
      const card = target.getByRole("region", { name: "Cloud account" });
      await card.getByRole("heading", { name: "Sign in to Deal Scanner" }).waitFor();
      assert.equal(await card.getByText("Access your saved acquisitions.", { exact: true }).count(), 1);
      const cardBox = (await card.boundingBox())!;
      const button = card.getByRole("button", { name: "Sign in with Google" });
      const buttonBox = (await button.boundingBox())!;
      const headerBox = (await target.locator(".app-header").boundingBox())!;
      assert.ok(cardBox.width <= 440 && cardBox.y >= headerBox.y + headerBox.height);
      assert.ok(Math.abs(cardBox.x + cardBox.width / 2 - width / 2) < 2);
      assert.ok(buttonBox.height >= 44 && buttonBox.width < cardBox.width - 32);
      await button.focus();
      assert.equal(await button.evaluate((element: Element) => element === document.activeElement), true);
      assert.equal(await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await target.screenshot({ path: resolve(artifacts, "cloud-signin-" + label + ".png"), fullPage: true });
    }
    await target.setViewportSize({ width: 1440, height: 1000 });
  }
  // Emulator Google credentials exercise the real SDK and auth-state listener
  // without downloading Google's external popup bootstrap or visiting OAuth.
  await target.evaluate(async () => {
    const clientPath = "/src/firebaseClient.ts";
    const sdkPath = "/node_modules/.vite/deps/firebase_auth.js";
    const client = await import(/* @vite-ignore */ clientPath);
    const sdk = await import(/* @vite-ignore */ sdkPath);
    if (!client.cloudEmulator || client.cloudClient().app.options.projectId !== "demo-kingdomhaus") throw new Error("Synthetic browser credentials must never target live Firebase.");
    await sdk.signInWithCredential(client.cloudClient().auth,
      sdk.GoogleAuthProvider.credential(JSON.stringify({ sub: "synthetic-google-founder", email: "founder@example.test", email_verified: true })));
  });
  await target.getByRole("heading", { name: "Acquisition Portfolio", exact: true }).waitFor();
};
try {
  await signIn();
  assert.equal(await page.locator(".app-header").count(), 1);
  assert.equal(await page.locator('.app-header').getByRole("button", { name: "Sign out", exact: true }).count(), 1);
  for (const [label, width, height] of [["desktop", 1440, 1000], ["tablet", 768, 1024], ["mobile", 390, 844], ["small-mobile", 320, 740]] as const) {
    await page.setViewportSize({ width, height });
    const header = page.locator(".app-header");
    const logo = (await header.getByRole("img", { name: "KingdomHaus logo" }).boundingBox())!;
    const accessibleTitle = header.getByRole("heading", { name: "Deal Scanner", exact: true });
    const title = (await accessibleTitle.boundingBox())!;
    const signOut = (await header.getByRole("button", { name: "Sign out", exact: true }).boundingBox())!;
    const headerBox = (await header.boundingBox())!;
    assert.equal(await accessibleTitle.evaluate((element: HTMLElement) => getComputedStyle(element).clipPath), "inset(50%)");
    assert.equal(title.width, 1); assert.equal(title.height, 1);
    assert.ok(logo.x + logo.width <= signOut.x);
    assert.ok(signOut.x + signOut.width <= headerBox.x + headerBox.width && signOut.y >= headerBox.y);
    assert.ok(signOut.y + signOut.height <= headerBox.y + headerBox.height && signOut.height >= 44);
    assert.equal(await header.getByText("KingdomHaus Intelligence", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await header.screenshot({ path: resolve(artifacts, "cloud-branding-" + label + ".png") });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await page.getByText("KingdomHaus cloud workspace", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Reload cloud workspace" }).count(), 0);
  assert.equal(await page.locator(".acquisition-recovery").count(), 1);
  assert.equal(await page.locator(".saved-acquisitions").count(), 1);
  assert.equal(await page.locator(".backup-management").count(), 1);
  assert.equal(await page.getByRole("button", { name: "Return to Workspace" }).count(), 0);
  assert.equal(await page.getByRole("searchbox").count(), 1);
  assert.equal(await page.getByRole("button", { name: "Export Portfolio as CSV" }).count(), 1);
  await page.getByText("Page 1 of 6", { exact: true }).waitFor();
  assert.equal(await page.locator(".saved-acquisition-list > li").count(), 10);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Page 2 of 6", { exact: true }).waitFor();
  await page.getByRole("searchbox").fill("METAL wo");
  await page.getByText("Page 1 of 3", { exact: true }).waitFor();
  await page.getByRole("searchbox").fill("nonexistent");
  await page.getByText("No acquisitions match your search.", { exact: true }).waitFor();
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const row = page.locator(".saved-acquisition-list > li").first();
  const name = await row.locator("strong").innerText();
  await row.getByRole("button", { name: /^View Analysis/ }).click();
  const expectedId = records.find(record => record.name === name)?.id;
  for (let attempt = 0; attempt < 100 && (await repo.loadDraft()).value?.recordId !== expectedId; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  await cloudSettled();
  await page.reload();
  await cloudSettled();
  assert.equal((await repo.loadDraft()).value?.recordId, expectedId);
  await page.getByRole("heading", { name: "Acquisition Portfolio", exact: true }).waitFor();
  await page.getByRole("button", { name: "Continue Analysis", exact: true }).click();
  const beforeOffline = await repo.loadDraft();
  await page.locator("summary").filter({ hasText: "Review or correct extracted values" }).click();
  await context.setOffline(true);
  await page.getByLabel("Business name", { exact: true }).fill("Synthetic offline draft correction");
  await page.locator(".recovery-state").filter({ hasText: /^Offline/ }).waitFor();
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal((await repo.loadDraft()).revision, beforeOffline.revision);
  await context.setOffline(false);
  await cloudSettled();
  assert.equal((await repo.loadDraft()).value?.state.form.businessName, "Synthetic offline draft correction");
  assert.notEqual((await repo.get(expectedId!)).state.form.businessName, "Synthetic offline draft correction");
  const beforeConflict = await repo.loadDraft();
  const otherDraft = structuredClone(beforeConflict.value!);
  otherDraft.state.form.businessName = "Synthetic competing cloud edit";
  await repo.saveDraft(otherDraft, beforeConflict.revision);
  await page.getByLabel("Business name", { exact: true }).fill("Synthetic pending conflict edit");
  await page.locator(".recovery-state").filter({ hasText: /^Error/ }).waitFor();
  const reload = page.getByRole("button", { name: "Reload cloud workspace", exact: true });
  assert.equal(await reload.count(), 1);
  page.once("dialog", (dialog: any) => dialog.dismiss()); await reload.click();
  assert.equal((await repo.loadDraft()).value?.state.form.businessName, "Synthetic competing cloud edit");
  page.once("dialog", (dialog: any) => dialog.accept()); await reload.click();
  await cloudSettled();
  assert.equal(await page.getByRole("button", { name: "Reload cloud workspace" }).count(), 0);
  await page.reload();
  await cloudSettled();
  await page.getByRole("heading", { name: "Acquisition Portfolio", exact: true }).waitFor();
  await page.screenshot({ path: resolve(artifacts, "cloud-desktop.png"), fullPage: true });
  await page.locator(".app-header").screenshot({ path: resolve(artifacts, "cloud-header-desktop.png") });
  await page.setViewportSize({ width: 768, height: 1024 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(artifacts, "cloud-mobile.png"), fullPage: true });
  await page.locator(".app-header").screenshot({ path: resolve(artifacts, "cloud-header-mobile.png") });
  await page.getByRole("button", { name: "Sign out", exact: true }).focus();
  assert.equal(await page.getByRole("button", { name: "Sign out", exact: true }).evaluate((element: Element) => element === document.activeElement), true);
  page.once("dialog", (dialog: any) => dialog.dismiss());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  assert.equal(await page.locator(".acquisition-recovery").count(), 1);
  await page.locator(".acquisition-recovery").screenshot({ path: resolve(artifacts, "cloud-controls-mobile.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  const databaseNames = await page.evaluate(async () => (await indexedDB.databases()).map(database => database.name));
  assert.equal(databaseNames.some((name: string) => name?.includes("firestore")), false);
  assert.equal(downloads, 0);
  assert.deepEqual(forbidden, []);
  const recovered = await repo.loadDraft();
  const id = recovered.value!.recordId!;
  assert.equal(JSON.parse(serializeBackup(await repo.get(id))).record.id, id);
  await context.close();
  // A new browser context must sign in again; acquisition state is recovered only from the server.
  const restarted = await browser.newContext();
  const restartedPage = await restarted.newPage();
  await restartedPage.goto(base + "/cloud");
  await restartedPage.getByRole("button", { name: "Sign in with Google" }).waitFor();
  assert.equal(await restartedPage.evaluate(() => localStorage.length), 0);
  await signIn(restartedPage);
  await cloudSettled(restartedPage);
  assert.equal((await repo.loadDraft()).value?.recordId, expectedId);
  await restarted.close();
  console.log("PASS: Emulated Google credential sign-in, 53-record search/pagination, later-page open, refresh recovery, offline-edit retention/reconnect saving without changing the named record, desktop/mobile, no persistent acquisition cache or automatic downloads, and fresh-session reauthentication/recovery. Real Google OAuth remains a founder setup check.");
} catch (error) {
  console.log("Synthetic browser failure:", (await page.locator("body").innerText()).slice(0, 2000), "Blocked network origins:", forbidden);
  await page.screenshot({ path: resolve(artifacts, "cloud-failure.png"), fullPage: true });
  throw error;
} finally { await browser.close(); await environment.cleanup(); }
