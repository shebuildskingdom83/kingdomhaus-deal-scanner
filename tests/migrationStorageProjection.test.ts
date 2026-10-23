import { describe, expect, it, vi } from "vitest";
import { migrationStorageProjection } from "../src/migrationStorageProjection";

describe("records-only serialized storage projection", () => {
  it.each([
    '{"schemaVersion":2,"records":[],"draft":{"nested":[{},[1,2]],"text":"} , \\\" ["}}',
    '{"draft":[{"records":[1,2]}],"records":[],"schemaVersion":2}',
    '{"schemaVersion":2,"dr\\u0061ft":"opaque","rec\\u006frds":[]}',
    '{"schemaVersion":2,"records":[]}',
  ])("selects only root records from %s", raw => {
    expect(migrationStorageProjection(raw)).toBe('{"schemaVersion":2,"records":[],"draft":null}');
  });
  it.each([null, "", "[]", "{}", '{"records":[],"schemaVersion":1}',
    '{"records":[],"schemaVersion":2,"records":[]}',
    '{"records":[],"schemaVersion":2,"dr\\u0061ft":null,"draft":null}',
    '{"records":[],"schemaVersion":2,"other":null}',
    '{"records":[],"schemaVersion":2} trailing',
    '{"records":[],"schemaVersion":2,}',
    '{"records":[],"schemaVersion":2,"draft":{"nested":[]]',
    '{"records":[],"schemaVersion":2,"draft":"unterminated}',
    '{"records":[{"__proto__":{}}],"schemaVersion":2}',
  ])("rejects ambiguous or unusable selected envelopes without exposing contents", raw => {
    expect(() => migrationStorageProjection(raw)).toThrow();
  });
  it("never passes the skipped draft to JSON.parse, including large opaque nested values", () => {
    const marker = "SYNTHETIC-OPAQUE-DRAFT";
    const raw = JSON.stringify({ draft: { marker, payload: "x".repeat(100_000), nested: [{ constructor: marker }] }, schemaVersion: 2, records: [] });
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(migrationStorageProjection(raw)).not.toContain(marker);
      expect(parse.mock.calls.every(([input]) => !String(input).includes(marker))).toBe(true);
    } finally { parse.mockRestore(); }
  });
});
