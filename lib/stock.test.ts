import { describe, it, expect } from "vitest";

import {
  buildRestockMovement,
  parseRestockInput,
  quantityFromMovements,
  STOCK_REASONS,
  sumMovements,
  type Movement,
  type RestockInput,
} from "./stock";

describe("STOCK_REASONS", () => {
  it("mirrors the stock_movements.reason CHECK (sale / restock / correction)", () => {
    expect(STOCK_REASONS).toEqual(["sale", "restock", "correction"]);
  });
});

describe("sumMovements / quantityFromMovements", () => {
  it("sums the signed amounts of a (Item, Shop)'s movements", () => {
    const ledger: Movement[] = [
      { reason: "restock", amount: 10 },
      { reason: "sale", amount: -3 },
      { reason: "restock", amount: 5 },
      { reason: "correction", amount: -2 },
    ];
    expect(sumMovements(ledger)).toBe(10);
    expect(quantityFromMovements(ledger)).toBe(10);
  });

  it("is 0 for an empty ledger (a carried Shop stock with no net movement)", () => {
    expect(sumMovements([])).toBe(0);
    expect(quantityFromMovements([])).toBe(0);
  });

  it("never returns a negative quantity — the sum is floored at 0", () => {
    // A net-negative ledger can't occur through the RPCs, but the derived
    // quantity must still mirror the `quantity >= 0` CHECK if one slips in.
    const ledger: Movement[] = [
      { reason: "restock", amount: 2 },
      { reason: "correction", amount: -5 },
    ];
    expect(sumMovements(ledger)).toBe(-3);
    expect(quantityFromMovements(ledger)).toBe(0);
  });

  it("rises by exactly N when a Restock of N is appended (the ledger invariant)", () => {
    const before: Movement[] = [
      { reason: "restock", amount: 8 },
      { reason: "sale", amount: -3 },
    ];
    const after = [...before, buildRestockMovement(6)];
    expect(quantityFromMovements(after)).toBe(quantityFromMovements(before) + 6);
    expect(quantityFromMovements(after)).toBe(11);
  });
});

describe("buildRestockMovement", () => {
  it("constructs a positive 'restock' movement (sign matches reason)", () => {
    expect(buildRestockMovement(12)).toEqual({ reason: "restock", amount: 12 });
  });

  it("rejects a non-positive or fractional amount", () => {
    expect(() => buildRestockMovement(0)).toThrow();
    expect(() => buildRestockMovement(-4)).toThrow();
    expect(() => buildRestockMovement(2.5)).toThrow();
  });
});

describe("parseRestockInput", () => {
  const base: RestockInput = {
    itemId: "item-1",
    shopId: "shop-1",
    amount: "12",
    note: "New supplier delivery",
  };

  it("accepts a valid restock and normalizes it for the RPC", () => {
    const result = parseRestockInput(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      itemId: "item-1",
      shopId: "shop-1",
      amount: 12,
      note: "New supplier delivery",
    });
  });

  it("trims a note and treats a blank one as null", () => {
    expect(parseRestockInput({ ...base, note: "  walk-in restock  " })).toMatchObject({
      ok: true,
      value: { note: "walk-in restock" },
    });
    expect(parseRestockInput({ ...base, note: "   " })).toMatchObject({
      ok: true,
      value: { note: null },
    });
  });

  it("requires an item and a shop to be chosen", () => {
    expect(parseRestockInput({ ...base, itemId: "  " })).toEqual({
      ok: false,
      error: "Choose an item to restock.",
    });
    expect(parseRestockInput({ ...base, shopId: "" })).toEqual({
      ok: false,
      error: "Choose a shop to restock.",
    });
  });

  it("requires a whole quantity greater than 0", () => {
    for (const amount of ["", "0", "-3", "2.5", "ten", "1e3", "  "]) {
      expect(parseRestockInput({ ...base, amount }).ok).toBe(false);
    }
  });

  it("accepts a padded/whitespace-wrapped whole number", () => {
    const result = parseRestockInput({ ...base, amount: "  007 " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount).toBe(7);
  });
});
