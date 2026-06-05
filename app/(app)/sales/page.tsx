import { getCurrentProfile } from "@/lib/dal";
import { type PaymentMethod } from "@/lib/sale";
import {
  resolveSalesWindow,
  shapeSaleRow,
  type SaleListRow,
  type ShapeableSale,
} from "@/lib/sales-list";
import { ALL_SHOPS } from "@/lib/shop-context";
import { readShopScope } from "@/lib/shop-context-server";
import { createClient } from "@/lib/supabase/server";

import { SalesView, type SalesScope } from "./sales-view";

/** A Sale row as selected below, with its embedded line quantities + payment
 * methods. The nested embed isn't covered by the generated DB types, so the rows
 * are cast to this shape (mirrors the dashboard page). */
type SaleRow = {
  id: string;
  shop_id: string;
  seller: string;
  customer_name: string | null;
  total_pesewas: number;
  created_at: string;
  sale_line_items: { quantity: number }[] | null;
  payments: { method: string }[] | null;
};

/**
 * The completed-sales archive (`/sales`). The full, filterable, paginated
 * counterpart of the dashboard's recent-sales feed: past Sales newest-first, each
 * row linking to its existing receipt (`/sales/[id]`, MP-22/23).
 *
 * **Scope (ADR-0005, no new RLS).** A Cashier sees only their Shop's Sales (RLS
 * already confines `sales`); the Owner follows the active Shop context — all-Shops
 * shows a Shop column, a single-Shop context narrows and drops it. **The date
 * range bounds the query** (default: last 30 days) so it never scans unbounded
 * history; the chosen range lives in the URL (`?range`/`?from`/`?to`) and is
 * re-queried server-side, while method + customer filtering happen client-side
 * over the loaded window. No cost/profit/margin appears here. MP-32.
 */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const profile = await getCurrentProfile(); // require auth; RLS scopes visible sales
  const supabase = await createClient();
  const { range, from, to } = await searchParams;

  const { data: shopRows } = await supabase.from("shops").select("id, name").order("name");
  const shops = (shopRows ?? []).map((row) => ({ id: row.id as string, name: row.name as string }));
  const shopNameById = new Map(shops.map((shop) => [shop.id, shop.name]));

  // Active Shop scope: a Cashier is fixed to their Shop; the Owner follows the
  // Shop-context cookie, defaulting to the all-Shops view (a stale/forged cookie
  // falls back to all-Shops).
  let scopeShopId: string | null = null;
  if (profile.role === "cashier") {
    scopeShopId = profile.shopId ?? null;
  } else {
    const raw = await readShopScope();
    scopeShopId = raw !== ALL_SHOPS && shops.some((shop) => shop.id === raw) ? raw : null;
  }

  const win = resolveSalesWindow(todayIsoUtc(), { range, from, to });

  // The date window bounds the read; RLS confines rows to what the actor may see,
  // and a single-Shop scope narrows further. Newest first.
  let query = supabase
    .from("sales")
    .select(
      "id, shop_id, seller, customer_name, total_pesewas, created_at, " +
        "sale_line_items(quantity), payments(method)",
    )
    .gte("created_at", win.startIso)
    .lt("created_at", win.endIso);
  if (scopeShopId) query = query.eq("shop_id", scopeShopId);
  const { data: saleData } = await query.order("created_at", { ascending: false });
  const saleRows = (saleData ?? []) as unknown as SaleRow[];

  // Resolve seller names (sales.seller → profiles.full_name) for the set in view.
  // RLS returns only the profiles the actor may read (mirrors the receipt + the
  // dashboard feed); an unresolved seller renders as "—".
  const sellerName = new Map<string, string | null>();
  const sellerIds = [...new Set(saleRows.map((row) => row.seller))];
  if (sellerIds.length > 0) {
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", sellerIds);
    for (const row of profileRows ?? []) {
      sellerName.set(row.id as string, (row.full_name ?? null) as string | null);
    }
  }

  const rows: SaleListRow[] = saleRows.map((row) => {
    const sale: ShapeableSale = {
      id: row.id,
      shopId: row.shop_id,
      sellerName: sellerName.get(row.seller) ?? null,
      customer: row.customer_name ?? null,
      totalPesewas: row.total_pesewas,
      createdAt: row.created_at,
      lines: (row.sale_line_items ?? []).map((line) => ({ quantity: line.quantity })),
      payments: (row.payments ?? []).map((payment) => ({
        method: payment.method as PaymentMethod,
      })),
    };
    return shapeSaleRow(sale, shopNameById);
  });

  const scope: SalesScope = scopeShopId
    ? { mode: "shop", shopName: shopNameById.get(scopeShopId) ?? "this shop" }
    : { mode: "all", shopCount: shops.length };

  return (
    // Key by the resolved window so changing the date range gives a fresh view
    // (resets the in-window method/customer filters and the load-more page).
    <SalesView
      key={`${win.range}:${win.fromDate}:${win.toDate}`}
      rows={rows}
      scope={scope}
      dateWindow={{ range: win.range, fromDate: win.fromDate, toDate: win.toDate }}
    />
  );
}

/** Today as a UTC `YYYY-MM-DD` string. The business runs in Ghana (GMT), so the
 * UTC calendar day is the local one; computed server-side (mirrors Inventory /
 * Dashboard), never on the client. */
function todayIsoUtc(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
