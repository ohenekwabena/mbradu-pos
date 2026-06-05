"use server";

import { revalidatePath } from "next/cache";

import { assertCan } from "@/lib/auth/visibility";
import { getCurrentProfile } from "@/lib/dal";
import { parseSettingsInput, type SettingsInput } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export type SettingsFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

/**
 * Update the business-wide settings — the single `shop_settings` row's low-stock
 * threshold and expiry-warning window (ADR-0005). Owner-only: gated here with
 * {@link assertCan} for an early reject and again by the "Owner updates settings"
 * RLS policy on the row. Input is validated by {@link parseSettingsInput}; the
 * threshold drives the inventory low-stock flags and the window the expiring-soon
 * flags, so both `/settings` and `/inventory` are revalidated. Bound to the
 * settings form via `useActionState`.
 */
export async function saveSettings(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const profile = await getCurrentProfile();
  assertCan(profile, "settings:write");

  const input: SettingsInput = {
    lowStockThreshold: String(formData.get("low_stock_threshold") ?? ""),
    expiryWarningDays: String(formData.get("expiry_warning_days") ?? ""),
  };

  const parsed = parseSettingsInput(input);
  if (!parsed.ok) {
    return { status: "error", message: parsed.error };
  }

  // Update the singleton row (id = true). RLS re-checks is_owner(); the
  // updated_at trigger stamps the change.
  const supabase = await createClient();
  const { error } = await supabase
    .from("shop_settings")
    .update({
      low_stock_threshold: parsed.value.lowStockThreshold,
      expiry_warning_days: parsed.value.expiryWarningDays,
    })
    .eq("id", true);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/settings");
  revalidatePath("/inventory");
  return { status: "success", message: "Settings saved" };
}
