"use server";

import { revalidatePath } from "next/cache";

import { assertCan } from "@/lib/auth/visibility";
import { getCurrentProfile } from "@/lib/dal";
import { parseDayCloseInput } from "@/lib/day-close";
import { createClient } from "@/lib/supabase/server";

export type DayCloseFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

/** The close screen lives here; a recorded close re-renders it from the DB. */
const DAY_CLOSE_PATH = "/day-close";

/**
 * Record a blind Day close (ADR-0007, MP-40): validate the declaration with
 * the pure {@link parseDayCloseInput} (amount via the Money module, day no
 * later than the server-stamped today, note trimmed), then hand it to the
 * `record_day_close` RPC — which re-checks authorization (Owner anywhere, a
 * Cashier at their own Shop, mirroring `complete_sale`), computes expected
 * drawer cash and the Over/short **server-side from data the declarer never
 * sees**, applies the stale rule, and rejects a duplicate (Shop, day). The
 * success message is all the declarer gets — no expected figure, no
 * Over/short, ever. Bound via `useActionState`.
 */
export async function recordDayClose(
  _prev: DayCloseFormState,
  formData: FormData,
): Promise<DayCloseFormState> {
  const shopId = String(formData.get("shop_id") ?? "").trim();
  if (!shopId) return { status: "error", message: "This screen lost its shop — reload and try again." };

  const profile = await getCurrentProfile();
  assertCan(profile, "dayclose:record", shopId);

  const parsed = parseDayCloseInput({
    amount: String(formData.get("declared_amount") ?? ""),
    note: String(formData.get("note") ?? ""),
    closeDate: String(formData.get("close_date") ?? ""),
    today: todayIsoUtc(),
  });
  if (!parsed.ok) return { status: "error", message: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_day_close", {
    p_shop_id: shopId,
    p_close_date: parsed.value.closeDate,
    p_declared: parsed.value.declaredPesewas,
    p_note: parsed.value.note,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath(DAY_CLOSE_PATH);
  return { status: "success", message: "Drawer recorded — the day is closed." };
}

/** Today as a UTC `YYYY-MM-DD` string — the Ghana business day (GMT). Stamped
 * server-side, never on the client (mirrors the Dashboard / Sales pages). */
function todayIsoUtc(): string {
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}
