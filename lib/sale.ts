/**
 * Sale-builder domain — the pure logic of a cash sale in progress: a cart of
 * *(Item, quantity)* lines drawn from a single Shop, its line and grand totals
 * in pesewas, the **no-oversell** guard against each Item's on-hand stock at
 * that Shop, the cash **change due**, and the validation that turns the cart
 * into the payload the `complete_sale` RPC accepts.
 *
 * Deliberately free of any server/Supabase imports (like the Money, Catalog, and
 * Stock modules) so the Server Action that completes a sale, the sell screen, and
 * the unit tests can all share it. The real write is the atomic, authorization-
 * checked `complete_sale` RPC (see `…_create_shop_stock_and_movements.sql`),
 * which is the source of truth: it re-reads each unit price server-side, re-checks
 * carried-Item and no-oversell under a row lock, and refuses any payment set that
 * doesn't sum to the total. This module is its application-layer mirror — the
 * total it computes here (to anchor the cash payment and the change) must equal
 * the total the RPC computes from the same `items.price_pesewas`, or the RPC
 * rejects the sale.
 *
 * Prices and availability are **never trusted from the client**: the Server
 * Action enriches each cart line with the authoritative `unitPrice` and
 * `available` it loads from `items_catalog` + `shop_stock` before calling
 * {@link parseSaleInput}. This module reasons only over those server-resolved
 * facts.
 *
 * MP-22 ships the cash sell flow; MP-23 extends the payment side to split &
 * multi-method payments (the {@link PaymentMethod} set is already the full DB
 * enum, but the cash flow only ever builds a single `cash` payment).
 */

import { multiply, subtract, sum, tryParse, type Pesewas } from "@/lib/money";

/**
 * How a sale was paid — mirrors the `payments.method` CHECK and CONTEXT.md.
 * v1 settles in cash (MP-22); MoMo / Card / Transfer and split payments arrive
 * with MP-23, but the type is the full enum from the start so the payload shape
 * never has to change.
 */
export const PAYMENT_METHODS = ["cash", "momo", "card", "transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * One payment toward a sale, in the exact shape the `complete_sale` RPC reads
 * from its `p_payments` jsonb (`method`, `amount_pesewas`). The RPC requires the
 * payments to sum to the sale total; the cash flow builds exactly one of these
 * for the whole total (see {@link buildCashPayment}).
 */
export interface Payment {
  method: PaymentMethod;
  amount_pesewas: Pesewas;
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
 * change and to anchor the cash payment; the `complete_sale` RPC computes the
 * same figure from server-side prices and is the final authority.
 */
export function saleTotal(lines: readonly PricedLine[]): Pesewas {
  return sum(lines.map((line) => lineSubtotal(line.unitPrice, line.quantity)));
}

/**
 * The cash balance of a tender against the total: `tendered − total`, in
 * pesewas. **Signed**, so one value drives the whole live indicator:
 *   - `> 0` — change to hand back to the customer;
 *   - `0`   — exact money, nothing owed either way;
 *   - `< 0` — the tender is short by this much (still owed).
 *
 * The receipt shows the positive case as "Change". A cash sale can't be
 * completed while this is negative — {@link parseSaleInput} rejects a short
 * tender, and the sell screen disables the complete button.
 */
export function changeDue(total: Pesewas, tendered: Pesewas): Pesewas {
  return subtract(tendered, total);
}

/**
 * The single cash {@link Payment} that settles a whole sale: method `"cash"`
 * with the sale total as `amount_pesewas`. The payment recorded is the **total**,
 * not the cash tendered — the over-tender becomes {@link changeDue}, never a
 * payment row (the RPC requires payments to sum to exactly the total). Throws on
 * a negative or non-integer total (a programming error; the total comes from
 * {@link saleTotal}).
 */
export function buildCashPayment(total: Pesewas): Payment {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError(`a cash payment total must be a non-negative integer, got ${total}`);
  }
  return { method: "cash", amount_pesewas: total };
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

/** Raw sell-form input: the chosen Shop, the cart, an optional customer, and the
 * cash tendered as a GH₵ string (e.g. "120" or "120.00"). */
export interface SaleInput {
  shopId: string;
  customer: string;
  lines: SaleLineInput[];
  /** Cash received from the customer, a GH₵/decimal string. */
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
 *   - the cash tendered must parse and be **at least** the total (a cash sale
 *     can't be completed short); the recorded payment is the total, and the
 *     over-tender becomes the change.
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

  const tendered = parseTender(input.tendered);
  if (tendered === null) {
    return { ok: false, error: "Enter the cash received from the customer." };
  }
  if (tendered < total) {
    return { ok: false, error: "Cash received is less than the total." };
  }

  const customerText = input.customer.trim();
  const customer = customerText === "" ? null : customerText;

  return {
    ok: true,
    value: {
      shopId,
      customer,
      lines,
      payments: [buildCashPayment(total)],
      total,
      tendered,
      change: changeDue(total, tendered),
    },
  };
}

/**
 * Parse the cash-tendered field into integer pesewas, or `null` when it isn't a
 * valid non-negative amount. Uses the Money module's tolerant {@link tryParse}
 * (accepts "GH₵", commas, spaces) but rejects a blank or a negative tender,
 * which can't be a cash payment.
 */
function parseTender(raw: string): Pesewas | null {
  if (raw.trim() === "") return null;
  const value = tryParse(raw);
  if (value === null || value < 0) return null;
  return value;
}
