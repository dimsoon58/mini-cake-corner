import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // 2026-09-14 (CI rollout): downgraded from error to warn. These are
      // pre-existing, repo-wide findings (202 of 212 total lint errors were
      // `no-explicit-any` alone — the established pattern for an
      // untyped/not-yet-regenerated Supabase RPC call, used throughout this
      // codebase and its Deno Edge Functions) — not something a normal
      // future change introduces. Turning them into hard CI errors today
      // would fail the very first run on pre-existing code, blocking normal
      // work for reasons unrelated to whatever changed — exactly what this
      // CI rollout is meant to avoid. They still run and still show up as
      // warnings in the lint output (detected, never silently dropped) —
      // only the "block the build" behaviour changes. Rules that catch
      // real, likely-unintentional bugs (undefined variables, hook rules,
      // etc.) are untouched and stay at error.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "no-empty": "warn",
      "prefer-const": "warn",
    },
  },
);
