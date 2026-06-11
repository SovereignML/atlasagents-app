import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

// Unit tests only — pure logic, no DB or network. The `@/` alias mirrors
// tsconfig.json paths so tests import the same way the app does.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
