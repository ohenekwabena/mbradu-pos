import { NotOwner } from "@/components/shell/not-owner";
import { type Attributes, type Category } from "@/lib/catalog";
import { getCurrentProfile } from "@/lib/dal";
import { ALL_SHOPS } from "@/lib/shop-context";
import { readShopScope } from "@/lib/shop-context-server";
import { createClient } from "@/lib/supabase/server";

import { CatalogView, type CatalogItem, type CatalogProduct } from "./catalog-view";

export default async function InventoryPage() {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can manage inventory." />;
  }

  // Read the catalog through items_catalog, the view that returns cost_pesewas
  // only to the Owner (masked to null for a Cashier), alongside the Products
  // that group cosmetic shades, and the Shops the Owner can restock into. The
  // per-Shop stock columns and status land in MP-21; MP-19 adds the Restock
  // write path, which needs the Shop list.
  const supabase = await createClient();
  const [{ data: itemRows }, { data: productRows }, { data: shopRows }] = await Promise.all([
    supabase
      .from("items_catalog")
      .select("id, category, name, product_id, price_pesewas, cost_pesewas, attributes")
      .order("name"),
    supabase.from("products").select("id, name, brand").order("name"),
    supabase.from("shops").select("id, name").order("name"),
  ]);

  const allItems: CatalogItem[] = (itemRows ?? []).map((row) => ({
    id: row.id as string,
    category: row.category as Category,
    name: row.name as string,
    productId: (row.product_id ?? null) as string | null,
    price: row.price_pesewas as number,
    cost: (row.cost_pesewas ?? null) as number | null,
    attributes: (row.attributes ?? {}) as Attributes,
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

  // The Shops a Restock can target, plus the Owner's active Shop context. When a
  // single Shop is in context the restock modal locks to it; on "All shops" the
  // modal asks which Shop to stock (design — Inventory restock).
  const shops = (shopRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
  }));
  const scope = await readShopScope();
  const activeShopId =
    scope !== ALL_SHOPS && shops.some((shop) => shop.id === scope) ? scope : null;
  const activeShopName = activeShopId
    ? (shops.find((shop) => shop.id === activeShopId)?.name ?? null)
    : null;

  return (
    <CatalogView
      items={allItems}
      products={products}
      shops={shops}
      activeShopId={activeShopId}
      activeShopName={activeShopName}
    />
  );
}
