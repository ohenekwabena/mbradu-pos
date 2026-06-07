import { type Actor } from "@/lib/auth/visibility";
import { type Category } from "@/lib/catalog";
import {
  buildDashboard,
  RECENT_SALES_LIMIT,
  resolveDashboardWindow,
  type DashboardSale,
  type DashboardScope,
} from "@/lib/dashboard";
import { getCurrentProfile } from "@/lib/dal";
import { type PaymentMethod } from "@/lib/sale";
import { ALL_SHOPS } from "@/lib/shop-context";
import { readShopScope } from "@/lib/shop-context-server";
import { createClient } from "@/lib/supabase/server";

import { DashboardView } from "./dashboard-view";

/** A Sale row as selected below, with its embedded lines and payments. The nested
 * embed isn't covered by the generated DB types, so the rows are cast to this
 * shape (mirrors the `/sales` page). */
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

/** The Sale columns both reads need: lines drive COGS / unit counts, payments the
 * payment mix and method chips. */
const SALE_SELECT =
  "id, shop_id, seller, customer_name, total_pesewas, created_at, " +
  "sale_line_items(item_id, quantity), payments(method, amount_pesewas)";

/**
 * The dashboard. Resolves the active Shop scope and the selected **date-range
 * window** (the Owner picks it via `?range`/`?from`/`?to`; a Cashier is pinned to
 * Today), then loads: a window of Sales **plus the immediately-preceding period**
 * (for the period-over-period delta) that powers every flow figure; a small,
 * range-independent newest-first feed for the recent-sales card; every per-Shop
 * stock row with its Item's cost/category/expiry; the Shops; and the business-wide
 * settings. It hands them to the pure {@link buildDashboard} view-model — which
 * rolls them up for the scope, window, and role and applies the Visibility-policy
 * (cost/profit/value are Owner-only). The Owner defaults to the all-Shops rollup
 * and Today, and can narrow the Shop via the switcher and the range via the
 * selector; a Cashier sees only their Shop, today. MP-24.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const { range, from, to } = await searchParams;

  const { data: shopRows } = await supabase.from("shops").select("id, name").order("name");
  const shops = (shopRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
  }));

  // The active Shop scope (ADR-0005): a Cashier is fixed to their Shop; the Owner
  // follows their Shop-context cookie, defaulting to the all-Shops rollup (a
  // stale/forged cookie falls back to all-Shops).
  let scopeShopId: string | null;
  if (profile.role === "cashier") {
    scopeShopId = profile.shopId ?? null;
  } else {
    const raw = await readShopScope();
    scopeShopId = raw !== ALL_SHOPS && shops.some((shop) => shop.id === raw) ? raw : null;
  }
  const scope: DashboardScope = scopeShopId ? { mode: "shop", shopId: scopeShopId } : { mode: "all" };

  const today = todayIsoUtc();
  // A Cashier is pinned to Today (no range selector); the Owner picks the range.
  const window =
    profile.role === "owner"
      ? resolveDashboardWindow(today, { range, from, to })
      : resolveDashboardWindow(today, { range: "today" });

  // Two Sales reads. The **aggregate** spans the window plus the preceding period
  // (`[prevStartIso, endIso)`) so the figures and the delta come from one set; the
  // **feed** is the latest few Sales regardless of range, so the recent-sales card
  // is never empty. RLS scopes each read to what the caller may see; a single-Shop
  // scope narrows further with `.eq`. items_catalog masks cost for a non-Owner — so
  // the Owner block is simply never built for a Cashier.
  let aggregateQuery = supabase
    .from("sales")
    .select(SALE_SELECT)
    .gte("created_at", window.prevStartIso)
    .lt("created_at", window.endIso);
  if (scopeShopId) aggregateQuery = aggregateQuery.eq("shop_id", scopeShopId);

  let feedQuery = supabase
    .from("sales")
    .select(SALE_SELECT)
    .order("created_at", { ascending: false })
    .limit(RECENT_SALES_LIMIT);
  if (scopeShopId) feedQuery = feedQuery.eq("shop_id", scopeShopId);

  const [aggregateRes, feedRes, itemRes, stockRes, settingsRes] = await Promise.all([
    aggregateQuery,
    feedQuery,
    supabase.from("items_catalog").select("id, name, category, cost_pesewas, attributes, archived_at"),
    supabase.from("shop_stock").select("item_id, shop_id, quantity"),
    supabase
      .from("shop_settings")
      .select("low_stock_threshold, expiry_warning_days")
      .eq("id", true)
      .maybeSingle(),
  ]);

  const aggregateRows = (aggregateRes.data ?? []) as unknown as SaleRow[];
  const feedRows = (feedRes.data ?? []) as unknown as SaleRow[];

  // Resolve seller names for the feed only (the aggregates never use them). RLS
  // returns only the profiles the actor may read (mirrors the receipt + `/sales`);
  // an unresolved seller renders as "—".
  const sellerName = new Map<string, string | null>();
  const sellerIds = [...new Set(feedRows.map((row) => row.seller))];
  if (sellerIds.length > 0) {
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", sellerIds);
    for (const row of profileRows ?? []) {
      sellerName.set(row.id as string, (row.full_name ?? null) as string | null);
    }
  }

  const sales: DashboardSale[] = aggregateRows.map((row) => toDashboardSale(row, null));
  const recentFeedSales: DashboardSale[] = feedRows.map((row) =>
    toDashboardSale(row, sellerName.get(row.seller) ?? null),
  );

  const items = (itemRes.data ?? []).map((row) => {
    const attributes = (row.attributes ?? {}) as { expiry?: string | null };
    return {
      id: row.id as string,
      name: row.name as string,
      category: row.category as Category,
      costPesewas: (row.cost_pesewas ?? null) as number | null,
      expiry: (attributes.expiry ?? null) as string | null,
      archived: row.archived_at != null,
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
    window,
    sales,
    recentFeedSales,
    stock,
    items,
    shops,
    settings,
  });

  return (
    // Key by the resolved window so changing the range gives a fresh view — it
    // re-seeds the custom-date drafts (mirrors the `/sales` archive).
    <DashboardView key={`${window.range}:${window.fromDate}:${window.toDate}`} vm={viewModel} />
  );
}

/** Map a selected Sale row to the pure view-model's {@link DashboardSale}. The
 * seller name is resolved only for the feed; the aggregate figures never read it. */
function toDashboardSale(row: SaleRow, sellerName: string | null): DashboardSale {
  return {
    id: row.id,
    shopId: row.shop_id,
    sellerName,
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
  };
}

/** Today as a UTC `YYYY-MM-DD` string. The business runs in Ghana (GMT), so the
 * UTC calendar day is the local one; computed server-side, never on the client
 * (mirrors the Inventory / Sales pages). */
function todayIsoUtc(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
