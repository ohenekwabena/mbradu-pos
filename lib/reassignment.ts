/**
 * Reassignment domain — the Owner moving a Cashier from one Shop to another to
 * cover a staffing change (CONTEXT.md: a Cashier is bound to one Shop, but the
 * Owner may reassign them; ADR-0005). Only `profiles.shop_id` changes: a Sale's
 * `shop_id` is fixed at completion, so the Cashier's **past Sales keep their
 * original Shop**, while from their next request `auth_shop()` resolves to the
 * new Shop, confining what they see and sell to it.
 *
 * Like the Invitations, Money, Catalog, and Stock-ledger modules this file is
 * deliberately free of any server/Supabase imports, so the Server Action that
 * performs the reassignment and the unit tests share one pure validation core.
 * The real write updates `profiles.shop_id` under the Owner-only "Owner updates
 * profiles" RLS policy (already shipped in `…_add_shop_scope_to_profiles.sql`),
 * which is the server-side proof of "only the Owner can reassign". MP-29.
 */

/** Raw reassignment input from the Staff page's "Reassign shop" modal. */
export interface ReassignInput {
  /** The Cashier being moved — their profile id. */
  cashierId: string;
  /** The Shop to move them to. */
  shopId: string;
  /**
   * The Cashier's current Shop, so a no-op move (picking the Shop they're
   * already in) is caught with a friendly message instead of a pointless write.
   * Optional — omit (or pass null) when the current Shop isn't known; the
   * same-Shop guard is then simply skipped.
   */
  currentShopId?: string | null;
}

/** A validated, normalized reassignment, ready to write to `profiles`. */
export interface ReassignWrite {
  /** The Cashier's profile id. */
  cashierId: string;
  /** The chosen destination Shop's id. */
  shopId: string;
}

export type ReassignParseResult =
  | { ok: true; value: ReassignWrite }
  | { ok: false; error: string };

/**
 * Validate + normalize raw reassignment input into a {@link ReassignWrite}, or
 * return the first problem as a human message:
 *   - a Cashier must be named (defensive — the row's button always supplies it);
 *   - a destination Shop must be chosen;
 *   - that Shop must differ from the Cashier's current one (a no-op otherwise).
 *
 * Ids are trimmed so the comparison and the eventual write match on one clean
 * form. Pure (no I/O): the unit-tested core the Server Action wraps before the
 * Owner-gated update, which RLS re-checks via "Owner updates profiles".
 */
export function parseReassignInput(input: ReassignInput): ReassignParseResult {
  const cashierId = input.cashierId.trim();
  if (cashierId === "") {
    return { ok: false, error: "Pick a cashier to reassign." };
  }

  const shopId = input.shopId.trim();
  if (shopId === "") {
    return { ok: false, error: "Choose a shop for this cashier." };
  }

  const currentShopId = input.currentShopId?.trim();
  if (currentShopId && currentShopId === shopId) {
    return { ok: false, error: "They're already in that shop." };
  }

  return { ok: true, value: { cashierId, shopId } };
}
