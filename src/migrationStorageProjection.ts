import { parseJson } from "./recordValidation";

// localStorage returns the shared string atomically. Locate selected root values
// without slicing, deserializing or retaining the excluded draft value.
export function migrationStorageProjection(raw: string | null): string {
  const fail = (): never => { throw new Error("Invalid saved-record envelope."); };
  if (raw === null) return fail();
  let index = 0;
  const whitespace = () => { while (index < raw.length && /[\t\n\r ]/.test(raw[index])) index++; };
  const stringEnd = () => {
    if (raw[index++] !== '"') return fail();
    while (index < raw.length) {
      const char = raw[index++];
      if (char === '"') return;
      if (char === "\\") index++;
    }
    fail();
  };
  const skipValue = () => {
    const closing: string[] = [];
    while (index < raw.length) {
      const char = raw[index];
      if (char === '"') { stringEnd(); continue; }
      if (char === "{" || char === "[") closing.push(char === "{" ? "}" : "]");
      else if (char === "}" || char === "]") {
        if (!closing.length) break;
        if (closing.pop() !== char) return fail();
      } else if (char === "," && !closing.length) break;
      index++;
    }
    if (closing.length) fail();
  };
  const selected = new Map<string, unknown>(), seen = new Set<string>();
  whitespace();
  if (raw[index++] !== "{") return fail();
  while (true) {
    whitespace();
    const keyStart = index;
    stringEnd();
    const key = parseJson(raw.slice(keyStart, index)) as string;
    if (!["schemaVersion", "records", "draft"].includes(key) || seen.has(key)) return fail();
    seen.add(key);
    whitespace();
    if (raw[index++] !== ":") return fail();
    whitespace();
    const start = index;
    skipValue();
    if (key !== "draft") selected.set(key, parseJson(raw.slice(start, index), 4_000_000));
    whitespace();
    const delimiter = raw[index++];
    if (delimiter === "}") break;
    if (delimiter !== ",") return fail();
  }
  whitespace();
  if (index !== raw.length || selected.get("schemaVersion") !== 2 || !selected.has("records")) return fail();
  return JSON.stringify({ schemaVersion: 2, records: selected.get("records"), draft: null });
}
