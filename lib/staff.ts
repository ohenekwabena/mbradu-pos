import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: "owner" | "cashier";
  /** The Cashier's current Shop id (null for the Owner) — drives reassignment. */
  shopId: string | null;
  shopName: string | null;
  /** True when the Owner has deactivated this Cashier — locked out, reversible. */
  deactivated: boolean;
}

/**
 * The full staff roster for the Owner's Staff page: every profile joined with
 * its email (from auth.users) and Shop name. Uses the service-role admin client
 * because RLS deliberately limits ordinary users to their own profile — the
 * caller MUST already be the Owner (the Staff page guards on role first).
 */
export async function getStaffRoster(): Promise<StaffMember[]> {
  const admin = createAdminClient();

  const [{ data: profiles }, { data: shops }] = await Promise.all([
    admin.from("profiles").select("id, role, full_name, shop_id, deactivated_at"),
    admin.from("shops").select("id, name"),
  ]);

  const shopNameById = new Map((shops ?? []).map((s) => [s.id, s.name]));

  // Emails live in auth.users, not profiles — pull them via the admin auth API.
  const emailById = new Map<string, string>();
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) break;
    for (const user of data.users) {
      if (user.email) emailById.set(user.id, user.email);
    }
    if (data.users.length < 200) break;
  }

  const members: StaffMember[] = (profiles ?? []).map((p) => ({
    id: p.id,
    name: p.full_name ?? "—",
    email: emailById.get(p.id) ?? "",
    role: (p.role as "owner" | "cashier") ?? "cashier",
    shopId: p.shop_id ?? null,
    shopName: p.shop_id ? (shopNameById.get(p.shop_id) ?? null) : null,
    deactivated: Boolean(p.deactivated_at),
  }));

  // Owner first, then cashiers alphabetically.
  members.sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return members;
}

/**
 * Whether a profile is currently deactivated. Read with the service-role admin
 * client because the login front door calls this *before* a session exists, so
 * there is no RLS context yet — and it's a cheap primary-key lookup. Lets the
 * login flow stop a deactivated Cashier at the door; `getCurrentProfile`
 * (lib/dal) then keeps every authenticated request locked out too.
 */
export async function isProfileDeactivated(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("deactivated_at")
    .eq("id", userId)
    .maybeSingle();
  return Boolean(data?.deactivated_at);
}

export interface PendingInvite {
  id: string;
  email: string;
  shopName: string | null;
  /** ISO timestamp the invitation was issued — formatted to "Invited … ago". */
  createdAt: string;
}

/**
 * The Owner's still-open invitations (status `pending`), newest first, each with
 * its target Shop's name. Unlike {@link getStaffRoster} this reads through the
 * ordinary RLS client, not the admin one: the "Owner manages invitations" policy
 * already scopes the table to the Owner, so the read is itself the server-side
 * proof that only the Owner sees invitations. The Staff page still guards on role
 * first. Shop names are joined in app code (a small id→name map) to avoid
 * depending on PostgREST embedding.
 */
export async function getPendingInvitations(): Promise<PendingInvite[]> {
  const supabase = await createClient();

  const [{ data: invites }, { data: shops }] = await Promise.all([
    supabase
      .from("invitations")
      .select("id, email, shop_id, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase.from("shops").select("id, name"),
  ]);

  const shopNameById = new Map((shops ?? []).map((s) => [s.id, s.name]));

  return (invites ?? []).map((invite) => ({
    id: invite.id,
    email: invite.email,
    shopName: invite.shop_id ? (shopNameById.get(invite.shop_id) ?? null) : null,
    createdAt: invite.created_at,
  }));
}
