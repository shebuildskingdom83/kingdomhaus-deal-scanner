import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createScannerServer } from "./api";
import { firebaseTokenVerifier } from "./firebaseAdmin";
import { runtimeConfiguration } from "./runtime";

loadDotEnv();
const { port, host } = runtimeConfiguration(process.env);
const server = createScannerServer({ env: process.env, verifyToken: firebaseTokenVerifier(process.env.FIREBASE_PROJECT_ID) });
server.listen(port, host, () => console.log(`KingdomHaus Deal Scanner API listening on http://${host}:${port}`));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
});

function loadDotEnv() {
  if (process.env.NODE_ENV === "production") return;
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
