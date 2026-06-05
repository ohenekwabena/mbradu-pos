import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  test: {
    // Pure modules run in node; component tests opt in with
    // a `// @vitest-environment jsdom` pragma at the top of the file.
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    // Integration tests hit the remote Supabase and carry their own config +
    // `test:integration` script, so the default `npm test` stays offline/fast.
    exclude: [...configDefaults.exclude, "**/*.integration.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // Make the project's NEXT_PUBLIC_* / SUPABASE_* vars (from .env.local)
    // available to tests via process.env.
    env: loadEnv(mode, root, ["NEXT_PUBLIC_", "SUPABASE_"]),
  },
  resolve: {
    // `@rollup/plugin-alias` only matches `@` at a `/` boundary, so this
    // does not clobber scoped packages like `@testing-library/react`.
    alias: { "@": root },
  },
}));
