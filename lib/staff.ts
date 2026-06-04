import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: "owner" | "cashier";
  shopName: string | null;
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
    admin.from("profiles").select("id, role, full_name, shop_id"),
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
    shopName: p.shop_id ? (shopNameById.get(p.shop_id) ?? null) : null,
  }));

  // Owner first, then cashiers alphabetically.
  members.sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return members;
}
