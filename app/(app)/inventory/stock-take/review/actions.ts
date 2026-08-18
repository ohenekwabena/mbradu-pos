"use server";

import { revalidatePath } from "next/cache";

import { assertCan } from "@/lib/auth/visibility";
import { getCurrentProfile } from "@/lib/dal";
import { parseClassifications, type ClassificationInput } from "@/lib/stock-take";
import { createClient } from "@/lib/supabase/server";

import type { TakeFormState } from "../actions";

const REVIEW_PATH = "/inventory/stock-take/review";
const COUNT_PATH = "/inventory/stock-take";

/** Owner-only early reject; the RPCs re-check `is_owner()` server-side. */
async function assertReviewer() {
  const profile = await getCurrentProfile();
  assertCan(profile, "stocktake:review");
}

/**
 * Approve a submitted Stock take. The form carries one `reason_<lineId>`
 * select (and `note_<lineId>` text) per postable Variance; unclassified selects
 * submit `""` and are dropped here — the `approve_stock_take` RPC re-derives
 * the postable set under row locks and refuses to approve any Variance left
 * without a classification, so the client-side gating is convenience, not the
 * boundary. On success the RPC has posted one `stock_take` movement per
 * Variance (with its provenance link) and moved stock onto the counted values.
 */
export async function approveStockTake(
  _prev: TakeFormState,
  formData: FormData,
): Promise<TakeFormState> {
  await assertReviewer();

  const takeId = String(formData.get("take_id") ?? "").trim();
  if (!takeId) return { status: "error", message: "This stock take can’t be found — reload and try again." };

  const rows: ClassificationInput[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("reason_") || typeof value !== "string" || value === "") continue;
    const lineId = key.slice("reason_".length);
    rows.push({ lineId, reason: value, note: String(formData.get(`note_${lineId}`) ?? "") });
  }
  const parsed = parseClassifications(rows);
  if (!parsed.ok) return { status: "error", message: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_stock_take", {
    p_take_id: takeId,
    p_classifications: parsed.value.map((c) => ({
      line_id: c.lineId,
      reason: c.reason,
      note: c.note,
    })),
  });
  if (error) return { status: "error", message: error.message };

  const { posted = 0, verified = 0, stale = 0 } = (data ?? {}) as {
    posted?: number;
    verified?: number;
    stale?: number;
  };
  const parts = [
    `${posted} ${posted === 1 ? "variance" : "variances"} posted to the ledger`,
    `${verified} verified correct`,
  ];
  if (stale > 0) parts.push(`${stale} stale ${stale === 1 ? "line needs" : "lines need"} a recount`);

  revalidatePath(REVIEW_PATH);
  revalidatePath(COUNT_PATH);
  revalidatePath("/inventory");
  return { status: "success", message: `Count approved — ${parts.join(", ")}.` };
}

/**
 * Reject a submitted Stock take: `cancel_stock_take` moves it to `cancelled`
 * (Owner-only for a submitted take), posting nothing; the lines are kept for
 * the audit trail. The Shop can simply count again.
 */
export async function rejectStockTake(
  _prev: TakeFormState,
  formData: FormData,
): Promise<TakeFormState> {
  await assertReviewer();

  const takeId = String(formData.get("take_id") ?? "").trim();
  if (!takeId) return { status: "error", message: "This stock take can’t be found — reload and try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_stock_take", { p_take_id: takeId });
  if (error) return { status: "error", message: error.message };

  revalidatePath(REVIEW_PATH);
  revalidatePath(COUNT_PATH);
  return { status: "success", message: "Count rejected — nothing was posted." };
}
