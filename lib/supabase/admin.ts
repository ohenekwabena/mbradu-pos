import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — it bypasses Row-Level Security entirely.
 *
 * NEVER import this from client code; the `server-only` guard turns that into a
 * build error. Use it solely inside Server Actions / Route Handlers that have
 * ALREADY authorized the caller (e.g. an Owner-only check), since the service
 * role can read and write anything.
 *
 * It exists for the handful of operations RLS deliberately forbids end users:
 *   - resolving an account's role by email (to enforce "cashiers can't
 *     self-reset" before any email is sent),
 *   - listing the staff roster (profiles + emails) for the Owner, and
 *   - generating password-recovery links for the Owner-triggered reset.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Admin client needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
