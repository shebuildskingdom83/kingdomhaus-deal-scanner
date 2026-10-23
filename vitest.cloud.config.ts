import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/cloud.emulator.ts", "tests/cloud.migration.emulator.ts"], fileParallelism: false,
  environment: "node", testTimeout: 20000, hookTimeout: 30000 } });
