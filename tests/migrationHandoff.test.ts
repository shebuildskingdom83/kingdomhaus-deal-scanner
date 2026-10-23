import { describe, expect, it, vi } from "vitest";
import { boundMessage, HANDOFF_CHANNEL, HANDOFF_LIFETIME_MS, handoffSourceUnchanged, MigrationHandoffSession, newChallenge, readHandoffSnapshot, SOURCE_ORIGIN } from "../src/migrationHandoff";
import type { HandoffRepository } from "../src/migrationHandoff";
import { migrationFixtures } from "./cloudMigrationFixtures";
import { sameMigrationContent } from "../src/cloudMigration";
import type { AcquisitionRecord } from "../src/acquisitionRecord";

function setup() {
  const records = migrationFixtures(), peer = {}, challenge = newChallenge();
  const event = { origin: SOURCE_ORIGIN, source: peer, data: { channel: HANDOFF_CHANNEL, type: "records", challenge, records } };
  const copies = new Map<string, AcquisitionRecord>();
  const repository: HandoffRepository = {
    reviewMigrationSelection: vi.fn(async selected => {
      for (const record of selected) if (copies.has(record.id) && !sameMigrationContent(copies.get(record.id), record)) throw new Error("Synthetic conflict");
      return { selectedCount: selected.length, existingCount: copies.size };
    }),
    list: vi.fn(async () => [...copies.values()].map(value => structuredClone(value))),
    getForMigration: vi.fn(async id => structuredClone(copies.get(id)!)),
    createRecordForMigration: vi.fn(async record => { const exists = copies.has(record.id); copies.set(record.id, structuredClone(record)); return exists ? "already-identical" : "created"; }),
    loadDraft: vi.fn(async () => ({ revision: 0, value: null })), createDraftForMigration: vi.fn(async () => { throw new Error("Draft must not transfer"); })
  };
  return { peer, challenge, records, event, copies, repository, session: new MigrationHandoffSession(peer, challenge),
    options: { confirmed: true, authorized: () => true, sourceUnchanged: vi.fn(async () => true) } };
}
describe("manual, exact-origin in-memory migration handoff", () => {
  it("does not read storage until the explicit snapshot function is called and never writes", () => {
    const t = setup(), raw = JSON.stringify({ schemaVersion: 2, records: t.records, draft: null });
    const store = { getItem: vi.fn(() => raw), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    expect(store.getItem).not.toHaveBeenCalled(); expect(t.repository.list).not.toHaveBeenCalled();
    expect(readHandoffSnapshot(store).records).toEqual(t.records);
    expect(store.getItem).toHaveBeenCalledTimes(2); expect(store.setItem).not.toHaveBeenCalled(); expect(store.removeItem).not.toHaveBeenCalled(); expect(store.clear).not.toHaveBeenCalled();
  });
  it("rejects changed sources and non-four-record selections before transfer", () => {
    const t = setup();
    for (const value of [{ schemaVersion: 2, records: t.records.slice(1), draft: null }]) {
      expect(() => readHandoffSnapshot({ getItem: () => JSON.stringify(value) })).toThrow();
    }
    const raw = JSON.stringify({ schemaVersion: 2, records: t.records, draft: null }); let reads = 0;
    expect(() => readHandoffSnapshot({ getItem: () => ++reads === 1 ? raw : null })).toThrow();
  });
  it("skips a populated source draft without deserializing, retaining or transferring it", async () => {
    const t = setup(), sentinel = "SYNTHETIC-DRAFT-EXCLUDED";
    const draft = { recordId: null, recordRevision: null, state: { ...t.records[0].state,
      cashFlow: { ...t.records[0].state.cashFlow, normalizationNotes: sentinel } } };
    const raw = JSON.stringify({ schemaVersion: 2, draft, records: t.records });
    const store = { getItem: vi.fn(() => raw), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    const parse = vi.spyOn(JSON, "parse");
    let snapshot: ReturnType<typeof readHandoffSnapshot>;
    try {
      snapshot = readHandoffSnapshot(store);
      expect(parse.mock.calls.every(([input]) => !String(input).includes(sentinel))).toBe(true);
    } finally { parse.mockRestore(); }
    expect(snapshot.records).toEqual(t.records);
    expect(JSON.stringify(snapshot)).not.toContain(sentinel);
    expect(Object.keys(snapshot)).toEqual(["baseline", "records"]);
    t.session.accept({ ...t.event, data: { ...t.event.data, records: snapshot.records } });
    await t.session.execute(t.repository, { ...t.options, sourceUnchanged: async () => handoffSourceUnchanged(store, snapshot.baseline) });
    expect([...t.copies.values()]).toEqual(t.records);
    expect(JSON.stringify([...t.copies.values()])).not.toContain(sentinel);
    expect(t.repository.createDraftForMigration).not.toHaveBeenCalled();
    expect(store.getItem()).toBe(raw);
    expect(store.setItem).not.toHaveBeenCalled(); expect(store.removeItem).not.toHaveBeenCalled(); expect(store.clear).not.toHaveBeenCalled();
  });
  it("excludes draft changes and schema from eligibility and freshness, but detects saved-record changes", () => {
    const t = setup();
    let raw = JSON.stringify({ schemaVersion: 2, records: t.records, draft: { unsupported: true } });
    const store = { getItem: () => raw }, snapshot = readHandoffSnapshot(store);
    raw = JSON.stringify({ draft: { nested: [{ escaped: '\\"},[', records: ["not selected"] }], constructor: "not parsed" }, records: t.records, schemaVersion: 2 });
    expect(handoffSourceUnchanged(store, snapshot.baseline)).toBe(true);
    expect(readHandoffSnapshot(store).records).toEqual(t.records);
    let reads = 0;
    expect(readHandoffSnapshot({ getItem: () => ++reads === 1 ? JSON.stringify({ schemaVersion: 2, records: t.records, draft: null }) : raw }).records).toEqual(t.records);
    raw = JSON.stringify({ schemaVersion: 2, records: t.records.map((record, i) => i ? record : { ...record, name: "Synthetic change" }), draft: null });
    expect(handoffSourceUnchanged(store, snapshot.baseline)).toBe(false);
    raw = "unreadable envelope";
    expect(handoffSourceUnchanged(store, snapshot.baseline)).toBe(false);
  });
  it("receiving and reviewing a valid snapshot cannot write or autosave", async () => {
    const t = setup(); expect(t.session.accept(t.event)).toHaveLength(4);
    expect(t.repository.list).not.toHaveBeenCalled(); expect(t.repository.createRecordForMigration).not.toHaveBeenCalled();
    await t.session.review(t.repository); expect(t.repository.createRecordForMigration).not.toHaveBeenCalled();
    expect(t.repository.createDraftForMigration).not.toHaveBeenCalled();
    await expect(t.session.execute(t.repository, { ...t.options, confirmed: false })).rejects.toThrow();
    expect(t.repository.createRecordForMigration).not.toHaveBeenCalled();
  });
  it.each(["origin", "source", "challenge", "shape", "channel"])("rejects spoofed %s without reads or writes", field => {
    const t = setup(), event = { ...t.event, data: { ...t.event.data } };
    if (field === "origin") event.origin = "http://localhost:5174";
    if (field === "source") event.source = {};
    if (field === "challenge") event.data.challenge = newChallenge();
    if (field === "shape") Object.assign(event.data, { secret: "synthetic-extra-field" });
    if (field === "channel") event.data.channel = "other-channel";
    expect(() => t.session.accept(event)).toThrow(); expect(t.repository.list).not.toHaveBeenCalled();
  });
  it("rejects replay, expired/cancelled sessions and malformed challenge bindings", () => {
    const t = setup(); t.session.accept(t.event); expect(() => t.session.accept(t.event)).toThrow();
    expect(boundMessage(t.event, SOURCE_ORIGIN, null)).toBe(false);
    expect(() => new MigrationHandoffSession(t.peer, "invalid")).toThrow();
    let now = 0; const expiring = new MigrationHandoffSession(t.peer, t.challenge, () => now); now = HANDOFF_LIFETIME_MS;
    expect(() => expiring.accept(t.event)).toThrow(); t.session.cancel(); expect(() => t.session.summary()).toThrow();
  });
  it("explicitly creates all four complete historical snapshots and supports confirmed idempotent retries", async () => {
    const t = setup(), before = structuredClone(t.records); t.session.accept(t.event);
    expect(await t.session.execute(t.repository, t.options)).toEqual({ verifiedCount: 4, createdCount: 4, identicalRetryCount: 0 });
    expect([...t.copies.values()]).toEqual(before); expect(t.records).toEqual(before);
    expect(t.options.sourceUnchanged).toHaveBeenCalledTimes(7);
    expect(await t.session.execute(t.repository, t.options)).toEqual({ verifiedCount: 4, createdCount: 0, identicalRetryCount: 4 });
    expect(t.copies.size).toBe(4); expect(t.repository.createDraftForMigration).not.toHaveBeenCalled();
  });
  it("blocks source changes, account changes and conflicts before the first write", async () => {
    for (const failure of ["source", "account", "conflict"]) {
      const t = setup(); t.session.accept(t.event);
      if (failure === "source") t.options.sourceUnchanged.mockResolvedValue(false);
      if (failure === "account") t.options.authorized = () => false;
      if (failure === "conflict") t.copies.set(t.records[0].id, { ...t.records[0], name: "Synthetic competing edit" });
      await expect(t.session.execute(t.repository, t.options)).rejects.toThrow(); expect(t.repository.createRecordForMigration).not.toHaveBeenCalled();
    }
  });
  it("stops after an interrupted partial transfer and retries the same snapshot without duplicates", async () => {
    const t = setup(); t.session.accept(t.event);
    vi.mocked(t.repository.getForMigration).mockRejectedValueOnce(new Error("Synthetic lost acknowledgement"));
    await expect(t.session.execute(t.repository, t.options)).rejects.toThrow(); expect(t.copies.size).toBe(1);
    expect(await t.session.execute(t.repository, t.options)).toEqual({ verifiedCount: 4, createdCount: 3, identicalRetryCount: 1 });
  });
  it("stops on full readback mismatch without writing the next record", async () => {
    const t = setup(); t.session.accept(t.event);
    vi.mocked(t.repository.getForMigration).mockResolvedValueOnce({ ...t.records[0], name: "Synthetic mismatch" });
    await expect(t.session.execute(t.repository, t.options)).rejects.toThrow(); expect(t.copies.size).toBe(1);
  });
  it("does not restore consent or data when a new session is constructed (refresh/startup)", async () => {
    const t = setup(), fresh = new MigrationHandoffSession(t.peer, t.challenge);
    await expect(fresh.execute(t.repository, t.options)).rejects.toThrow(); expect(fresh.summary()).toEqual([]);
    expect(t.repository.createRecordForMigration).not.toHaveBeenCalled();
  });
  it("stops if a nonempty cloud draft appears, without changing that draft", async () => {
    const t = setup(); t.session.accept(t.event);
    vi.mocked(t.repository.loadDraft).mockResolvedValue({ revision: 1, value: { recordId: null, recordRevision: null, state: t.records[0].state } });
    await expect(t.session.execute(t.repository, t.options)).rejects.toThrow("draft");
    expect(t.repository.createRecordForMigration).not.toHaveBeenCalled(); expect(t.repository.createDraftForMigration).not.toHaveBeenCalled();
  });
});
