import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/pilot.emulator.ts"], fileParallelism: false,
  environment: "node", testTimeout: 20000, hookTimeout: 30000 } });
