import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type ProfileRole = "owner" | "cashier";

export interface CurrentProfile {
  id: string;
  email: string | null;
  role: ProfileRole;
  fullName: string | null;
  /**
   * The Cashier's one Shop. `null` for the Owner, who spans all Shops and
   * instead picks a Shop context when selling or viewing a single Shop
   * (ADR-0005). A Cashier always has a Shop.
   */
  shopId: string | null;
}

/**
 * Secure auth check for Server Components / Actions: verifies the session JWT
 * with `getClaims` and loads the user's profile. Redirects to /login when there
 * is no authenticated user or profile. Memoized per render pass with React
 * `cache`.
 *
 * `getClaims` checks the JWT signature locally against the project's cached
 * asymmetric (ES256) signing keys — no round trip to the auth server, unlike
 * `getUser`, which cost ~1s per request. The trade-off is that a session revoked
 * server-side stays valid here until the JWT expires; that's acceptable because
 * Postgres/RLS verifies the same JWT on every query anyway, and the lockout we
 * actually use — `deactivated_at` below — is read fresh on every request.
 */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile> => {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;

  if (!userId) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name, shop_id, deactivated_at")
    .eq("id", userId)
    .single();

  if (!profile) {
    redirect("/login");
  }

  // A deactivated Cashier is locked out everywhere: every Server Component and
  // Server Action resolves the actor through here first, so the next request
  // after deactivation lands on the locked-out screen and no further work —
  // including completing a sale — ever runs. We send them to /deactivated rather
  // than /login because the proxy bounces an *authenticated* visitor off /login,
  // and a just-deactivated session is still technically signed in (the flag is
  // app-layer, not a revoked JWT) — redirecting to /login would loop. The
  // standalone /deactivated page explains the lockout and offers a real sign-out.
  // Soft and reversible (the Owner can clear the flag); Owners are never
  // deactivated, so this only ever trips a Cashier.
  if (profile.deactivated_at) {
    redirect("/deactivated");
  }

  return {
    id: userId,
    email: data.claims.email ?? null,
    role: profile.role as ProfileRole,
    fullName: profile.full_name ?? null,
    shopId: profile.shop_id ?? null,
  };
});
