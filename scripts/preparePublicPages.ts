import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const landing = path.join(root, "website", "landing");
const analyzer = path.join(dist, "analyzer");

await cp(landing, dist, { recursive: true, force: true });
await mkdir(analyzer, { recursive: true });

const landingIndexPath = path.join(dist, "index.html");
const landingIndex = await readFile(landingIndexPath, "utf8");
const enhancedLanding = landingIndex.replace(
  "</body>",
  '  <script type="module" src="assets/public-demo-landing.js?v=guest-access"></script>\n</body>'
);
await writeFile(landingIndexPath, enhancedLanding, "utf8");
await cp(path.join(dist, "demo.html"), path.join(analyzer, "index.html"));
await cp(landingIndexPath, path.join(dist, "404.html"));

console.log("Public pages prepared: landing / and Deal Scanner /analyzer/.");
