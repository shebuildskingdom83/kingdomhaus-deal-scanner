import { describe, expect, it } from "vitest";
import { renderFounderRules, validateFounderConfiguration } from "../scripts/founderRules";

const fixture = {
  VITE_FIREBASE_API_KEY: "AIza" + "x".repeat(35),
  VITE_FIREBASE_AUTH_DOMAIN: "fictional-project.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "fictional-project",
  VITE_FIREBASE_APP_ID: "1:123456789:web:abc123",
  VITE_FIREBASE_FOUNDER_UID: "fictional-approved-founder"
};
const template = "request.auth.uid == 'FOUNDER_UID_NOT_CONFIGURED'";

describe("private founder-rule preparation with synthetic configuration only", () => {
  it("validates complete configuration without needing Firebase network access", () => {
    expect(validateFounderConfiguration(fixture)).toEqual({ uid: fixture.VITE_FIREBASE_FOUNDER_UID, projectId: fixture.VITE_FIREBASE_PROJECT_ID });
  });
  it("rejects missing, placeholder, malformed and injection-shaped UIDs", () => {
    for (const uid of ["", "FOUNDER_UID_NOT_CONFIGURED", "synthetic-founder", "bad' || true", "a/b", "x".repeat(129), " leading-space"]) {
      expect(() => validateFounderConfiguration({ ...fixture, VITE_FIREBASE_FOUNDER_UID: uid })).toThrow();
    }
  });
  it("requires all Web app settings and does not include invalid values in errors", () => {
    for (const key of Object.keys(fixture)) {
      expect(() => validateFounderConfiguration({ ...fixture, [key]: "" })).toThrow();
    }
    const invalidValue = "invalid://synthetic value not to be logged";
    for (const key of Object.keys(fixture).filter(key => key !== "VITE_FIREBASE_FOUNDER_UID")) {
      let message = "";
      try { validateFounderConfiguration({ ...fixture, [key]: invalidValue }); }
      catch (error) { message = error instanceof Error ? error.message : ""; }
      expect(message).toContain("invalid"); expect(message).not.toContain(invalidValue);
    }
  });
  it("binds only the intended UID slot and rejects ambiguous or missing template slots", () => {
    expect(renderFounderRules(template, "fictional-owner")).toBe("request.auth.uid == 'fictional-owner'");
    expect(() => renderFounderRules("no placeholder", "fictional-owner")).toThrow();
    expect(() => renderFounderRules(template + template, "fictional-owner")).toThrow();
    expect(() => renderFounderRules(template, "quote'escape")).toThrow();
  });
});
