import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { unifiedWebsite } from "./scripts/unifiedWebsite";

export default defineConfig(({ mode }) => ({
  plugins: [unifiedWebsite(), react()],
  server: {
    port: 5173,
    proxy: mode === "cloud-emulator" ? undefined : {
      "/api": "http://127.0.0.1:8787"
    }
  },
  preview: {
    port: 4173
  },
  test: {
    environment: "node"
  }
}));
