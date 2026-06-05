import { NotOwner } from "@/components/shell/not-owner";
import { getCurrentProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

import { SettingsView } from "./settings-view";

/**
 * Business-wide settings (Owner-only): the low-stock threshold and expiry-warning
 * window on the single `shop_settings` row (ADR-0005). These drive the inventory
 * status chips and the low-stock / expiring filters (MP-21). Currency is fixed to
 * GH₵ in v1. Read here and edited via {@link SettingsView}; everyone authenticated
 * may read the row, but only the Owner sees this page and may write it.
 */
export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (profile.role !== "owner") {
    return <NotOwner message="Only the Owner can change settings." />;
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("shop_settings")
    .select("low_stock_threshold, expiry_warning_days")
    .eq("id", true)
    .maybeSingle();

  // Fall back to the DB defaults if the singleton row is somehow absent.
  return (
    <SettingsView
      lowStockThreshold={(data?.low_stock_threshold ?? 5) as number}
      expiryWarningDays={(data?.expiry_warning_days ?? 30) as number}
    />
  );
}
