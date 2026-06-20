import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CJS config and one-off scripts not subject to strict TS linting:
    "deploy/**",
    "scripts/**",
    // Generated/vendored design-sync artifacts (git-ignored; not linted in CI):
    "ds-bundle/**",
    ".ds-sync/**",
  ]),
]);

export default eslintConfig;
