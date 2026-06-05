import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Integration tests run against the remote Supabase (they seed + tear down their
 * own data via the service-role key), so they're kept out of the default `npm
 * test` run and executed on demand with `npm run test:integration`. Longer
 * timeouts cover the network round-trips; env comes from .env.local.
 */
export default defineConfig(({ mode }) => ({
  test: {
    environment: "node",
    include: ["**/*.integration.test.{ts,tsx}"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: loadEnv(mode, root, ["NEXT_PUBLIC_", "SUPABASE_"]),
  },
  resolve: {
    alias: { "@": root },
  },
}));
