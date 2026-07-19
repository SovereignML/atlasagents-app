import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

// Integration tests — REAL PostgreSQL via TEST_DATABASE_URL. Kept out of the
// default `npm run test` run so unit tests stay dependency-free and fast.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.itest.ts"],
    globalSetup: "./src/lib/__integration__/setup.ts",
    // DB tests share one database; serialize files to avoid cross-file
    // interference on the same tables.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
})
