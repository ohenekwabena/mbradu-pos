/**
 * Money for Mbradu POS — Ghana Cedi (GH₵), handled as **integer minor units
 * (pesewas)** from end to end. 1 GH₵ = 100 pesewas.
 *
 * Every amount that flows through catalog pricing, sale totals, change, and
 * dashboard figures is an integer pesewa count, so arithmetic never touches
 * floating point and never drifts (0.1 + 0.2 problems can't happen). Floats
 * appear only at the very edges:
 *   - {@link parse} reads a human GH₵/decimal string into integer pesewas, and
 *   - {@link format} renders integer pesewas back to a GH₵ string.
 * Even `parse` does its rounding explicitly (see {@link parse}), so the only
 * place precision is ever decided is documented and tested.
 *
 * Single currency, business-wide (CONTEXT.md, ADR-0005). Mirrors the database,
 * where money columns are `bigint` pesewas (e.g. `items.price_pesewas`).
 *
 * PRD → "Money (GH₵)". MP-14.
 */

/**
 * An integer number of pesewas. 100 pesewas = GH₵1. Always a safe integer
 * (see {@link MAX_PESEWAS}); the type is a plain `number` for ergonomics, with
 * the integer invariant guarded at every boundary in this module.
 */
export type Pesewas = number;

/** Minor units per major unit: 100 pesewas in one Ghana Cedi. */
export const PESEWAS_PER_CEDI = 100;

/** GH₵0, the additive identity — handy as a `sum`/reduce seed. */
export const ZERO: Pesewas = 0;

/**
 * The largest pesewa magnitude we operate on safely. Money is `bigint` in
 * Postgres, but in JS we keep amounts within `Number.MAX_SAFE_INTEGER`
 * (≈ GH₵90 trillion) so integer arithmetic stays exact. Any operation that
 * would exceed this throws rather than silently lose precision.
 */
export const MAX_PESEWAS = Number.MAX_SAFE_INTEGER;

/** The Ghana Cedi symbol used in formatted output: "GH₵". */
export const CEDI_SYMBOL = "GH₵";

/**
 * Guard that a value is a safe integer count of pesewas. Throws otherwise —
 * non-integers (i.e. a float that slipped in) are a programming error, caught
 * loudly rather than rounded away.
 */
export function assertPesewas(amount: number, label = "amount"): asserts amount is Pesewas {
  if (typeof amount !== "number" || !Number.isInteger(amount)) {
    throw new TypeError(`${label} must be an integer number of pesewas, got ${amount}`);
  }
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`${label} ${amount} exceeds the safe pesewa range (±${MAX_PESEWAS})`);
  }
}

/** Internal: assert a value is a non-negative integer (e.g. a quantity). */
function assertWholeCount(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer, got ${value}`);
  }
}

/** Internal: guard a freshly-computed result back into the safe range. */
function guardResult(result: number, op: string): Pesewas {
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${op} overflowed the safe pesewa range (±${MAX_PESEWAS})`);
  }
  return result;
}

/** a + b, in pesewas. */
export function add(a: Pesewas, b: Pesewas): Pesewas {
  assertPesewas(a, "a");
  assertPesewas(b, "b");
  return guardResult(a + b, "add");
}

/** a − b, in pesewas (may be negative, e.g. change owed or a downward delta). */
export function subtract(a: Pesewas, b: Pesewas): Pesewas {
  assertPesewas(a, "a");
  assertPesewas(b, "b");
  return guardResult(a - b, "subtract");
}

/**
 * A line-item total: a unit price times a whole quantity. Quantity must be a
 * non-negative integer (you can't sell a fractional Item), so the result stays
 * an exact integer with no rounding.
 */
export function multiply(unitPrice: Pesewas, quantity: number): Pesewas {
  assertPesewas(unitPrice, "unitPrice");
  assertWholeCount(quantity, "quantity");
  return guardResult(unitPrice * quantity, "multiply");
}

/**
 * Sum a list of pesewa amounts (cart total, payments total, day's takings).
 * Empty list sums to {@link ZERO}.
 */
export function sum(amounts: readonly Pesewas[]): Pesewas {
  let total = 0;
  for (const amount of amounts) {
    assertPesewas(amount);
    total = guardResult(total + amount, "sum");
  }
  return total;
}

export interface FormatOptions {
  /** Prefix the {@link CEDI_SYMBOL} ("GH₵"). Default `true`. */
  symbol?: boolean;
  /** Group thousands with commas ("12,345.67"). Default `true`. */
  grouping?: boolean;
}

/**
 * Render integer pesewas as a GH₵ string, always with exactly two decimal
 * places: `12345` → `"GH₵123.45"`, `1234567` → `"GH₵12,345.67"`, `0` →
 * `"GH₵0.00"`. Negatives carry the sign before the symbol: `-500` →
 * `"-GH₵5.00"`. Built from integer string math (no `toFixed`/float), so the
 * output is exact for every safe-integer input and round-trips through
 * {@link parse} losslessly.
 */
export function format(amount: Pesewas, options: FormatOptions = {}): string {
  assertPesewas(amount);
  const { symbol = true, grouping = true } = options;

  const negative = amount < 0;
  const magnitude = Math.abs(amount);
  const cedis = Math.floor(magnitude / PESEWAS_PER_CEDI);
  const pesewas = magnitude % PESEWAS_PER_CEDI;

  const cedisText = grouping ? groupThousands(cedis) : String(cedis);
  const pesewasText = String(pesewas).padStart(2, "0");

  const sign = negative ? "-" : "";
  const prefix = symbol ? CEDI_SYMBOL : "";
  return `${sign}${prefix}${cedisText}.${pesewasText}`;
}

/** Insert comma thousands separators into a non-negative integer string. */
function groupThousands(value: number): string {
  const digits = String(value);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Parse a human GH₵/decimal string into integer pesewas — the inverse of
 * {@link format}. Tolerates the "GH₵"/"GHS"/"₵" symbol, comma or space
 * thousands separators, surrounding whitespace, and a leading minus.
 *
 * **Rounding (the one place it happens):** inputs with more than two decimal
 * places are rounded to the nearest pesewa, ties away from zero — `"12.345"` →
 * `1235`, `"12.344"` → `1234`, `"-0.005"` → `-1`. Inputs with two or fewer
 * decimals (everything {@link format} ever emits) are exact, so
 * `parse(format(x)) === x` for any safe-integer `x`.
 *
 * Throws on input that isn't a number (after cleaning).
 */
export function parse(input: string): Pesewas {
  const result = tryParse(input);
  if (result === null) {
    throw new SyntaxError(`Cannot parse "${input}" as a GH₵ amount`);
  }
  return result;
}

/** Non-throwing {@link parse}: returns `null` instead of throwing on bad input. */
export function tryParse(input: string): Pesewas | null {
  if (typeof input !== "string") return null;

  // Strip symbol, grouping separators, and whitespace; keep digits, sign, dot.
  const cleaned = input
    .replace(/gh₵|gh¢|ghs|₵/gi, "")
    .replace(/[,\s]/g, "")
    .trim();

  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [intPart = "0", fracPart = ""] = unsigned.split(".");

  const cedis = Number(intPart);
  // First two fractional digits are whole pesewas; a third decides rounding.
  const pesewasDigits = fracPart.slice(0, 2).padEnd(2, "0");
  let pesewas = cedis * PESEWAS_PER_CEDI + Number(pesewasDigits);
  if (fracPart.length > 2 && Number(fracPart[2]) >= 5) {
    pesewas += 1; // round half away from zero (sign applied below)
  }

  if (!Number.isSafeInteger(pesewas)) return null;
  return negative ? -pesewas : pesewas;
}
