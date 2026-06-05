import { attributeSummary, formatExpiry, type Attributes, type Category } from "@/lib/catalog";
import { getCurrentProfile } from "@/lib/dal";
import { ALL_SHOPS } from "@/lib/shop-context";
import { readShopScope } from "@/lib/shop-context-server";
import { createClient } from "@/lib/supabase/server";

import { PickShop } from "./pick-shop";
import { SellView, type SellItem } from "./sell-view";

/**
 * The sell screen. Resolves the one Shop the sale rings up against — a Cashier's
 * fixed Shop, or the Owner's active Shop context — then loads the Items that Shop
 * **carries** (a `shop_stock` row exists) with their live quantity, the catalog
 * price (cost-masked view), and the business-wide low-stock threshold for the
 * availability chips. On "All shops" the Owner is asked to pick a Shop first,
 * since a sale belongs to exactly one Shop (ADR-0005). MP-22.
 */
export default async function SellPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  let shopId: string | null = null;
  if (profile.role === "cashier") {
    shopId = profile.shopId;
  } else {
    const scope = await readShopScope();
    if (scope !== ALL_SHOPS) shopId = scope;
  }

  // No resolved Shop: the Owner picks one; a Cashier with no Shop is a data issue.
  if (!shopId) {
    if (profile.role === "owner") {
      const { data } = await supabase.from("shops").select("id, name").order("name");
      return <PickShop shops={(data ?? []).map((s) => ({ id: s.id as string, name: s.name as string }))} />;
    }
    return (
      <div className="scope-prompt">
        <div className="empty-ico">
          <span aria-hidden>!</span>
        </div>
        <h2 className="h2">No shop assigned</h2>
        <p className="text-muted" style={{ marginTop: 8 }}>
          Your account isn’t assigned to a shop yet. Ask the Owner to assign you to one.
        </p>
      </div>
    );
  }

  const [{ data: shopRow }, { data: stockRows }, { data: itemRows }, { data: settings }] =
    await Promise.all([
      supabase.from("shops").select("name").eq("id", shopId).maybeSingle(),
      supabase.from("shop_stock").select("item_id, quantity").eq("shop_id", shopId),
      supabase
        .from("items_catalog")
        .select("id, category, name, price_pesewas, attributes")
        .is("archived_at", null)
        .order("name"),
      supabase.from("shop_settings").select("low_stock_threshold").eq("id", true).maybeSingle(),
    ]);

  // Only the Items this Shop carries can be sold; each row's quantity is the live
  // on-hand count (0 = carried but out of stock, still shown, add disabled).
  const stockById = new Map((stockRows ?? []).map((r) => [r.item_id as string, r.quantity as number]));
  const items: SellItem[] = (itemRows ?? [])
    .filter((row) => stockById.has(row.id as string))
    .map((row) => {
      const category = row.category as Category;
      const attributes = (row.attributes ?? {}) as Attributes;
      return {
        id: row.id as string,
        category,
        name: row.name as string,
        subline: subline(category, attributes),
        price: row.price_pesewas as number,
        stock: stockById.get(row.id as string) as number,
      };
    });

  const lowThreshold = (settings?.low_stock_threshold ?? 5) as number;

  return (
    <SellView
      shopName={(shopRow?.name as string | undefined) ?? "this shop"}
      items={items}
      lowThreshold={lowThreshold}
    />
  );
}

/** Muted second line for a sell card: a cosmetic shows size + expiry; a wig or
 * tool shows its attribute summary (the shade/line is already in the name). */
function subline(category: Category, attributes: Attributes): string {
  if (category === "cosmetic") {
    const parts: string[] = [];
    if (attributes.size) parts.push(attributes.size);
    if (attributes.expiry) parts.push(`Exp ${formatExpiry(attributes.expiry)}`);
    return parts.join(" · ");
  }
  return attributeSummary(category, attributes);
}
