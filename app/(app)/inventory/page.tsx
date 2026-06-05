import { NotOwner } from "@/components/shell/not-owner";
import { type Attributes, type Category } from "@/lib/catalog";
import { getCurrentProfile } from "@/lib/dal";
import { ALL_SHOPS } from "@/lib/shop-context";
import { readShopScope } from "@/lib/shop-context-server";
import { isExpiringSoon, stockStatus } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";

import {
  CatalogView,
  type CatalogItem,
  type CatalogProduct,
  type InventoryItem,
  type InventoryScope,
  type ItemStock,
} from "./catalog-view";

export default async function InventoryPage() {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can manage inventory." />;
  }

  // Read the catalog through items_catalog (the cost-masking view — Owner sees
  // cost), the Products that group cosmetic shades, every Shop, all per-Shop
  // stock rows, and the single business-wide settings row (threshold + expiry
  // window). The Owner RLS lets us read all shop_stock at once; status/low-stock
  // (MP-21) is derived from these here so the client stays presentational.
  const supabase = await createClient();
  const [
    { data: itemRows },
    { data: productRows },
    { data: shopRows },
    { data: stockRows },
    { data: settingsRow },
  ] = await Promise.all([
    supabase
      .from("items_catalog")
      .select("id, category, name, product_id, price_pesewas, cost_pesewas, attributes, archived_at")
      .order("name"),
    supabase.from("products").select("id, name, brand").order("name"),
    supabase.from("shops").select("id, name").order("name"),
    supabase.from("shop_stock").select("item_id, shop_id, quantity"),
    supabase
      .from("shop_settings")
      .select("low_stock_threshold, expiry_warning_days")
      .eq("id", true)
      .maybeSingle(),
  ]);

  const lowStockThreshold = (settingsRow?.low_stock_threshold ?? 5) as number;
  const expiryWarningDays = (settingsRow?.expiry_warning_days ?? 30) as number;
  const today = todayIsoUtc();

  const allItems: CatalogItem[] = (itemRows ?? []).map((row) => ({
    id: row.id as string,
    category: row.category as Category,
    name: row.name as string,
    productId: (row.product_id ?? null) as string | null,
    price: row.price_pesewas as number,
    cost: (row.cost_pesewas ?? null) as number | null,
    attributes: (row.attributes ?? {}) as Attributes,
    archived: row.archived_at != null,
  }));

  // The list is flat — every Item (including each cosmetic shade) is its own
  // row. The Product grouping is built only for the editor, which edits a
  // cosmetic a whole line at a time.
  const shadesByProduct = new Map<string, CatalogItem[]>();
  for (const item of allItems) {
    if (!item.productId) continue;
    const shades = shadesByProduct.get(item.productId);
    if (shades) shades.push(item);
    else shadesByProduct.set(item.productId, [item]);
  }

  const products: CatalogProduct[] = (productRows ?? [])
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      brand: (row.brand ?? null) as string | null,
      shades: shadesByProduct.get(row.id as string) ?? [],
    }))
    .filter((product) => product.shades.length > 0);

  const shops = (shopRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
  }));

  // The Owner's active Shop context drives the whole list (ADR-0005): on a single
  // Shop it shows that Shop's quantities and status; on "All shops" it rolls up.
  const scope = await readShopScope();
  const activeShopId =
    scope !== ALL_SHOPS && shops.some((shop) => shop.id === scope) ? scope : null;
  const activeShopName = activeShopId
    ? (shops.find((shop) => shop.id === activeShopId)?.name ?? null)
    : null;

  // Index per-Shop stock as item_id → (shop_id → quantity). A row's existence is
  // what "carries" means (CONTEXT.md), so a missing entry is "not carried".
  const stockByItem = new Map<string, Map<string, number>>();
  for (const row of stockRows ?? []) {
    const itemId = row.item_id as string;
    let perShop = stockByItem.get(itemId);
    if (!perShop) {
      perShop = new Map();
      stockByItem.set(itemId, perShop);
    }
    perShop.set(row.shop_id as string, row.quantity as number);
  }

  const inventoryScope: InventoryScope =
    activeShopId && activeShopName
      ? { mode: "shop", shopId: activeShopId, shopName: activeShopName }
      : { mode: "all", shopCount: shops.length };

  const items: InventoryItem[] = allItems.map((item) => {
    const perShop = stockByItem.get(item.id);
    // Total on hand across *all* Shops — scope-independent, so the archive guard
    // (block-until-zero) is the same whether viewing one Shop or all (MP-31).
    const totalOnHand = perShop ? [...perShop.values()].reduce((sum, q) => sum + q, 0) : 0;
    return {
      ...item,
      totalOnHand,
      stock: buildItemStock(item, {
        perShop,
        activeShopId,
        lowStockThreshold,
        expiringSoon: isExpiringSoon(item.attributes.expiry, today, expiryWarningDays),
      }),
    };
  });

  return (
    <CatalogView
      items={items}
      products={products}
      shops={shops}
      scope={inventoryScope}
      activeShopId={activeShopId}
      activeShopName={activeShopName}
    />
  );
}

/** Today's date as a UTC `YYYY-MM-DD` string. The business runs in Ghana (GMT),
 * so UTC is the local calendar day; computed server-side and fed to the pure
 * {@link isExpiringSoon}, so no clock reaches the client. */
function todayIsoUtc(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Derive an Item's scope-aware stock view-model (quantity, status chip kind +
 * label, and the quick-filter flags) for the current Shop context:
 *   - **single Shop**: this Shop's quantity, "Not carried" when no row, else
 *     out / low / in — with "Expiring soon" taking priority while in stock;
 *   - **all Shops**: the total across carried Shops with a rolled-up status
 *     ("Not stocked" / "Expiring soon" / "Out everywhere" / "N shops low/out" /
 *     "In stock").
 * The numeric classification comes from the pure {@link stockStatus}; this just
 * maps it to scope-appropriate display semantics.
 */
function buildItemStock(
  item: CatalogItem,
  ctx: {
    perShop: Map<string, number> | undefined;
    activeShopId: string | null;
    lowStockThreshold: number;
    expiringSoon: boolean;
  },
): ItemStock {
  const { perShop, activeShopId, lowStockThreshold, expiringSoon } = ctx;

  if (activeShopId) {
    const quantity = perShop?.get(activeShopId) ?? null;
    if (quantity === null) {
      return {
        carried: false,
        quantity: null,
        carriedShopCount: 0,
        statusKind: "not-carried",
        statusLabel: "Not carried",
        lowFlag: false,
        expiringFlag: expiringSoon,
      };
    }
    // Expiring takes visual priority for a carried, in-stock cosmetic.
    if (quantity > 0 && expiringSoon) {
      return {
        carried: true,
        quantity,
        carriedShopCount: 1,
        statusKind: "expiring",
        statusLabel: "Expiring soon",
        lowFlag: quantity <= lowStockThreshold,
        expiringFlag: true,
      };
    }
    const kind = stockStatus(quantity, lowStockThreshold);
    return {
      carried: true,
      quantity,
      carriedShopCount: 1,
      statusKind: kind,
      statusLabel: kind === "out" ? "Out of stock" : kind === "low" ? "Low" : "In stock",
      lowFlag: quantity <= lowStockThreshold,
      expiringFlag: expiringSoon,
    };
  }

  // All-shops rollup.
  const quantities = perShop ? [...perShop.values()] : [];
  const carriedShopCount = quantities.length;
  if (carriedShopCount === 0) {
    return {
      carried: false,
      quantity: 0,
      carriedShopCount: 0,
      statusKind: "not-carried",
      statusLabel: "Not stocked",
      lowFlag: false,
      expiringFlag: expiringSoon,
    };
  }

  const total = quantities.reduce((sum, q) => sum + q, 0);
  const lowOrOut = quantities.filter((q) => q <= lowStockThreshold).length;

  let statusKind: ItemStock["statusKind"];
  let statusLabel: string;
  if (expiringSoon) {
    statusKind = "expiring";
    statusLabel = "Expiring soon";
  } else if (total === 0) {
    statusKind = "out-everywhere";
    statusLabel = "Out everywhere";
  } else if (lowOrOut > 0) {
    statusKind = "shops-low-out";
    statusLabel = `${lowOrOut} shop${lowOrOut > 1 ? "s" : ""} low/out`;
  } else {
    statusKind = "in";
    statusLabel = "In stock";
  }

  return {
    carried: true,
    quantity: total,
    carriedShopCount,
    statusKind,
    statusLabel,
    lowFlag: lowOrOut > 0,
    expiringFlag: expiringSoon,
  };
}
