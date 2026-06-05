/**
 * Sale-builder domain — the pure logic of a sale in progress: a cart of
 * *(Item, quantity)* lines drawn from a single Shop, its line and grand totals
 * in pesewas, the **no-oversell** guard against each Item's on-hand stock at
 * that Shop, the set of **payments** that settle it (one or more methods that
 * must sum to the total), the cash **change due**, and the validation that turns
 * the cart into the payload the `complete_sale` RPC accepts.
 *
 * Deliberately free of any server/Supabase imports (like the Money, Catalog, and
 * Stock modules) so the Server Action that completes a sale, the sell screen, and
 * the unit tests can all share it. The real write is the atomic, authorization-
 * checked `complete_sale` RPC (see `…_create_shop_stock_and_movements.sql`),
 * which is the source of truth: it re-reads each unit price server-side, re-checks
 * carried-Item and no-oversell under a row lock, and refuses any payment set that
 * doesn't sum to the total. This module is its application-layer mirror — the
 * total it computes here (to anchor the payments and the change) must equal the
 * total the RPC computes from the same `items.price_pesewas`, or the RPC rejects
 * the sale.
 *
 * Prices and availability are **never trusted from the client**: the Server
 * Action enriches each cart line with the authoritative `unitPrice` and
 * `available` it loads from `items_catalog` + `shop_stock` before calling
 * {@link parseSaleInput}. This module reasons only over those server-resolved
 * facts. The payment amounts, by contrast, are the cashier's own figures (how the
 * customer settled), validated only to sum to the total.
 *
 * MP-22 shipped the cash-only flow (a single `cash` payment for the whole total);
 * MP-23 extends the payment side to **split & multi-method** payments — any mix of
 * Cash / MoMo / Card / Transfer whose amounts add up to the total (see
 * {@link parsePayments}). Cash keeps its over-tender → {@link changeDue} behaviour
 * for the portion settled in cash.
 */

import { format, multiply, subtract, sum, tryParse, type Pesewas } from "@/lib/money";

/**
 * How a sale was paid — mirrors the `payments.method` CHECK and CONTEXT.md.
 * A sale settles in any mix of these whose amounts sum to the total.
 */
export const PAYMENT_METHODS = ["cash", "momo", "card", "transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Human label per payment method — the picker, the receipt, and error messages
 * all read from here so the wording stays in one place. */
export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  momo: "MoMo",
  card: "Card",
  transfer: "Transfer",
};

/**
 * One payment toward a sale, in the exact shape the `complete_sale` RPC reads
 * from its `p_payments` jsonb (`method`, `amount_pesewas`). The RPC requires the
 * payments to sum to the sale total; {@link parsePayments} enforces the same in
 * the app so the cashier gets an instant error instead of a round-trip.
 */
export interface Payment {
  method: PaymentMethod;
  amount_pesewas: Pesewas;
}

/**
 * One payment row as the cashier enters it on the sell screen: a chosen method
 * and the amount charged to it, a GH₵/decimal string (e.g. "100" or "100.00").
 * Normalized into a {@link Payment} by {@link parsePayments}.
 */
export interface PaymentInput {
  method: PaymentMethod;
  amount: string;
}

/**
 * A line total: a unit price times a whole quantity, in pesewas. Thin wrapper
 * over {@link multiply} (which asserts an integer price and a non-negative whole
 * quantity), named for the domain so the sell screen and totals read clearly.
 */
export function lineSubtotal(unitPrice: Pesewas, quantity: number): Pesewas {
  return multiply(unitPrice, quantity);
}

/** A cart line's priced quantity — the minimum {@link saleTotal} needs. */
interface PricedLine {
  unitPrice: Pesewas;
  quantity: number;
}

/**
 * The grand total of a cart: the sum of every line's {@link lineSubtotal}, in
 * pesewas. Empty cart totals to `0`. Used live by the sell screen as quantities
 * change and to anchor the payments; the `complete_sale` RPC computes the same
 * figure from server-side prices and is the final authority.
 */
export function saleTotal(lines: readonly PricedLine[]): Pesewas {
  return sum(lines.map((line) => lineSubtotal(line.unitPrice, line.quantity)));
}

/** The sum of a payment set's amounts, in pesewas — what must equal the sale
 * total before the sale can complete. Empty set sums to `0`. */
export function paymentsTotal(payments: readonly Payment[]): Pesewas {
  return sum(payments.map((payment) => payment.amount_pesewas));
}

/**
 * The cash balance of a tender against what is owed in cash: `tendered − owed`,
 * in pesewas. **Signed**, so one value drives the whole live indicator:
 *   - `> 0` — change to hand back to the customer;
 *   - `0`   — exact money, nothing owed either way;
 *   - `< 0` — the tender is short by this much (still owed).
 *
 * `owed` is the amount charged to **cash** (the cash row of a split, or the whole
 * total for a cash-only sale), not necessarily the grand total — in a split sale
 * the customer only tenders cash for the cash portion. The receipt shows the
 * positive case as "Change".
 */
export function changeDue(owed: Pesewas, tendered: Pesewas): Pesewas {
  return subtract(tendered, owed);
}

/**
 * One cart line as the builder validates it: which Item, the quantity being
 * sold, and the two facts the Server Action resolves server-side — the Item's
 * catalog `unitPrice` (pesewas) and how many are `available` at this Shop.
 * `available` is `null` when the Shop **does not carry** the Item (no
 * `shop_stock` row) — distinct from carrying 0 — and {@link parseSaleInput}
 * rejects such a line. `name` is carried only for friendlier error messages.
 */
export interface SaleLineInput {
  itemId: string;
  name?: string;
  quantity: number;
  unitPrice: Pesewas;
  available: number | null;
}

/** Raw sell-form input: the chosen Shop, the cart, an optional customer, the
 * payments that settle the sale, and the cash tendered as a GH₵ string. */
export interface SaleInput {
  shopId: string;
  customer: string;
  lines: SaleLineInput[];
  /**
   * One row per chosen method; amounts are GH₵ strings and must sum to the
   * total. A method toggled on but left blank/zero is ignored (not an error), so
   * the common one-method sale is just a single row.
   */
  payments: PaymentInput[];
  /**
   * Cash physically handed over, a GH₵ string — drives the change shown for the
   * cash portion. Optional: blank means no change was computed (e.g. an exact or
   * fully cashless sale).
   */
  tendered: string;
}

/**
 * A validated sale, ready for the `complete_sale` RPC. `lines` and `payments`
 * use the snake-cased keys the RPC reads from its jsonb arguments
 * (`{ item_id, quantity }`, `{ method, amount_pesewas }`). `total`, `tendered`,
 * and `change` are carried through for the receipt and the post-sale redirect;
 * they are not sent to the RPC (which recomputes the total itself).
 */
export interface SaleWrite {
  shopId: string;
  customer: string | null;
  lines: { item_id: string; quantity: number }[];
  payments: Payment[];
  total: Pesewas;
  tendered: Pesewas;
  change: Pesewas;
}

export type SaleParseResult =
  | { ok: true; value: SaleWrite }
  | { ok: false; error: string };

export type PaymentsParseResult =
  | { ok: true; payments: Payment[]; cashApplied: Pesewas }
  | { ok: false; error: string };

/**
 * Validate the cashier's payment rows against the sale total and normalize them
 * into the `Payment[]` the `complete_sale` RPC reads. Mirrors — early, in the
 * app — the RPC's rule that the payments must sum to **exactly** the total:
 *   - each row's method must be one of {@link PAYMENT_METHODS};
 *   - each amount must parse as a non-negative GH₵ value; a blank/zero row is a
 *     method toggled on but left unused and is dropped (not an error);
 *   - at least one paying row must remain;
 *   - the kept amounts must sum to the total — short or over is rejected with a
 *     message naming the gap.
 *
 * Also returns the **cash applied** (sum of the cash rows) so the caller can
 * compute the change against what was charged to cash, not the whole total.
 * Pure; the directly-tested core of the split-payment rule.
 */
export function parsePayments(inputs: readonly PaymentInput[], total: Pesewas): PaymentsParseResult {
  const payments: Payment[] = [];
  for (const row of inputs) {
    if (!PAYMENT_METHODS.includes(row.method)) {
      return { ok: false, error: "Choose a valid payment method." };
    }
    const raw = row.amount.trim();
    if (raw === "") continue; // toggled on but left blank — pays nothing
    const amount = tryParse(raw);
    if (amount === null || amount < 0) {
      return { ok: false, error: `Enter a valid amount for ${METHOD_LABEL[row.method]}.` };
    }
    if (amount === 0) continue; // an explicit zero also pays nothing
    payments.push({ method: row.method, amount_pesewas: amount });
  }

  if (payments.length === 0) {
    return { ok: false, error: "Enter how the sale was paid." };
  }

  const paid = paymentsTotal(payments);
  if (paid < total) {
    return { ok: false, error: `Payments are ${format(subtract(total, paid))} short of the total.` };
  }
  if (paid > total) {
    return { ok: false, error: `Payments are ${format(subtract(paid, total))} over the total.` };
  }

  const cashApplied = sum(
    payments.filter((payment) => payment.method === "cash").map((payment) => payment.amount_pesewas),
  );
  return { ok: true, payments, cashApplied };
}

/** A line's display name for an error message, or a generic fallback. */
function lineLabel(line: SaleLineInput): string {
  const name = line.name?.trim();
  return name ? `“${name}”` : "an item";
}

/**
 * Validate + normalize a cart into a {@link SaleWrite}, or return the first
 * problem as a human message. Mirrors — early, in the app — exactly what
 * `complete_sale` enforces at the database, so the Cashier gets an instant,
 * specific error instead of a round-trip:
 *   - a Shop must be set and the cart must hold at least one line;
 *   - duplicate lines for the same Item are merged (quantities summed) so the
 *     oversell guard sees the true quantity per Item;
 *   - every quantity must be a whole number greater than 0;
 *   - an Item the Shop doesn't carry (`available === null`) is rejected
 *     ("not carried"), separately from being out of / low on stock;
 *   - no line may exceed the Item's `available` stock (the **no-oversell**
 *     guard — selling at the boundary, quantity == available, is allowed);
 *   - the payments must sum to the total (see {@link parsePayments}).
 *
 * The cash **change** is the over-tender against the cash portion only
 * (`tendered − cash applied`, never negative); it isn't a payment row and isn't
 * sent to the RPC — it rides along for the receipt.
 *
 * Pure (no I/O): the unit-tested core the Server Action wraps before the
 * authorization-checked, atomic `complete_sale` RPC, which re-validates all of
 * the above against a locked snapshot of stock and is the final authority.
 */
export function parseSaleInput(input: SaleInput): SaleParseResult {
  const shopId = input.shopId.trim();
  if (!shopId) return { ok: false, error: "Choose a shop to sell from." };

  if (input.lines.length === 0) {
    return { ok: false, error: "Add at least one item to the sale." };
  }

  // Merge duplicate lines by Item so the oversell guard and the total reflect
  // the true quantity per Item (the sell screen keys the cart by Item, so this
  // is defence-in-depth). First occurrence sets the price/availability/name.
  const merged = new Map<string, SaleLineInput & { quantity: number }>();
  for (const line of input.lines) {
    const itemId = line.itemId.trim();
    if (!itemId) return { ok: false, error: "A cart line is missing its item." };

    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      return {
        ok: false,
        error: `Set a whole quantity above 0 for ${lineLabel(line)}.`,
      };
    }

    const existing = merged.get(itemId);
    if (existing) existing.quantity += line.quantity;
    else merged.set(itemId, { ...line, itemId, quantity: line.quantity });
  }

  const lines: { item_id: string; quantity: number }[] = [];
  const priced: PricedLine[] = [];
  for (const line of merged.values()) {
    if (line.available === null || line.available === undefined) {
      return {
        ok: false,
        error: `${lineLabel(line)} isn’t stocked at this shop.`,
      };
    }
    if (line.quantity > line.available) {
      return {
        ok: false,
        error: `Only ${line.available} of ${lineLabel(line)} left at this shop.`,
      };
    }
    lines.push({ item_id: line.itemId, quantity: line.quantity });
    priced.push({ unitPrice: line.unitPrice, quantity: line.quantity });
  }

  const total = saleTotal(priced);

  const paymentsResult = parsePayments(input.payments, total);
  if (!paymentsResult.ok) return { ok: false, error: paymentsResult.error };
  const { payments, cashApplied } = paymentsResult;

  // Change is the over-tender on the cash portion only; 0 when no cash was taken
  // or no tender was entered. A short tender clamps to 0 (the cash row already
  // records what's owed) — it doesn't block completion, since the payments balance.
  const tendered = parseTender(input.tendered);
  const change =
    tendered !== null && cashApplied > 0 ? Math.max(0, changeDue(cashApplied, tendered)) : 0;

  const customerText = input.customer.trim();
  const customer = customerText === "" ? null : customerText;

  return {
    ok: true,
    value: {
      shopId,
      customer,
      lines,
      payments,
      total,
      // For the receipt's change line: the cash tendered when given, else the
      // cash charged (so change reads 0) — irrelevant when the sale took no cash.
      tendered: tendered ?? cashApplied,
      change,
    },
  };
}

/**
 * Parse the cash-tendered field into integer pesewas, or `null` when it's blank
 * or not a valid non-negative amount. Uses the Money module's tolerant
 * {@link tryParse} (accepts "GH₵", commas, spaces). A blank or negative tender
 * yields `null` — it simply means no change is computed, which is fine: the
 * tender is a cash-handling aid, not a gate on completion.
 */
function parseTender(raw: string): Pesewas | null {
  if (raw.trim() === "") return null;
  const value = tryParse(raw);
  if (value === null || value < 0) return null;
  return value;
}
