import { notFound } from "next/navigation";

import { NotOwner } from "@/components/shell/not-owner";
import { type Attributes, type Category } from "@/lib/catalog";
import { getCurrentProfile } from "@/lib/dal";
import { ALL_SHOPS } from "@/lib/shop-context";
import { readShopScope } from "@/lib/shop-context-server";
import { isExpiringSoon, type StockReason } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";

import { ItemDetailView, type ItemDetail, type LedgerEntry } from "./item-detail-view";

/**
 * An Item's detail page: its specs, current stock per Shop, and the full
 * append-only movement ledger — plus the Restock and Correction actions. The
 * ledger is the source of truth for quantity (ADR-0004); a Correction (MP-20)
 * is the Owner's way to fix a miscount, recorded as a signed movement. Owner-only
 * (the catalog/cost view and stock writes all are). Per-Shop status chips and
 * low-stock land in MP-21.
 */
export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can manage inventory." />;
  }

  const { id } = await params;
  const supabase = await createClient();

  // The Item itself, through the cost-masking view (Owner sees cost). A missing
  // row → 404 rather than a broken page.
  const { data: itemRow } = await supabase
    .from("items_catalog")
    .select("id, category, name, price_pesewas, cost_pesewas, attributes, archived_at")
    .eq("id", id)
    .maybeSingle();

  if (!itemRow) notFound();

  const [{ data: shopRows }, { data: stockRows }, { data: movementRows }, { data: settingsRow }] =
    await Promise.all([
      supabase.from("shops").select("id, name").order("name"),
      supabase.from("shop_stock").select("shop_id, quantity").eq("item_id", id),
      supabase
        .from("stock_movements")
        .select("id, shop_id, reason, amount, note, actor, sale_id, created_at")
        .eq("item_id", id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("shop_settings")
        .select("low_stock_threshold, expiry_warning_days")
        .eq("id", true)
        .maybeSingle(),
    ]);

  const shops = (shopRows ?? []).map((r) => ({ id: r.id as string, name: r.name as string }));
  const shopName = new Map(shops.map((s) => [s.id, s.name] as const));

  // Resolve actor ids → display names. The Owner may read every profile ("Owner
  // views all profiles" RLS), so a Cashier-made Sale movement still shows a name.
  const movements = movementRows ?? [];
  const actorIds = [...new Set(movements.map((m) => m.actor).filter(Boolean) as string[])];
  const actorName = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    for (const p of profileRows ?? []) {
      if (p.full_name) actorName.set(p.id as string, p.full_name as string);
    }
  }

  // Per-Shop current quantity (a row's existence = the Shop carries the Item).
  const carriedStock = (stockRows ?? [])
    .map((r) => ({
      shopId: r.shop_id as string,
      shopName: shopName.get(r.shop_id as string) ?? "Unknown shop",
      quantity: r.quantity as number,
    }))
    .sort((a, b) => a.shopName.localeCompare(b.shopName));

  // Running per-Shop balance: walk each Shop's movements oldest→newest so each
  // row carries the quantity *after* it (the last equals shop_stock.quantity).
  const balanceByShop = new Map<string, number>();
  const ledger: LedgerEntry[] = movements.map((m) => {
    const shopId = m.shop_id as string;
    const balance = (balanceByShop.get(shopId) ?? 0) + (m.amount as number);
    balanceByShop.set(shopId, balance);
    return {
      id: m.id as string,
      shopId,
      shopName: shopName.get(shopId) ?? "Unknown shop",
      reason: m.reason as StockReason,
      amount: m.amount as number,
      note: (m.note ?? null) as string | null,
      actorName: m.actor ? (actorName.get(m.actor as string) ?? null) : null,
      saleId: (m.sale_id ?? null) as string | null,
      createdAt: m.created_at as string,
      balance,
    };
  });
  // Newest first for display (balances were accumulated oldest-first above).
  ledger.reverse();

  const item: ItemDetail = {
    id: itemRow.id as string,
    category: itemRow.category as Category,
    name: itemRow.name as string,
    price: itemRow.price_pesewas as number,
    cost: (itemRow.cost_pesewas ?? null) as number | null,
    attributes: (itemRow.attributes ?? {}) as Attributes,
    archivedAt: (itemRow.archived_at ?? null) as string | null,
  };

  // Business-wide stock-health settings (ADR-0005): the threshold drives the
  // per-Shop status chips, the window the "Expiring soon" flag. "Today" is the
  // server's UTC date (the business runs in Ghana/GMT), kept off the client.
  const lowStockThreshold = (settingsRow?.low_stock_threshold ?? 5) as number;
  const expiryWarningDays = (settingsRow?.expiry_warning_days ?? 30) as number;
  const expiringSoon = isExpiringSoon(item.attributes.expiry, todayIsoUtc(), expiryWarningDays);

  // The Owner's active Shop context, used to default the modals' Shop.
  const shopScope = await readShopScope();
  const activeShopId =
    shopScope !== ALL_SHOPS && shops.some((s) => s.id === shopScope) ? shopScope : null;

  return (
    <ItemDetailView
      item={item}
      shops={shops}
      carriedStock={carriedStock}
      ledger={ledger}
      lowStockThreshold={lowStockThreshold}
      expiringSoon={expiringSoon}
      activeShopId={activeShopId}
      activeShopName={activeShopId ? (shopName.get(activeShopId) ?? null) : null}
    />
  );
}

/** Today's date as a UTC `YYYY-MM-DD` string — the business runs in Ghana (GMT),
 * so UTC is the local calendar day. Fed to the pure {@link isExpiringSoon}. */
function todayIsoUtc(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
