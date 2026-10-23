import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const native = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: native.request }));
import { isPublicAddress, pinnedLookup, publicListingFetch, resolvePublicUrl } from "../server/publicListingTransport";

beforeEach(() => { native.request.mockReset(); vi.stubGlobal("fetch", () => { throw Error("Outbound fetch forbidden"); }); });
afterEach(() => vi.unstubAllGlobals());
describe("public HTTPS transport with pinned DNS and fake TLS", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "::ffff:127.0.0.1", "::ffff:7f00:1", "fe80::1", "fc00::1", "2002:7f00:1::", "2001:db8::1"])("blocks private/special address %s", address => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("retains legitimate public IP %s", address => expect(isPublicAddress(address)).toBe(true));
  it.each(["http://public.test", "https://user:password@public.test", "https://public.test:444", "https://localhost", "https://[::ffff:127.0.0.1]/", "https://2130706433/"])("blocks unsafe URL %s without connecting", async url => {
    await expect(publicListingFetch(url, {}, async () => [{ address: "93.184.216.34", family: 4 }])).rejects.toBeTruthy();
    expect(native.request).not.toHaveBeenCalled();
  });
  it("rejects a mixed public/private DNS answer before connecting", async () => {
    await expect(resolvePublicUrl("https://mixed.test", async () => [{ address: "8.8.8.8", family: 4 }, { address: "::ffff:127.0.0.1", family: 6 }])).rejects.toThrow(/network/);
    expect(native.request).not.toHaveBeenCalled();
  });
  it("pins the validated IP across DNS rebinding while retaining original TLS hostname", async () => {
    const resolve = vi.fn().mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    native.request.mockImplementation((url, options, response) => {
      expect(url.hostname).toBe("public.test"); expect(options.agent).toBe(false); expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.rejectUnauthorized).not.toBe(false);
      const cb = vi.fn(); options.lookup("public.test", {}, cb); expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => queueMicrotask(() => {
        const res = Object.assign(new EventEmitter(), { headers: { "content-type": "text/html" }, statusCode: 200, destroy: vi.fn() });
        response(res); res.emit("data", Buffer.from("<p>Synthetic public listing</p>")); res.emit("end");
      }); return req;
    });
    const result = await publicListingFetch("https://public.test/listing", {}, resolve);
    expect(await result.text()).toContain("Synthetic"); expect(resolve).toHaveBeenCalledTimes(1);
    const all = vi.fn(); pinnedLookup({ address: "8.8.8.8", family: 4 })("ignored.test", { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
  });
  it("does not resolve or connect an already aborted request", async () => {
    const resolve = vi.fn(); await expect(publicListingFetch("https://public.test", { signal: AbortSignal.abort() }, resolve)).rejects.toBeTruthy();
    expect(resolve).not.toHaveBeenCalled(); expect(native.request).not.toHaveBeenCalled();
  });
});
