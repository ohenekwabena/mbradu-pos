import { describe, it, expect } from "vitest";

import {
  changeDue,
  lineSubtotal,
  METHOD_LABEL,
  parsePayments,
  parseSaleInput,
  paymentsTotal,
  PAYMENT_METHODS,
  saleTotal,
  type PaymentInput,
  type PaymentMethod,
  type SaleInput,
  type SaleLineInput,
} from "./sale";

describe("PAYMENT_METHODS", () => {
  it("mirrors the payments.method CHECK (cash / momo / card / transfer)", () => {
    expect(PAYMENT_METHODS).toEqual(["cash", "momo", "card", "transfer"]);
  });
});

describe("METHOD_LABEL", () => {
  it("gives a human label for every method", () => {
    expect(PAYMENT_METHODS.map((m) => METHOD_LABEL[m])).toEqual(["Cash", "MoMo", "Card", "Transfer"]);
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

describe("paymentsTotal", () => {
  it("sums a payment set's amounts", () => {
    expect(
      paymentsTotal([
        { method: "cash", amount_pesewas: 5000 },
        { method: "momo", amount_pesewas: 10000 },
      ]),
    ).toBe(15000);
  });

  it("is 0 for no payments", () => {
    expect(paymentsTotal([])).toBe(0);
  });
});

describe("changeDue", () => {
  it("is the positive change when the tender exceeds what's owed in cash", () => {
    expect(changeDue(44999, 50000)).toBe(5001); // GH₵50.01 change
  });

  it("is 0 when the tender is exact", () => {
    expect(changeDue(44999, 44999)).toBe(0);
  });

  it("is negative (the shortfall) when the tender is short", () => {
    expect(changeDue(44999, 40000)).toBe(-4999);
  });
});

describe("parsePayments", () => {
  it("accepts a single method that covers the whole total", () => {
    expect(parsePayments([{ method: "cash", amount: "150" }], 15000)).toEqual({
      ok: true,
      payments: [{ method: "cash", amount_pesewas: 15000 }],
      cashApplied: 15000,
    });
  });

  it("accepts a split across methods that sums to the total, preserving order", () => {
    expect(
      parsePayments(
        [
          { method: "momo", amount: "100" },
          { method: "cash", amount: "50" },
        ],
        15000,
      ),
    ).toEqual({
      ok: true,
      payments: [
        { method: "momo", amount_pesewas: 10000 },
        { method: "cash", amount_pesewas: 5000 },
      ],
      cashApplied: 5000,
    });
  });

  it("reports cashApplied as 0 for a fully cashless sale", () => {
    const result = parsePayments([{ method: "momo", amount: "150" }], 15000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cashApplied).toBe(0);
  });

  it("drops methods toggled on but left blank or zero", () => {
    expect(
      parsePayments(
        [
          { method: "cash", amount: "150" },
          { method: "momo", amount: "" },
          { method: "card", amount: "0" },
        ],
        15000,
      ),
    ).toEqual({
      ok: true,
      payments: [{ method: "cash", amount_pesewas: 15000 }],
      cashApplied: 15000,
    });
  });

  it("rejects a set short of the total, naming the gap", () => {
    expect(parsePayments([{ method: "cash", amount: "100" }], 15000)).toEqual({
      ok: false,
      error: "Payments are GH₵ 50.00 short of the total.",
    });
  });

  it("rejects a set over the total, naming the excess", () => {
    expect(
      parsePayments(
        [
          { method: "momo", amount: "100" },
          { method: "cash", amount: "100" },
        ],
        15000,
      ),
    ).toEqual({
      ok: false,
      error: "Payments are GH₵ 50.00 over the total.",
    });
  });

  it("rejects when no method carries an amount", () => {
    expect(parsePayments([{ method: "cash", amount: "" }], 15000)).toEqual({
      ok: false,
      error: "Enter how the sale was paid.",
    });
    expect(parsePayments([], 15000)).toEqual({
      ok: false,
      error: "Enter how the sale was paid.",
    });
  });

  it("rejects an unknown method", () => {
    expect(parsePayments([{ method: "crypto" as PaymentMethod, amount: "150" }], 15000)).toEqual({
      ok: false,
      error: "Choose a valid payment method.",
    });
  });

  it("rejects a non-numeric or negative amount, naming the method", () => {
    expect(parsePayments([{ method: "cash", amount: "abc" }], 15000)).toEqual({
      ok: false,
      error: "Enter a valid amount for Cash.",
    });
    expect(parsePayments([{ method: "momo", amount: "-50" }], 15000)).toEqual({
      ok: false,
      error: "Enter a valid amount for MoMo.",
    });
  });

  it("accepts amounts written with the GH₵ symbol and grouping", () => {
    const result = parsePayments(
      [
        { method: "transfer", amount: "GH₵ 1,000.00" },
        { method: "cash", amount: "500" },
      ],
      150000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(paymentsTotal(result.payments)).toBe(150000);
    expect(result.cashApplied).toBe(50000);
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
  // The base cart totals GH₵1,500.00; the common case settles it all in cash.
  const cashFull: PaymentInput[] = [{ method: "cash", amount: "1500" }];
  const base: SaleInput = {
    shopId: "shop-1",
    customer: "Ama",
    lines: [lipstick, wig],
    payments: cashFull,
    tendered: "1600", // GH₵1,600.00 cash against a GH₵1,500.00 total
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

  it("accepts a split sale across methods and carries the cash change", () => {
    const result = parseSaleInput({
      ...base,
      payments: [
        { method: "momo", amount: "1000" }, // GH₵1,000.00
        { method: "cash", amount: "500" }, // GH₵500.00
      ],
      tendered: "600", // GH₵600 cash handed over for the GH₵500 cash portion
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payments).toEqual([
      { method: "momo", amount_pesewas: 100000 },
      { method: "cash", amount_pesewas: 50000 },
    ]);
    expect(result.value.total).toBe(150000);
    expect(result.value.change).toBe(10000); // 60000 tendered − 50000 cash owed
    expect(result.value.tendered).toBe(60000);
  });

  it("blocks completion when the payments don't sum to the total", () => {
    expect(parseSaleInput({ ...base, payments: [{ method: "cash", amount: "1400" }] })).toEqual({
      ok: false,
      error: "Payments are GH₵ 100.00 short of the total.",
    });
  });

  it("takes a fully cashless sale with no change and no cash tender carried", () => {
    const result = parseSaleInput({
      ...base,
      payments: [{ method: "momo", amount: "1500" }],
      tendered: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payments).toEqual([{ method: "momo", amount_pesewas: 150000 }]);
    expect(result.value.change).toBe(0);
    expect(result.value.tendered).toBe(0);
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
    });
    expect(result).toEqual({
      ok: false,
      error: "Only 5 of “Ruby Woo lipstick” left at this shop.",
    });
  });

  it("allows selling exactly the available stock (the boundary is not oversell)", () => {
    const result = parseSaleInput({
      ...base,
      lines: [{ ...lipstick, quantity: 5 }], // exactly available → GH₵750.00
      payments: [{ method: "cash", amount: "750" }],
      tendered: "750",
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
      payments: [{ method: "cash", amount: "450" }], // 3 × GH₵150.00
      tendered: "450",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toEqual([{ item_id: "item-lipstick", quantity: 3 }]);
    expect(result.value.total).toBe(45000);
  });

  it("clamps change to 0 on a short cash tender without blocking the sale", () => {
    // Payments balance (cash covers the total); a tender below the cash owed just
    // means no change is shown — completion is gated on balance, not the tender.
    const result = parseSaleInput({ ...base, payments: cashFull, tendered: "1000" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.change).toBe(0);
    expect(result.value.tendered).toBe(100000);
  });

  it("accepts a tender written with the GH₵ symbol and grouping", () => {
    const result = parseSaleInput({ ...base, tendered: "GH₵ 1,500.00" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tendered).toBe(150000);
    expect(result.value.change).toBe(0); // exact: 150000 tendered − 150000 cash
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
