import { build, loadEnv } from "vite";
import { readFile, writeFile, mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { homepageAuthPolicy, landingPrefix } from "./unifiedWebsite";

export const landingFeedbackCss = "\n.landing-auth-feedback{font-size:.875rem;line-height:1.5;margin:.75rem 0 0;max-width:40ch;overflow-wrap:anywhere}.hero .landing-auth-feedback,.closing .landing-auth-feedback{margin-left:auto;margin-right:auto;text-align:center}\n";

export function productionLandingHtml(html: string, authDomain: string) {
  const policy = homepageAuthPolicy(authDomain);
  return html.replace(/\bassets\//g, landingPrefix + "assets/")
    .replace("script-src 'self'", policy.script)
    .replace("connect-src 'none'", policy.connect)
    .replace("form-action 'none'", `${policy.frame}; form-action 'none'`);
}

/** Copy only the reviewed public snapshot. No environment files or local records are packaged. */
export async function packageLanding(source: string, destination: string, authEntry: string, authDomain: string) {
  const html = await readFile(path.join(source, "index.html"), "utf8");
  await writeFile(path.join(destination, "index.html"), productionLandingHtml(html, authDomain));
  async function copy(relative: string) {
    const sourcePath = path.join(source, relative);
    const outputPath = path.join(destination, "__kingdomhaus", relative);
    await mkdir(outputPath, { recursive: true });
    for (const entry of await readdir(sourcePath, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Symlinks are forbidden in the public landing snapshot.");
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) { await copy(child); continue; }
      if (!/\.(?:js|css|png|webp|svg|woff2?|txt)$/.test(entry.name)) throw new Error("Unexpected public asset type.");
      const raw = await readFile(path.join(source, child));
      let data: string | Buffer = raw;
      if (/\.(js|css)$/.test(entry.name)) data = raw.toString("utf8").replace(/\bassets\//g, landingPrefix + "assets/");
      if (child.replaceAll("\\", "/") === "assets/analyzer-launch.js") {
        const original = "const destination = resolveAnalyzerUrl(configuredUrl, landingOrigin, { allowLocal: true });";
        if (typeof data !== "string" || data.split(original).length !== 2) throw new Error("Landing launch contract changed; review before packaging.");
        // Production is one origin. The existing capture handler still authenticates every CTA.
        data = `import "/${authEntry}";\n` + data.replace(original, 'const destination = new URL("/cloud", landingOrigin).href;');
      }
      if (child.replaceAll("\\", "/") === "assets/styles.css") data += landingFeedbackCss;
      await writeFile(path.join(destination, "__kingdomhaus", child), data);
    }
  }
  await copy("assets");
  await writeFile(path.join(destination, "__kingdomhaus/photo-credits.txt"), await readFile(path.join(source, "photo-credits.txt")));
}

export async function buildProduction(root = process.cwd()) {
  // Reuse the existing public Firebase configuration mechanism, including shell overrides.
  const env = loadEnv("cloud", root, "VITE_");
  const required = ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID", "VITE_FIREBASE_FOUNDER_UID"];
  if (required.some(key => !env[key]?.trim()) || env.VITE_FIREBASE_PROJECT_ID !== "kingdomhaus-deal-scanner" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(env.VITE_FIREBASE_FOUNDER_UID) ||
      homepageAuthPolicy(env.VITE_FIREBASE_AUTH_DOMAIN).frame === "frame-src 'self'") {
    throw new Error("Production packaging requires the existing project's complete public Firebase configuration.");
  }
  const destination = path.resolve(root, "dist/hosting");
  const result = await build({ root, base: "/", mode: "cloud", define: { "import.meta.env.VITE_UNIFIED_WEBSITE": JSON.stringify("true") }, build: { outDir: destination,
    rollupOptions: { input: { workspace: path.resolve(root, "index.html"), landingAuth: path.resolve(root, "src/landingAuthEntry.ts") } } } });
  const outputs = Array.isArray(result) ? result.flatMap(item => "output" in item ? item.output : []) : "output" in result ? result.output : [];
  const entry = outputs.find(item => item.type === "chunk" && item.isEntry && item.name === "landingAuth");
  if (!entry) throw new Error("Landing authentication entry was not emitted.");
  await rename(path.join(destination, "index.html"), path.join(destination, "workspace.html"));
  await packageLanding(path.resolve(root, "website/landing"), destination, entry.fileName, env.VITE_FIREBASE_AUTH_DOMAIN);
  console.log("Production frontend packaged: landing /; authenticated workspace /cloud; no cloud changes.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildProduction();
