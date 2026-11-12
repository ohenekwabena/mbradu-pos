import { describe, expect, it } from "vitest";

import { applyStock, clampCartLine, deductSold, setAvailable } from "./sell-stock";

const items = [
  { id: "a", stock: 2, name: "A" },
  { id: "b", stock: 4, name: "B" },
];

describe("deductSold", () => {
  it("takes sold quantities off matching Items, merging duplicates and flooring at 0", () => {
    expect(
      deductSold(items, [
        { item_id: "a", quantity: 1 },
        { item_id: "a", quantity: 5 },
      ]).map((i) => i.stock),
    ).toEqual([0, 4]);
  });
});

describe("applyStock", () => {
  it("adopts live quantities, e.g. an Item restocked from 0", () => {
    const out = applyStock([{ id: "a", stock: 0 }, items[1]], [{ item_id: "a", quantity: 10 }]);
    expect(out.map((i) => i.stock)).toEqual([10, 4]);
  });

  it("returns the same array when nothing changed", () => {
    expect(applyStock(items, [{ item_id: "a", quantity: 2 }, { item_id: "zzz", quantity: 9 }])).toBe(items);
  });
});

describe("setAvailable", () => {
  it("sets one Item's stock", () => {
    expect(setAvailable(items, "b", 1).map((i) => i.stock)).toEqual([2, 1]);
  });
});

describe("clampCartLine", () => {
  const cart = new Map([
    ["a", { item: items[0], qty: 2 }],
    ["b", { item: items[1], qty: 3 }],
  ]);

  it("lowers the quantity and the carried stock to what's left", () => {
    const next = clampCartLine(cart, "b", 1);
    expect(next.get("b")).toEqual({ item: { ...items[1], stock: 1 }, qty: 1 });
    expect(next.get("a")).toBe(cart.get("a"));
  });

  it("drops the line when none are left, and ignores unknown Items", () => {
    expect(clampCartLine(cart, "a", 0).has("a")).toBe(false);
    expect(clampCartLine(cart, "zzz", 0).size).toBe(2);
  });
});
