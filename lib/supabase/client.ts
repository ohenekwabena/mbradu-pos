import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components. `createBrowserClient` is a singleton,
 * so calling this repeatedly returns the same instance.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
