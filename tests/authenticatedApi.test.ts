import { afterEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ ready: vi.fn(async () => {}), token: vi.fn(async () => "synthetic-sdk-token") }));
vi.mock("../src/firebaseClient", () => ({ cloudClient: () => ({ auth: { authStateReady: sdk.ready, currentUser: { getIdToken: sdk.token } } }) }));
import { authenticatedApi, createAuthenticatedRequest } from "../src/authenticatedApi";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("shared authenticated API transport", () => {
  it("uses the existing session restoration and SDK token in the actual default helper", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", transport);
    await authenticatedApi("/api/retrieval-config");
    expect(sdk.ready).toHaveBeenCalledTimes(1); expect(sdk.token).toHaveBeenCalledWith();
    expect(new Headers(transport.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer synthetic-sdk-token");
  });
  it("obtains the SDK-managed token for every request without persisting or logging it", async () => {
    const token = vi.fn().mockResolvedValueOnce("synthetic-old").mockResolvedValueOnce("synthetic-refreshed");
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}"));
    const send = createAuthenticatedRequest(token, transport);
    await send("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await send("/api/retrieval-config");
    expect(new Headers(transport.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer synthetic-old");
    expect(new Headers(transport.mock.calls[1][1]?.headers).get("Authorization")).toBe("Bearer synthetic-refreshed");
    expect(transport.mock.calls[0][1]?.redirect).toBe("error");
    expect(token).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 503])("does not replay a rejected request (%s) or clear unsaved work", async status => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status }));
    const send = createAuthenticatedRequest(async () => "fictional", transport);
    await expect(send("/api/scan", { method: "POST", body: "{}" })).rejects.toThrow(/work is unchanged/);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("never sends a request without a token or retries an uncertain network failure", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(Error("offline"));
    await expect(createAuthenticatedRequest(async () => { throw Error("Sign in again"); }, transport)("/api/scan")).rejects.toThrow(/Sign in/);
    expect(transport).not.toHaveBeenCalled();
    await expect(createAuthenticatedRequest(async () => "fictional", transport)("/api/scan")).rejects.toThrow(/offline/);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(["https://outside.test/api/scan", "//outside.test/api/scan", "/api/\\outside", "/api/scan#fragment"])("does not send a token to %s", async url => {
    const transport = vi.fn<typeof fetch>();
    await expect(createAuthenticatedRequest(async () => "fictional", transport)(url)).rejects.toThrow(/destination/);
    expect(transport).not.toHaveBeenCalled();
  });
});
