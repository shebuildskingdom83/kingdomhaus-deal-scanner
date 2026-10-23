import { describe, expect, it, vi } from "vitest";
import { retrieveListing } from "../src/urlRetrieval";

const url = "https://www.bizbuysell.com/business-opportunity/synthetic/1234567/";
describe("account-bound retrieval cancellation with synthetic transport", () => {
  it("stops polling after account cancellation without launching or polling again", async () => {
    const controller = new AbortController(); let finish!: () => void;
    const transport = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, status: "running", jobId: "synthetic-job" })));
    const wait = vi.fn(() => new Promise<void>(done => { finish = done; }));
    const pending = retrieveListing(url, { fetcher: transport, confirm: () => true, progress: vi.fn(), wait, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(1));
    controller.abort(); finish(); await rejected;
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.every(call => !String(call[0]).includes("listing-retrieval/"))).toBe(true);
  });
  it("cannot open a charge confirmation or submit after a delayed config response changes accounts", async () => {
    const controller = new AbortController(); let finish!: (response: Response) => void;
    const transport = vi.fn(() => new Promise<Response>(done => { finish = done; })); const confirm = vi.fn();
    const pending = retrieveListing(url, { fetcher: transport, confirm, progress: vi.fn(), signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow();
    controller.abort(); finish(new Response(JSON.stringify({ enabled: true }))); await rejected;
    expect(confirm).not.toHaveBeenCalled(); expect(transport).toHaveBeenCalledTimes(1);
  });
});
