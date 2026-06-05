import { type Actor } from "@/lib/auth/visibility";
import { type Category } from "@/lib/catalog";
import {
  buildDashboard,
  type DashboardSale,
  type DashboardScope,
} from "@/lib/dashboard";
import { getCurrentProfile } from "@/lib/dal";
import { type PaymentMethod } from "@/lib/sale";
import { ALL_SHOPS } from "@/lib/shop-context";
import { readShopScope } from "@/lib/shop-context-server";
import { createClient } from "@/lib/supabase/server";

import { DashboardView } from "./dashboard-view";

/** How far back the revenue trend looks — the last 6 calendar months. */
const TREND_WINDOW_MONTHS = 6;

/** A Sale row as selected below, with its embedded lines and payments. */
type SaleRow = {
  id: string;
  shop_id: string;
  seller: string;
  customer_name: string | null;
  total_pesewas: number;
  created_at: string;
  sale_line_items: { item_id: string; quantity: number }[] | null;
  payments: { method: string; amount_pesewas: number }[] | null;
};

/**
 * The dashboard. Loads a window of Sales (with their lines + payments), every
 * per-Shop stock row with its Item's cost/category/expiry, the Shops, the
 * business-wide settings, and seller names, then hands them to the pure
 * {@link buildDashboard} view-model — which rolls them up for the active Shop
 * scope and role and applies the Visibility-policy (cost/profit/value are
 * Owner-only). The Owner defaults to the all-Shops rollup and can narrow to one
 * Shop via the switcher; a Cashier sees only their Shop. MP-24.
 */
export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const { data: shopRows } = await supabase.from("shops").select("id, name").order("name");
  const shops = (shopRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
  }));

  // The active Shop scope (ADR-0005): a Cashier is fixed to their Shop; the Owner
  // follows their Shop-context cookie, defaulting to the all-Shops rollup.
  let scope: DashboardScope;
  if (profile.role === "cashier") {
    scope = profile.shopId ? { mode: "shop", shopId: profile.shopId } : { mode: "all" };
  } else {
    const raw = await readShopScope();
    scope =
      raw !== ALL_SHOPS && shops.some((shop) => shop.id === raw)
        ? { mode: "shop", shopId: raw }
        : { mode: "all" };
  }

  const today = todayIsoUtc();
  const windowStart = monthStartIsoMonthsAgo(today, TREND_WINDOW_MONTHS);

  // RLS scopes each read to what the caller may see (Owner: all Shops; Cashier:
  // their Shop), and items_catalog masks cost for a non-Owner — so the Owner
  // block is simply never built for a Cashier.
  const [salesRes, itemRes, stockRes, settingsRes, profileRes] = await Promise.all([
    supabase
      .from("sales")
      .select(
        "id, shop_id, seller, customer_name, total_pesewas, created_at, " +
          "sale_line_items(item_id, quantity), payments(method, amount_pesewas)",
      )
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false }),
    supabase.from("items_catalog").select("id, name, category, cost_pesewas, attributes"),
    supabase.from("shop_stock").select("item_id, shop_id, quantity"),
    supabase
      .from("shop_settings")
      .select("low_stock_threshold, expiry_warning_days")
      .eq("id", true)
      .maybeSingle(),
    supabase.from("profiles").select("id, full_name"),
  ]);

  const sellerName = new Map(
    (profileRes.data ?? []).map((row) => [row.id as string, (row.full_name ?? null) as string | null]),
  );

  // The nested embed (sale_line_items, payments) isn't covered by generated DB
  // types, so cast the rows to the shape selected above (mirrors how the other
  // pages narrow untyped Supabase results).
  const saleRows = (salesRes.data ?? []) as unknown as SaleRow[];
  const sales: DashboardSale[] = saleRows.map((row) => ({
    id: row.id,
    shopId: row.shop_id,
    sellerName: sellerName.get(row.seller) ?? null,
    customer: row.customer_name ?? null,
    totalPesewas: row.total_pesewas,
    createdAt: row.created_at,
    lines: (row.sale_line_items ?? []).map((line) => ({
      itemId: line.item_id,
      quantity: line.quantity,
    })),
    payments: (row.payments ?? []).map((payment) => ({
      method: payment.method as PaymentMethod,
      amountPesewas: payment.amount_pesewas,
    })),
  }));

  const items = (itemRes.data ?? []).map((row) => {
    const attributes = (row.attributes ?? {}) as { expiry?: string | null };
    return {
      id: row.id as string,
      name: row.name as string,
      category: row.category as Category,
      costPesewas: (row.cost_pesewas ?? null) as number | null,
      expiry: (attributes.expiry ?? null) as string | null,
    };
  });

  const stock = (stockRes.data ?? []).map((row) => ({
    itemId: row.item_id as string,
    shopId: row.shop_id as string,
    quantity: row.quantity as number,
  }));

  const settings = {
    lowStockThreshold: (settingsRes.data?.low_stock_threshold ?? 5) as number,
    expiryWarningDays: (settingsRes.data?.expiry_warning_days ?? 30) as number,
  };

  const actor: Actor = { role: profile.role, shopId: profile.shopId };

  const viewModel = buildDashboard({
    actor,
    scope,
    today,
    sales,
    stock,
    items,
    shops,
    settings,
  });

  return <DashboardView vm={viewModel} />;
}

/** Today as a UTC `YYYY-MM-DD` string. The business runs in Ghana (GMT), so the
 * UTC calendar day is the local one; computed server-side, never on the client
 * (mirrors the Inventory page). */
function todayIsoUtc(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

/** The first day of the month `n` months before `today`, as a UTC ISO instant —
 * the lower bound for the Sales the trend needs (the last 6 calendar months). */
function monthStartIsoMonthsAgo(today: string, n: number): string {
  const [year, month] = today.split("-").map(Number);
  const monthIndex = year * 12 + (month - 1) - n;
  const startYear = Math.floor(monthIndex / 12);
  const startMonth = (monthIndex % 12) + 1;
  return `${startYear}-${pad2(startMonth)}-01T00:00:00.000Z`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
