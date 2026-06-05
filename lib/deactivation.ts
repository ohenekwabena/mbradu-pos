/**
 * Deactivation domain — the Owner revoking a Cashier's access so they can no
 * longer sign in or sell, while their past Sales are preserved (a Sale's seller
 * and Shop are fixed at completion, so deactivating a Cashier never rewrites
 * history). Soft and reversible: only `profiles.deactivated_at` flips — set to
 * deactivate, cleared to reactivate — so the same control toggles both ways.
 *
 * Like the Reassignment, Invitations, Money, Catalog, and Stock-ledger modules
 * this file is deliberately free of any server/Supabase imports, so the Server
 * Actions that perform the write and the unit tests share one pure validation
 * core. The real write updates `profiles.deactivated_at` under the Owner-only
 * "Owner updates profiles" RLS policy (the server-side proof that only the Owner
 * can deactivate); the lock itself is then enforced on every request by
 * `getCurrentProfile` (lib/dal) and again at the login front door. MP-30.
 */

/** Raw input from the Staff page's Deactivate / Reactivate control. */
export interface DeactivateInput {
  /** The Cashier being (de)activated — their profile id. */
  cashierId: string;
}

/** A validated, normalized target, ready to write to `profiles`. */
export interface DeactivateWrite {
  /** The Cashier's profile id. */
  cashierId: string;
}

export type DeactivateParseResult =
  | { ok: true; value: DeactivateWrite }
  | { ok: false; error: string };

/**
 * Validate + normalize the deactivation target into a {@link DeactivateWrite},
 * or return the problem as a human message. The only rule is that a Cashier must
 * be named (defensive — the row's button always supplies the id); the id is
 * trimmed so the eventual write matches one clean form. Shared by both the
 * deactivate and reactivate Server Actions, which differ only in whether they
 * set or clear `deactivated_at`. Pure (no I/O): the unit-tested core wrapped by
 * the Owner-gated update, which RLS re-checks via "Owner updates profiles".
 */
export function parseDeactivateInput(
  input: DeactivateInput,
): DeactivateParseResult {
  const cashierId = input.cashierId.trim();
  if (cashierId === "") {
    return { ok: false, error: "Pick a cashier." };
  }

  return { ok: true, value: { cashierId } };
}
