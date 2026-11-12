import { describe, expect, it } from "vitest";

import { format } from "./money";
import { parseSaleError, SALE_ERROR_CODES, saleErrorMessage } from "./sale-errors";

const names: Record<string, string> = { "item-1": "Ruby Woo – Shade 3" };
const lookup = (id: string) => names[id];

describe("parseSaleError", () => {
  it("reads insufficient_stock with its item and available quantity", () => {
    const err = parseSaleError({
      message: "insufficient_stock",
      details: JSON.stringify({ item_id: "item-1", available: 1, requested: 3 }),
    });
    expect(err).toEqual({ code: "insufficient_stock", itemId: "item-1", available: 1 });
  });

  it("reads price_changed with the server total and current prices", () => {
    const err = parseSaleError({
      message: "price_changed",
      details: JSON.stringify({
        total_pesewas: 32_000,
        expected_pesewas: 30_000,
        prices: [{ item_id: "item-1", price_pesewas: 16_000 }, { item_id: 7 }],
      }),
    });
    expect(err).toEqual({
      code: "price_changed",
      total: 32_000,
      prices: [{ itemId: "item-1", price: 16_000 }],
    });
  });

  it("accepts a code with no detail, or an unparseable detail", () => {
    expect(parseSaleError({ message: "empty_sale" })).toEqual({ code: "empty_sale" });
    expect(parseSaleError({ message: "not_carried", details: "not json" })).toEqual({ code: "not_carried" });
  });

  it("treats unknown messages, raw database text and missing errors as unexpected", () => {
    expect(parseSaleError({ message: "insufficient stock for item 123 (have 1, need 2)" })).toEqual({
      code: "unexpected",
    });
    expect(parseSaleError({ message: "TypeError: Failed to fetch" })).toEqual({ code: "unexpected" });
    expect(parseSaleError(null)).toEqual({ code: "unexpected" });
  });
});

describe("saleErrorMessage", () => {
  it("names the item and what's left for insufficient stock", () => {
    const msg = saleErrorMessage({ code: "insufficient_stock", itemId: "item-1", available: 1 }, lookup);
    expect(msg).toBe(
      "Only 1 of “Ruby Woo – Shade 3” left at this shop — the cart has been updated. Check it and complete again.",
    );
  });

  it("says out of stock when none are left", () => {
    expect(saleErrorMessage({ code: "insufficient_stock", itemId: "item-1", available: 0 }, lookup)).toMatch(
      /“Ruby Woo – Shade 3” is out of stock/,
    );
  });

  it("falls back to a generic label when the item name is unknown", () => {
    expect(saleErrorMessage({ code: "not_carried", itemId: "nope" }, lookup)).toMatch(/^An item isn’t stocked/);
  });

  it("quotes the new total for a price change", () => {
    expect(saleErrorMessage({ code: "price_changed", total: 32_000 })).toContain(format(32_000));
  });

  it("reassures that an unexpected failure won't double-record", () => {
    expect(saleErrorMessage({ code: "unexpected" })).toMatch(/won’t be recorded twice/);
  });

  it("has copy for every stable code, none of it raw codes", () => {
    for (const code of SALE_ERROR_CODES) {
      const msg = saleErrorMessage({ code });
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toContain(code);
    }
  });
});
