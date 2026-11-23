import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { unifiedWebsite } from "./scripts/unifiedWebsite";

export default defineConfig(({ mode }) => ({
  base: process.env.GITHUB_PAGES === "true" ? "/kingdomhaus-deal-scanner/" : "/",
  plugins: [unifiedWebsite(), react()],
  optimizeDeps: mode === "local-documents" ? { exclude: ["pdfjs-dist", "pdfjs-dist/build/pdf.mjs"] } : undefined,
  server: {
    port: 5173,
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.local-document-prototype/**", "**/.cloud-test-artifacts/**"] },
    proxy: mode === "cloud-emulator" ? undefined : {
      "/api": mode === "local-documents" ? "http://127.0.0.1:8790" : "http://127.0.0.1:8787"
    }
  },
  preview: {
    port: 4173
  },
  test: {
    environment: "node"
  }
}));
