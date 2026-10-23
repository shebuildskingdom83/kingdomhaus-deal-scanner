import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { unifiedWebsite } from "../scripts/unifiedWebsite";
import { syntheticLibrary } from "./syntheticSavedLibrary";

// These replacements exist only in this test server, never in the application config.
const authModule = `
 const listeners = new Set();
 let cachedUid, cachedUser;
 const user = () => { const uid = sessionStorage.getItem('synthetic-user'); if (uid !== cachedUid) { cachedUid = uid; cachedUser = uid ? { uid, getIdToken: async () => uid + '-token', getIdTokenResult: async () => ({ claims: {} }) } : null; } return cachedUser; };
 export const syntheticAuth = { authStateReady: async () => {}, get currentUser() { return user(); } };
 export function onAuthStateChanged(auth, callback) { listeners.add(callback); queueMicrotask(() => callback(user())); return () => listeners.delete(callback); }
 export const onIdTokenChanged = onAuthStateChanged;
 export function changeUser(uid) { uid ? sessionStorage.setItem('synthetic-user', uid) : sessionStorage.removeItem('synthetic-user'); for (const callback of listeners) callback(user()); }
 export async function signOut() { changeUser(null); }
`;
const fixture = syntheticLibrary(1)[0];
fixture.state.scan.financials.askingPrice.amount = 123_456_789;
const mocks: Plugin = {
  name: "synthetic-unified-browser-only", enforce: "pre",
  resolveId(id) { if (id === "firebase/auth") return "\0synthetic-auth"; },
  load(id) { if (id === "\0synthetic-auth") return authModule; },
  transform(_code, id) {
    if (id.endsWith("/src/firebaseClient.ts")) return `
      import { changeUser, syntheticAuth } from 'firebase/auth';
      export const founderUid = 'synthetic-founder', cloudEmulator = false;
      export const cloudConfigurationError = () => null;
      export function cloudSignIn() {
        sessionStorage.setItem('synthetic-popup-count', String(Number(sessionStorage.getItem('synthetic-popup-count') || 0) + 1));
        window.syntheticPopupActivation = navigator.userActivation.isActive;
        const popup = window.open('about:blank', 'synthetic-google', 'width=440,height=500');
        return new Promise((resolve, reject) => {
          if (!popup) { reject({ code: 'auth/popup-blocked' }); return; }
          popup.document.title = 'Synthetic Google sign-in';
          const closeCheck = setInterval(() => { if (popup.closed) { clearInterval(closeCheck); reject({ code: 'auth/popup-closed-by-user' }); } }, 25);
          for (const [label, uid, code] of [ ['Authorize founder', 'synthetic-founder'], ['Use unauthorized account', 'unauthorized-synthetic'], ['Cancel sign-in', null, 'auth/popup-closed-by-user'], ['Simulate network error', null, 'auth/network-request-failed'] ]) {
            const button = popup.document.createElement('button'); button.textContent = label;
            button.onclick = () => { clearInterval(closeCheck); if (code) reject({ code }); else { changeUser(uid); resolve({ user: syntheticAuth.currentUser }); } popup.close(); };
            popup.document.body.append(button);
          }
        });
      }
      export const cloudClient = () => ({ auth: syntheticAuth, repository: () => { window.syntheticRepositoryReads = (window.syntheticRepositoryReads || 0) + 1; return {}; } });
    `;
    if (id.endsWith("/src/useCloudAcquisitionRecovery.ts")) return `
      import { useState } from 'react';
      const record = ${JSON.stringify(fixture)};
      const blank = { scan: null, form: Object.fromEntries(Object.keys(record.state.form).map(key => [key, ''])), cashFlow: record.state.cashFlow };
      export function useCloudAcquisitionRecovery() {
        const [work, setWork] = useState(blank), [generation, setGeneration] = useState(0), [active, setActive] = useState(null);
        const noop = () => {};
        return { work, setWork, generation, active, records: [record], dirty: false, hasWork: !!work.scan,
          storageError: '', actionError: '', notice: '', confirmation: null,
          cloud: { ready: true, status: 'Saved', busy: false, retry: noop },
          newScan: () => { setWork(blank); setGeneration(g => g + 1); },
          open: () => { setWork(record.state); setActive(record); setGeneration(g => g + 1); },
          save: noop, rename: noop, remove: noop, importText: noop, exportCurrent: noop, exportRecord: noop,
          exportSavedCsv: noop, exportStoredRecovery: noop, reportError: noop, cancelConfirmation: noop, acceptConfirmation: noop };
      }
    `;
  }
};
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KH_PLAYWRIGHT_MODULE || "playwright");
const artifacts = resolve(".cloud-test-artifacts/unified");
await mkdir(artifacts, { recursive: true });
const server = await createServer({ configFile: false, cacheDir: "node_modules/.vite-unified-browser", plugins: [mocks, unifiedWebsite(), react()],
  server: { host: "127.0.0.1", port: 5181, strictPort: true } });
await server.listen();
const origin = "http://127.0.0.1:5181";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const forbidden: string[] = [], failures: string[] = [], cspViolations: string[] = [];
let apiProbe = false;
const syntheticApiHeaders: string[] = [];
await context.route("**/*", (route: any) => {
  const url = new URL(route.request().url());
  if (apiProbe && url.origin === origin && url.pathname === "/api/retrieval-config") {
    syntheticApiHeaders.push(route.request().headers().authorization ?? "");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false }) });
  }
  if (url.origin !== origin || url.pathname.startsWith("/api")) { forbidden.push(url.href); return route.abort(); }
  return route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.setDefaultNavigationTimeout(20000);
await page.exposeFunction("reportSyntheticCsp", (value: string) => cspViolations.push(value));
await page.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", event => (window as any).reportSyntheticCsp(event.violatedDirective + ": " + event.blockedURI));
});
page.on("pageerror", (error: Error) => failures.push(error.message));
page.on("response", (response: any) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
try {
  page.on("dialog", (dialog: any) => dialog.accept());
  await page.goto(origin);
  await page.locator("a.launch-control").first().waitFor();
  assert.equal(await page.locator("a.launch-control").count(), 4);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("synthetic-popup-count")), null);
  assert.equal(await page.evaluate(() => (window as any).syntheticRepositoryReads || 0), 0);
  for (let i = 0; i < 4; i++) {
    const link = page.locator("a.launch-control").nth(i);
    assert.equal(await link.getAttribute("href"), origin + "/cloud");
    assert.equal(await link.getAttribute("target"), "_self");
    const popupEvent = page.waitForEvent("popup");
    if (i === 0) { await link.focus(); await page.keyboard.press("Enter"); } else await link.click();
    const popup = await popupEvent;
    assert.equal(page.url(), origin + "/");
    assert.equal(await page.getByRole("button", { name: "Sign in with Google" }).count(), 0);
    assert.equal(await page.evaluate(() => (window as any).syntheticPopupActivation), true);
    assert.equal(await page.evaluate(() => (window as any).syntheticRepositoryReads || 0), 0);
    assert.equal(await page.locator('.launch-control[aria-busy="true"]').count(), 4);
    assert.equal(await page.getByText("Complete Google sign-in in the popup.", { exact: true }).count(), 0);
    await popup.getByRole("button", { name: "Authorize founder", exact: true }).click();
    await page.getByRole("heading", { name: "Acquisition Portfolio", exact: true }).waitFor();
    const destination = page.locator("#workspace-title");
    await page.waitForFunction(() => document.activeElement?.id === "workspace-title");
    assert.equal(await destination.evaluate((element: HTMLElement) => getComputedStyle(element).outlineStyle), "none");
    await page.keyboard.press("Tab");
    const keyboardFocus = await page.evaluate(() => ({
      name: document.activeElement?.textContent,
      visible: document.activeElement?.matches(":focus-visible"),
      outline: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : "none"
    }));
    assert.match(keyboardFocus.name || "", /Analyze an Opportunity/);
    assert.equal(keyboardFocus.visible, true);
    assert.notEqual(keyboardFocus.outline, "none");
    assert.equal(page.url(), origin + "/cloud");
    if (i === 0) {
      apiProbe = true;
      assert.equal(await page.evaluate(async () => {
        const modulePath = "/src/authenticatedApi.ts";
        const { authenticatedApi } = await import(modulePath);
        return (await authenticatedApi("/api/retrieval-config")).status;
      }), 200);
      apiProbe = false;
      assert.deepEqual(syntheticApiHeaders, ["Bearer synthetic-founder-token"]);
    }
    // The existing session returns directly, with no second popup.
    const popupCount = await page.evaluate(() => sessionStorage.getItem("synthetic-popup-count"));
    await page.getByRole("link", { name: "KingdomHaus Home" }).click();
    await page.locator("a.launch-control").first().waitFor();
    await page.reload();
    await page.locator("a.launch-control").nth(i).click();
    await page.getByRole("heading", { name: "Acquisition Portfolio", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem("synthetic-popup-count")), popupCount);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.locator("a.launch-control").first().waitFor();
    assert.equal(page.url(), origin + "/");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("synthetic-user")), null);
  }
  for (const width of [1440, 1100, 1024, 390]) {
    console.log(`Checking authentication navigation at ${width}px`);
    await page.setViewportSize({ width, height: 900 });
    for (const [intent, label] of [["signin", "Sign In"], ["create", "Create an Account"]]) {
      await page.goto(origin); await page.locator("a.launch-control").first().waitFor();
      if (width === 390) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      const control = page.getByRole("button", { name: label, exact: true });
      const box = await control.boundingBox(); assert.ok(box && box.height >= 44);
      await control.focus();
      const canceledEvent = page.waitForEvent("popup"); await page.keyboard.press("Enter");
      const canceledPopup = await canceledEvent;
      assert.equal(page.url(), origin + "/");
      assert.equal(await page.locator("#navigation-auth-status").textContent(), "");
      assert.equal(await page.getByText("Complete Google sign-in in the popup.", { exact: true }).count(), 0);
      await canceledPopup.close();
      await page.waitForFunction(() => !document.querySelector('[data-cloud-auth][aria-busy="true"]'));
      assert.equal(await page.locator("#navigation-auth-status").textContent(), "");
      if (intent === "create") {
        const headerBefore = await page.locator(".floating-nav").boundingBox();
        const deniedEvent = page.waitForEvent("popup"); await control.click();
        const deniedPopup = await deniedEvent;
        await deniedPopup.getByRole("button", { name: "Use unauthorized account", exact: true }).click();
        const denied = page.getByRole("alert").filter({ hasText: "Your Google account is connected. Workspace access is not enabled." });
        await denied.waitFor(); await noOverflow();
        assert.equal(await page.locator("header [role=alert]").count(), 0);
        const headerAfter = await page.locator(".floating-nav").boundingBox();
        assert.equal(headerAfter?.height, headerBefore?.height);
        assert.equal(await page.locator("[data-auth-feedback]").isVisible(), true);
        if (width > 1000) {
          const boxes = await page.locator(".nav-links > a, .navigation-auth").evaluateAll((elements: Element[]) => elements.map(element => { const b = element.getBoundingClientRect(); return { left:b.left, right:b.right, top:b.top, bottom:b.bottom }; }));
          for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].left >= boxes[i-1].right, "Desktop navigation must not collide or wrap");
        }
        assert.equal(page.url(), origin + "/");
        assert.equal(await page.evaluate(() => (window as any).syntheticRepositoryReads || 0), 0);
        assert.equal(await page.locator(".acquisition-workspace").count(), 0);
        await page.screenshot({ path: resolve(artifacts, `create-account-no-access-${width}.png`) });
        await page.waitForFunction(() => !document.querySelector('[data-cloud-auth][aria-busy="true"]'));
        await page.getByRole("button", { name: "Sign Out", exact: true }).click();
        await page.waitForFunction(() => !sessionStorage.getItem("synthetic-user"));
        assert.equal(await control.evaluate((element: Element) => element === document.activeElement), true);
      }
      const authorizedEvent = page.waitForEvent("popup"); await control.click();
      const authorizedPopup = await authorizedEvent;
      await authorizedPopup.getByRole("button", { name: "Authorize founder", exact: true }).click();
      await page.getByRole("heading", { name: "Acquisition Portfolio", exact: true }).waitFor();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.locator("a.launch-control").first().waitFor();
    }
  }
  // Closed popups are quiet; genuine errors remain accessible and can be retried.
  for (const action of ["close", "Simulate network error", "Use unauthorized account"]) {
    const popupEvent = page.waitForEvent("popup");
    await page.locator("a.launch-control").first().click();
    const popup = await popupEvent;
    if (action === "close") await popup.close();
    else await popup.getByRole("button", { name: action, exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.launch-control[aria-busy="true"]'));
    assert.equal(page.url(), origin + "/");
    assert.equal(await page.evaluate(() => (window as any).syntheticRepositoryReads || 0), 0);
    if (action === "close") {
      assert.equal(await page.locator("#hero-launch-status").textContent(), "");
      assert.equal(await page.locator("a.launch-control").first().evaluate((element: Element) => element === document.activeElement), true);
    } else {
      const alert = page.getByRole("alert"); await alert.waitFor();
      assert.match(await alert.textContent(), action === "Simulate network error" ? /Connection issue.*try again/ : /doesn't have access/);
      assert.equal(await page.locator("a.launch-control").first().getAttribute("aria-describedby"), await alert.getAttribute("id"));
      await page.screenshot({ path: resolve(artifacts, `landing-feedback-${action === "Simulate network error" ? "error" : "denied"}.png`), fullPage: true });
    }
  }
  // The now-restored unauthorized session cannot launch another popup or read records.
  const popupCount = await page.evaluate(() => sessionStorage.getItem("synthetic-popup-count"));
  await page.reload(); await page.locator("a.launch-control").first().click();
  await page.getByRole("alert").filter({ hasText: "doesn't have access" }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem("synthetic-popup-count")), popupCount);
  assert.equal(await page.evaluate(() => (window as any).syntheticRepositoryReads || 0), 0);
  await page.evaluate(() => sessionStorage.removeItem("synthetic-user"));
  await page.reload(); await page.locator("a.launch-control").first().waitFor();
  assert.deepEqual(cspViolations, []);
  // Dynamic photos, financial controls, walkthrough, and mobile navigation still initialize.
  await page.locator("#demo-case").selectOption("manufacturing");
  assert.match(await page.locator("#sample-photo").getAttribute("src"), /^\/__kingdomhaus\/assets\//);
  await page.locator("#demo-case").selectOption("painting");
  const cashBefore = await page.locator("#teaser-annual").textContent();
  await page.locator("#teaser-owner-range").evaluate((input: HTMLInputElement) => {
    input.value = input.value === input.max ? input.min : input.max;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.notEqual(await page.locator("#teaser-annual").textContent(), cashBefore);
  await page.locator('.demo-tabs label').filter({ hasText: "Deal Clarity" }).click();
  assert.equal(await page.locator('[data-panel="clarity"]').isVisible(), true);
  await page.locator('.demo-tabs label').filter({ hasText: "Financial Snapshot" }).click();
  await page.locator('[data-ai-stage="1"]').click();
  assert.equal(await page.locator('[data-ai-panel="1"]').isVisible(), true);
  await page.getByRole("button", { name: "Reset analysis walkthrough" }).click();
  assert.equal(await page.locator("#ai-analysis").getAttribute("data-state"), "idle");
  await page.locator('[data-step="2"]').click();
  assert.equal(await page.locator("#workflow-visual-2").isVisible(), true);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (let i = 0; i < 4; i++) {
      const popupEvent = page.waitForEvent("popup");
      await page.locator("a.launch-control").nth(i).click();
      const popup = await popupEvent;
      await popup.getByRole("button", { name: "Simulate network error", exact: true }).click();
      const alert = page.getByRole("alert"); await alert.waitFor();
      await alert.scrollIntoViewIfNeeded();
      const box = await alert.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width);
      await noOverflow();
      await page.screenshot({ path: resolve(artifacts, `launch-feedback-${i}-${width}.png`) });
    }
  }
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(async () => { for (const image of document.images) { image.loading = 'eager'; await image.decode().catch(() => {}); } });
    await noOverflow();
    assert.equal(await page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)), true);
    if (width === 390) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      assert.equal(await page.locator("#menu-toggle").getAttribute("aria-expanded"), "true");
      await page.locator("#nav-links").getByRole("link", { name: "Deal Preview", exact: true }).click();
    }
    await page.screenshot({ path: resolve(artifacts, `homepage-${width}.png`), fullPage: true });
  }
  await page.goto(origin + "/cloud");
  await page.getByRole("button", { name: "Sign in with Google" }).waitFor();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await noOverflow();
    const title = await page.getByRole("heading", { name: "Deal Scanner", exact: true }).boundingBox();
    const home = await page.getByRole("link", { name: "KingdomHaus Home" }).boundingBox();
    assert.ok(title && home && (title.x + title.width <= home.x || title.y + title.height <= home.y), "Home must not overlap scanner branding");
    await page.screenshot({ path: resolve(artifacts, `signin-${width}.png`), fullPage: true });
  }
  await page.evaluate(() => sessionStorage.setItem("synthetic-user", "unauthorized-synthetic"));
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "This account doesn't have access" }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).syntheticRepositoryReads || 0), 0);
  assert.equal(await page.locator(".acquisition-workspace").count(), 0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator("a.launch-control").first().waitFor();
  await page.goto(origin + "/cloud");
  const fallbackPopupEvent = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  const fallbackPopup = await fallbackPopupEvent;
  await fallbackPopup.getByRole("button", { name: "Authorize founder", exact: true }).click();
  await page.getByRole("heading", { name: "Acquisition Portfolio", exact: true }).waitFor();
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await noOverflow();
    assert.equal(await page.locator(".portfolio-metric").count(), 3);
    assert.equal(await page.locator(".portfolio-metric-value > dd").first().textContent(), "$123,456,789");
    assert.equal(await page.locator(".portfolio-metric").nth(2).locator("dd").first().textContent(), "0");
    const boxes = await page.locator(".portfolio-metric").evaluateAll((elements: Element[]) => elements.map(element => {
      const box = element.getBoundingClientRect(); return { width: box.width, height: box.height, x: box.x, y: box.y };
    }));
    if (width > 760) {
      assert.ok(boxes.every((box: any) => Math.abs(box.width - boxes[0].width) < 1 && box.y === boxes[0].y && box.height === boxes[0].height));
    } else assert.ok(boxes[1].y > boxes[0].y && boxes[2].y > boxes[1].y);
    await page.screenshot({ path: resolve(artifacts, `portfolio-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Analyze an Opportunity" }).click();
  await page.getByRole("button", { name: "Return to Workspace" }).click();
  await page.getByRole("heading", { name: "Acquisition Portfolio", exact: true }).waitFor();
  await page.getByRole("button", { name: /^View Analysis/ }).click();
  await page.getByRole("button", { name: "Return to Workspace" }).waitFor();
  await noOverflow();
  await page.getByRole("button", { name: "Return to Workspace" }).click();
  await page.getByRole("link", { name: "KingdomHaus Home" }).click();
  await page.locator("a.launch-control").first().waitFor();
  await page.goBack();
  await page.getByRole("heading", { name: "Acquisition Portfolio", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Acquisition Portfolio", exact: true }).waitFor();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator("a.launch-control").first().waitFor();
  await page.reload();
  await page.locator("a.launch-control").first().waitFor();
  await page.goBack();
  await page.getByRole("button", { name: "Sign in with Google" }).waitFor();
  assert.equal(await page.locator(".acquisition-workspace").count(), 0);
  assert.equal(await page.evaluate(() => (window as any).syntheticRepositoryReads || 0), 0);
  assert.equal(context.pages().length, 1);
  assert.deepEqual(forbidden, []); assert.deepEqual(failures, []); assert.deepEqual(cspViolations, []);
  console.log("PASS: all four controls launch a synthetic popup directly from user/keyboard activation; existing sessions skip the popup; cancellation, error/retry, unauthorized denial; public home; protected direct route; founder portfolio and analysis/return; sign-out returns home and clears session; safe refresh/back; desktop/mobile assets/overflow; no CSP violations or API/external requests.");
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await context.close(); await browser.close(); await server.close();
}
