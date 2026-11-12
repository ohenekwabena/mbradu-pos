import { describe, expect, it } from "vitest";

import { applyPrices, priceChange } from "./price-change";

const shown = [
  { itemId: "a", name: "Wig A", quantity: 1, unitPrice: 45_000 },
  { itemId: "b", name: "Lipstick", quantity: 2, unitPrice: 9_000 },
];

describe("priceChange", () => {
  it("lists only the moved lines with old and new totals", () => {
    expect(priceChange(shown, [{ itemId: "a", price: 45_000 }, { itemId: "b", price: 10_000 }])).toEqual({
      changed: [{ itemId: "b", name: "Lipstick", quantity: 2, oldPrice: 9_000, newPrice: 10_000 }],
      oldTotal: 63_000,
      newTotal: 65_000,
    });
  });

  it("handles a price drop and unreported lines keep their shown price", () => {
    const change = priceChange(shown, [{ itemId: "a", price: 40_000 }]);
    expect(change?.newTotal).toBe(58_000);
    expect(change?.changed.map((c) => c.itemId)).toEqual(["a"]);
  });

  it("returns null when nothing moved", () => {
    expect(priceChange(shown, [{ itemId: "a", price: 45_000 }, { itemId: "b", price: 9_000 }])).toBeNull();
    expect(priceChange(shown, [])).toBeNull();
  });
});

describe("applyPrices", () => {
  it("updates matching items, keeping identity for unchanged ones", () => {
    const items = [
      { id: "a", price: 45_000, stock: 1 },
      { id: "b", price: 9_000, stock: 3 },
    ];
    const next = applyPrices(items, [{ itemId: "b", price: 10_000 }, { itemId: "zzz", price: 1 }]);
    expect(next[0]).toBe(items[0]);
    expect(next[1]).toEqual({ id: "b", price: 10_000, stock: 3 });
  });
});
