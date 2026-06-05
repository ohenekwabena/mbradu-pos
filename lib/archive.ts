/**
 * Archiving domain — the Owner discontinuing an Item so it drops out of the sell
 * and restock pickers, while its history (past Sale line items and the stock
 * ledger) stays intact (MP-31). Archiving is a reversible soft-delete: an Item
 * carries a nullable `archived_at` stamp (null = active).
 *
 * Like the Catalog, Stock-ledger, and Reassignment modules this file is
 * deliberately free of any server/Supabase import, so the Server Actions, the
 * inventory UI, and the unit tests share one pure core. The real writes are the
 * Owner-gated SECURITY DEFINER RPCs `archive_item` / `restore_item` /
 * `archive_product` (`…_add_item_archiving.sql`), which re-check authorization and
 * re-enforce the block-until-zero rule against live stock; this module mirrors
 * that rule so the UI can disable the action early and say why.
 *
 * **Triage decision — block-until-zero.** An Item can only be archived once its
 * stock on hand is 0 across *every* Shop: the Owner sells through or zeroes the
 * count first. The whole-Product ("discontinue line") action applies the same
 * rule to the sum across all of a cosmetic line's shades.
 */

/** Is this Item archived? `archivedAt` is the soft-delete stamp (null = active). */
export function isArchived(archivedAt: string | null | undefined): boolean {
  return archivedAt != null;
}

/**
 * Why archiving is blocked, or `null` when it's allowed. The single rule: an Item
 * must have **no stock on hand anywhere** before it can be discontinued —
 * `totalOnHand` is the sum across all Shops (for a whole line, across all its
 * shades). The message names the remaining units so the UI can surface it in a
 * disabled action's tooltip; the RPC enforces the same rule as the hard boundary.
 */
export function archiveBlockReason(totalOnHand: number): string | null {
  if (totalOnHand > 0) {
    const units = totalOnHand === 1 ? "unit" : "units";
    return `Sell or remove the ${totalOnHand} ${units} still in stock before discontinuing.`;
  }
  return null;
}

/** May an Item (or line) with this much total stock on hand be archived? */
export function canArchive(totalOnHand: number): boolean {
  return archiveBlockReason(totalOnHand) === null;
}

/** Raw input for the archive / restore actions — just the target Item id. */
export interface ArchiveInput {
  itemId: string;
}

export type ArchiveParseResult =
  | { ok: true; value: { itemId: string } }
  | { ok: false; error: string };

/**
 * Validate + normalize the archive/restore target: a non-blank Item id, trimmed.
 * Pure (no I/O) — the unit-tested guard the Server Actions wrap before the
 * Owner-gated RPC. The block-until-zero rule is *not* checked here (it depends on
 * live stock): see {@link archiveBlockReason} for the UI and the RPC for the
 * hard boundary. The id always comes from a row action, so a blank is defensive.
 */
export function parseArchiveInput(input: ArchiveInput): ArchiveParseResult {
  const itemId = input.itemId.trim();
  if (itemId === "") {
    return { ok: false, error: "Pick an item to discontinue." };
  }
  return { ok: true, value: { itemId } };
}

/** Raw input for the whole-line "discontinue" action — the cosmetic Product id. */
export interface DiscontinueProductInput {
  productId: string;
}

export type DiscontinueProductParseResult =
  | { ok: true; value: { productId: string } }
  | { ok: false; error: string };

/** Validate + normalize the whole-Product discontinue target (a non-blank id). */
export function parseDiscontinueProductInput(
  input: DiscontinueProductInput,
): DiscontinueProductParseResult {
  const productId = input.productId.trim();
  if (productId === "") {
    return { ok: false, error: "Pick a product line to discontinue." };
  }
  return { ok: true, value: { productId } };
}
