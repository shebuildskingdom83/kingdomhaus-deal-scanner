import { defineConfig } from "vite";

export default defineConfig({
  build: { ssr: "server/index.ts", outDir: "build/server", target: "node24", minify: false,
    sourcemap: false, rollupOptions: { output: { entryFileNames: "index.js" } } }
});
