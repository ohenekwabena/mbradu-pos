"use server";

import { revalidatePath } from "next/cache";

import { assertCan } from "@/lib/auth/visibility";
import { getCurrentProfile } from "@/lib/dal";
import { parseCountedInput, parseScopeInput } from "@/lib/stock-take";
import { createClient } from "@/lib/supabase/server";

export type TakeFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

/** The count screen lives here; every action re-renders it from the database. */
const STOCK_TAKE_PATH = "/inventory/stock-take";

/**
 * Resolve the acting profile and check the Shop-scoped `stocktake:count`
 * policy — the Owner counts any Shop, a Cashier only their own. The RPCs
 * re-check the same rule server-side against the take's own Shop, so this is
 * the early reject, not the boundary.
 */
async function assertCounter(shopId?: string) {
  const profile = await getCurrentProfile();
  assertCan(profile, "stocktake:count", shopId);
  return profile;
}

/**
 * Start a blind Stock take at one Shop: every carried Item by default, or a
 * chosen subset for a targeted spot-count. The scope is validated by
 * {@link parseScopeInput} and re-checked by the `start_stock_take` RPC (each
 * chosen Item must be carried; one open session per Shop), which creates the
 * session and its **pending** lines — no expected quantity is snapshotted
 * until each line is actually counted. Bound via `useActionState`.
 */
export async function startStockTake(
  _prev: TakeFormState,
  formData: FormData,
): Promise<TakeFormState> {
  const shopId = String(formData.get("shop_id") ?? "").trim();
  if (!shopId) return { status: "error", message: "Choose a shop to count." };
  await assertCounter(shopId);

  const parsed = parseScopeInput({
    mode: String(formData.get("mode") ?? ""),
    selectedIds: formData.getAll("item_ids").map(String),
  });
  if (!parsed.ok) return { status: "error", message: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("start_stock_take", {
    p_shop_id: shopId,
    p_item_ids: parsed.value.itemIds,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath(STOCK_TAKE_PATH);
  return { status: "success", message: "Stock take started — count each line as you go" };
}

/**
 * Record one line of the open count: the physically counted units (zero
 * allowed — an empty shelf is a real count), or an explicit skip. The
 * `record_stock_take_line` RPC snapshots the expected quantity server-side in
 * the same statement — the blind counter never sees it — and allows a recount
 * while the session is open. Bound per-row via `useActionState`; the row's
 * `intent` field says count or skip.
 */
export async function recordStockTakeLine(
  _prev: TakeFormState,
  formData: FormData,
): Promise<TakeFormState> {
  await assertCounter();

  const lineId = String(formData.get("line_id") ?? "").trim();
  if (!lineId) return { status: "error", message: "This line can’t be found — reload and try again." };

  const skip = String(formData.get("intent") ?? "") === "skip";
  let counted: number | null = null;
  if (!skip) {
    const parsed = parseCountedInput(String(formData.get("counted") ?? ""));
    if (!parsed.ok) return { status: "error", message: parsed.error };
    counted = parsed.value;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_stock_take_line", {
    p_line_id: lineId,
    p_counted: counted,
    p_skip: skip,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath(STOCK_TAKE_PATH);
  return { status: "success", message: skip ? "Line skipped" : "Line counted" };
}

/**
 * Submit the open count for Owner review. The `submit_stock_take` RPC enforces
 * what `checkSubmittable` told the UI: every line counted or explicitly
 * skipped, at least one counted. Changes no stock —
 * the session lands in `submitted`, and posting waits for approval (MP-37).
 */
export async function submitStockTake(
  _prev: TakeFormState,
  formData: FormData,
): Promise<TakeFormState> {
  await assertCounter();

  const takeId = String(formData.get("take_id") ?? "").trim();
  if (!takeId) return { status: "error", message: "This stock take can’t be found — reload and try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_stock_take", { p_take_id: takeId });
  if (error) return { status: "error", message: error.message };

  revalidatePath(STOCK_TAKE_PATH);
  return { status: "success", message: "Count submitted — awaiting the owner’s review" };
}

/**
 * Cancel the open count. Nothing was ever posted, so this only closes the
 * session (lines are kept for the audit trail); a new count can start anytime.
 */
export async function cancelStockTake(
  _prev: TakeFormState,
  formData: FormData,
): Promise<TakeFormState> {
  await assertCounter();

  const takeId = String(formData.get("take_id") ?? "").trim();
  if (!takeId) return { status: "error", message: "This stock take can’t be found — reload and try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_stock_take", { p_take_id: takeId });
  if (error) return { status: "error", message: error.message };

  revalidatePath(STOCK_TAKE_PATH);
  return { status: "success", message: "Stock take cancelled — nothing changed" };
}
