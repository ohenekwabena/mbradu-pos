import { NotOwner } from "@/components/shell/not-owner";
import { getCurrentProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

import { ShopsView, type ShopRow } from "./shops-view";

export default async function ShopsPage() {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can open or edit shops." />;
  }

  const supabase = await createClient();

  // The Shops themselves, plus two small per-Shop stats for the table (design
  // §10.10): how many Cashiers it has, and today's revenue. Mbradu runs in
  // Accra (UTC+0), so "today" is the current UTC date.
  const startOfToday = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    ),
  ).toISOString();

  const [shopsRes, staffRes, salesRes] = await Promise.all([
    supabase
      .from("shops")
      .select("id, name, address, phone, created_at")
      .order("created_at"),
    supabase.from("profiles").select("shop_id").eq("role", "cashier"),
    supabase
      .from("sales")
      .select("shop_id, total_pesewas")
      .gte("created_at", startOfToday),
  ]);

  const staffByShop = new Map<string, number>();
  for (const row of staffRes.data ?? []) {
    if (row.shop_id) staffByShop.set(row.shop_id, (staffByShop.get(row.shop_id) ?? 0) + 1);
  }

  const revenueByShop = new Map<string, number>();
  for (const sale of salesRes.data ?? []) {
    revenueByShop.set(
      sale.shop_id,
      (revenueByShop.get(sale.shop_id) ?? 0) + (sale.total_pesewas ?? 0),
    );
  }

  const shops: ShopRow[] = (shopsRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address,
    phone: s.phone,
    staff: staffByShop.get(s.id) ?? 0,
    revenueToday: revenueByShop.get(s.id) ?? 0,
  }));

  return <ShopsView shops={shops} />;
}
