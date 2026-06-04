import { NotOwner } from "@/components/shell/not-owner";
import { type Attributes, type Category } from "@/lib/catalog";
import { getCurrentProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

import { CatalogView, type CatalogItem } from "./catalog-view";

export default async function InventoryPage() {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can manage inventory." />;
  }

  // Read the catalog through items_catalog, the view that returns cost_pesewas
  // only to the Owner (masked to null for a Cashier). Stock is per-Shop and
  // lands in a later ticket (MP-19–MP-21); MP-17 is the catalog itself.
  const supabase = await createClient();
  const { data } = await supabase
    .from("items_catalog")
    .select("id, category, name, price_pesewas, cost_pesewas, attributes")
    .order("name");

  const items: CatalogItem[] = (data ?? []).map((row) => ({
    id: row.id as string,
    category: row.category as Category,
    name: row.name as string,
    price: row.price_pesewas as number,
    cost: (row.cost_pesewas ?? null) as number | null,
    attributes: (row.attributes ?? {}) as Attributes,
  }));

  return <CatalogView items={items} />;
}
