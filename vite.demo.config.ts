import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/kingdomhaus-deal-scanner/",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, rollupOptions: { input: "demo.html" } },
});
