import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderPilotRules } from "../scripts/pilotRules";

describe("reviewed deployed-baseline pilot candidate", () => {
  it("tests the reviewed candidate with a fictional founder and preserves migration protections", () => {
    const candidate = readFileSync("firestore.pilot.rules", "utf8").replace("FOUNDER_UID_NOT_CONFIGURED", "synthetic-founder");
    expect(candidate).toContain("request.auth.uid == 'synthetic-founder'");
    expect(candidate).toContain("request.auth.token.get('kingdomhausPilot', false) == true");
    expect(candidate).toContain("unchangedOffset()");
    expect(candidate).toContain("offset <= 999999999999");
    expect(candidate).toContain("request.resource.data.revision == resource.data.revision + 1");
    expect(candidate).toContain("match /{document=**} { allow read, write: if false; }");
    expect(JSON.parse(readFileSync("firebase.json", "utf8")).firestore.rules).toBe("firestore.rules");
  });
  it("fails closed on an older template or a changed admission predicate", () => {
    const older = readFileSync("firestore.rules", "utf8");
    expect(() => renderPilotRules(older, "synthetic-founder")).toThrow();
    const migration = readFileSync("firestore.migration.rules", "utf8").replace("FOUNDER_UID_NOT_CONFIGURED", "synthetic-founder");
    expect(() => renderPilotRules(migration.replace("function owns(uid)", "function changed(uid)"), "synthetic-founder")).toThrow();
  });
});
