/** Hosted validation deliberately has no paid-provider opt-in. Review paid hosting separately. */
export function providerEnvironment(env: Record<string, string | undefined>) {
  return env.NODE_ENV === "production" ? { ...env, OPENAI_API_KEY: undefined, APIFY_API_TOKEN: undefined,
    OPENAI_MAX_REQUESTS_PER_PROCESS: undefined, APIFY_MAX_RUNS_PER_PROCESS: undefined } : env;
}

export function runtimeConfiguration(env: Record<string, string | undefined>) {
  const production = env.NODE_ENV === "production";
  const port = Number(env.PORT ?? (production ? 8080 : 8787));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid backend PORT.");
  if (production && (env.FIREBASE_PROJECT_ID !== "kingdomhaus-deal-scanner" ||
      !env.FIREBASE_FOUNDER_UID || !/^[A-Za-z0-9_-]{1,128}$/.test(env.FIREBASE_FOUNDER_UID) ||
      env.FIREBASE_FOUNDER_UID === "FOUNDER_UID_NOT_CONFIGURED" || env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST)) {
    throw new Error("Production requires the existing Firebase project and original founder configuration; emulators are forbidden.");
  }
  return { port, host: production ? "0.0.0.0" : "127.0.0.1" };
}

export function apiAllowedOrigins(env: Record<string, string | undefined>) {
  if (env.NODE_ENV !== "production") return new Set(["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5176", "http://127.0.0.1:5176"]);
  const value = env.APP_ORIGIN;
  let origin: URL;
  try { origin = new URL(value ?? ""); } catch { throw new Error("Production requires an exact HTTPS APP_ORIGIN."); }
  if (origin.protocol !== "https:" || origin.origin !== value || origin.username || origin.password || origin.port ||
      !origin.hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal)$/.test(origin.hostname)) {
    throw new Error("Production requires an exact HTTPS APP_ORIGIN.");
  }
  return new Set([origin.origin]);
}
