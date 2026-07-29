// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      // stdout is the JSON-RPC channel (see src/index.ts) — only the console
      // methods that write to stderr are allowed.
      "no-console": ["error", { allow: ["error", "warn"] }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/restrict-template-expressions": "off",
      // "smart" allows `== null` / `!= null` (the codebase's one-check idiom for
      // "unset or absent") while still forcing === everywhere else.
      eqeqeq: ["error", "smart"],
      // Tool output routinely stringifies `unknown` — API response fields typed
      // defensively, and conversion-pixel payload fields that are attacker
      // data by construction (see src/lib/patch.ts displayValue, src/tools/
      // listConversions.ts payloadField). String(unknown) never throws; the
      // worst case is a readable "[object Object]", which is the intended
      // degrade-gracefully behavior here, not a bug this rule should flag.
      "@typescript-eslint/no-base-to-string": "off",
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // node:test's describe/it/t.test aren't recognized by these promise rules
      // (no eslint-plugin-jest-style shape awareness) — every hit here is that
      // false positive, not an unhandled rejection.
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  eslintConfigPrettier,
);
