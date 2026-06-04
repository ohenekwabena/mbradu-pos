import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    // Pure modules run in node; component tests opt in with
    // a `// @vitest-environment jsdom` pragma at the top of the file.
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    // `@rollup/plugin-alias` only matches `@` at a `/` boundary, so this
    // does not clobber scoped packages like `@testing-library/react`.
    alias: { "@": root },
  },
});
