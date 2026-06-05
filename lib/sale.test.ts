import { describe, it, expect } from "vitest";

import {
  buildCashPayment,
  changeDue,
  lineSubtotal,
  parseSaleInput,
  PAYMENT_METHODS,
  saleTotal,
  type SaleInput,
  type SaleLineInput,
} from "./sale";

describe("PAYMENT_METHODS", () => {
  it("mirrors the payments.method CHECK (cash / momo / card / transfer)", () => {
    expect(PAYMENT_METHODS).toEqual(["cash", "momo", "card", "transfer"]);
  });
});

describe("lineSubtotal / saleTotal", () => {
  it("multiplies unit price by quantity for a line", () => {
    expect(lineSubtotal(15000, 3)).toBe(45000); // GH₵150.00 × 3 = GH₵450.00
  });

  it("sums every line's subtotal into the grand total", () => {
    const total = saleTotal([
      { unitPrice: 15000, quantity: 2 }, // 30000
      { unitPrice: 4999, quantity: 1 }, // 4999
      { unitPrice: 2500, quantity: 4 }, // 10000
    ]);
    expect(total).toBe(44999); // GH₵449.99
  });

  it("is 0 for an empty cart", () => {
    expect(saleTotal([])).toBe(0);
  });
});

describe("changeDue", () => {
  it("is the positive change when the tender exceeds the total", () => {
    expect(changeDue(44999, 50000)).toBe(5001); // GH₵50.01 change
  });

  it("is 0 when the tender is exact", () => {
    expect(changeDue(44999, 44999)).toBe(0);
  });

  it("is negative (the shortfall) when the tender is short", () => {
    expect(changeDue(44999, 40000)).toBe(-4999);
  });
});

describe("buildCashPayment", () => {
  it("settles the whole total as a single cash payment", () => {
    expect(buildCashPayment(44999)).toEqual({ method: "cash", amount_pesewas: 44999 });
  });

  it("records the total even when more was tendered (over-tender is change, not a payment)", () => {
    // The caller computes change separately; the payment is always the total.
    expect(buildCashPayment(30000)).toEqual({ method: "cash", amount_pesewas: 30000 });
  });

  it("rejects a negative or fractional total", () => {
    expect(() => buildCashPayment(-1)).toThrow();
    expect(() => buildCashPayment(12.5)).toThrow();
  });
});

describe("parseSaleInput", () => {
  const lipstick: SaleLineInput = {
    itemId: "item-lipstick",
    name: "Ruby Woo lipstick",
    quantity: 2,
    unitPrice: 15000, // GH₵150.00
    available: 5,
  };
  const wig: SaleLineInput = {
    itemId: "item-wig",
    name: "Brazilian body wave",
    quantity: 1,
    unitPrice: 120000, // GH₵1,200.00
    available: 3,
  };
  const base: SaleInput = {
    shopId: "shop-1",
    customer: "Ama",
    lines: [lipstick, wig],
    tendered: "1600", // GH₵1,600.00 against a GH₵1,500.00 total
  };

  it("accepts a valid cart and normalizes it for the complete_sale RPC", () => {
    const result = parseSaleInput(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      shopId: "shop-1",
      customer: "Ama",
      lines: [
        { item_id: "item-lipstick", quantity: 2 },
        { item_id: "item-wig", quantity: 1 },
      ],
      payments: [{ method: "cash", amount_pesewas: 150000 }],
      total: 150000, // 30000 + 120000
      tendered: 160000,
      change: 10000, // GH₵100.00 change
    });
  });

  it("computes the total from the server-resolved unit prices, not the tender", () => {
    const result = parseSaleInput({ ...base, tendered: "5000" /* GH₵5,000 */ });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(150000);
    expect(result.value.payments).toEqual([{ method: "cash", amount_pesewas: 150000 }]);
    expect(result.value.change).toBe(500000 - 150000);
  });

  it("requires a shop and at least one line", () => {
    expect(parseSaleInput({ ...base, shopId: "  " })).toEqual({
      ok: false,
      error: "Choose a shop to sell from.",
    });
    expect(parseSaleInput({ ...base, lines: [] })).toEqual({
      ok: false,
      error: "Add at least one item to the sale.",
    });
  });

  it("blocks overselling — a quantity beyond the Shop's available stock", () => {
    const result = parseSaleInput({
      ...base,
      lines: [{ ...lipstick, quantity: 6 }], // only 5 available
      tendered: "100000",
    });
    expect(result).toEqual({
      ok: false,
      error: "Only 5 of “Ruby Woo lipstick” left at this shop.",
    });
  });

  it("allows selling exactly the available stock (the boundary is not oversell)", () => {
    const result = parseSaleInput({
      ...base,
      lines: [{ ...lipstick, quantity: 5 }], // exactly available
      tendered: "100000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toEqual([{ item_id: "item-lipstick", quantity: 5 }]);
    expect(result.value.total).toBe(75000);
  });

  it("rejects an Item the Shop doesn't carry (available === null), distinct from out-of-stock", () => {
    const result = parseSaleInput({
      ...base,
      lines: [{ ...lipstick, available: null }],
      tendered: "100000",
    });
    expect(result).toEqual({
      ok: false,
      error: "“Ruby Woo lipstick” isn’t stocked at this shop.",
    });
  });

  it("rejects a non-whole or non-positive quantity", () => {
    for (const quantity of [0, -1, 2.5]) {
      const result = parseSaleInput({ ...base, lines: [{ ...lipstick, quantity }] });
      expect(result.ok).toBe(false);
    }
  });

  it("merges duplicate lines for the same Item before the oversell guard", () => {
    // Two cart rows of the same Item, 3 + 3 = 6, but only 5 are available.
    const result = parseSaleInput({
      ...base,
      lines: [
        { ...lipstick, quantity: 3 },
        { ...lipstick, quantity: 3 },
      ],
      tendered: "100000",
    });
    expect(result).toEqual({
      ok: false,
      error: "Only 5 of “Ruby Woo lipstick” left at this shop.",
    });
  });

  it("sums merged duplicate quantities when within stock", () => {
    const result = parseSaleInput({
      ...base,
      lines: [
        { ...lipstick, quantity: 2 },
        { ...lipstick, quantity: 1 },
      ],
      tendered: "100000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toEqual([{ item_id: "item-lipstick", quantity: 3 }]);
    expect(result.value.total).toBe(45000);
  });

  it("rejects a cash tender below the total (no negative change)", () => {
    expect(parseSaleInput({ ...base, tendered: "1000" /* GH₵1,000 < GH₵1,500 */ })).toEqual({
      ok: false,
      error: "Cash received is less than the total.",
    });
  });

  it("requires the cash tendered to be entered and valid", () => {
    for (const tendered of ["", "   ", "abc", "-50"]) {
      expect(parseSaleInput({ ...base, tendered })).toEqual({
        ok: false,
        error: "Enter the cash received from the customer.",
      });
    }
  });

  it("accepts a tender written with the GH₵ symbol and grouping", () => {
    const result = parseSaleInput({ ...base, tendered: "GH₵ 1,500.00" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tendered).toBe(150000);
    expect(result.value.change).toBe(0); // exact
  });

  it("treats a blank customer name as null but keeps and trims a real one", () => {
    expect(parseSaleInput({ ...base, customer: "   " })).toMatchObject({
      ok: true,
      value: { customer: null },
    });
    expect(parseSaleInput({ ...base, customer: "  Kofi  " })).toMatchObject({
      ok: true,
      value: { customer: "Kofi" },
    });
  });
});
