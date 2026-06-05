import { describe, it, expect } from "vitest";

import { parseReassignInput, type ReassignInput } from "./reassignment";

const CASHIER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SHOP = "11111111-1111-1111-1111-111111111111";
const OTHER_SHOP = "22222222-2222-2222-2222-222222222222";

describe("parseReassignInput", () => {
  it("accepts a cashier + target shop and returns the normalized write", () => {
    const result = parseReassignInput({ cashierId: CASHIER, shopId: SHOP });
    expect(result).toEqual({
      ok: true,
      value: { cashierId: CASHIER, shopId: SHOP },
    });
  });

  it("accepts a move when the target shop differs from the current one", () => {
    const result = parseReassignInput({
      cashierId: CASHIER,
      shopId: OTHER_SHOP,
      currentShopId: SHOP,
    });
    expect(result).toEqual({
      ok: true,
      value: { cashierId: CASHIER, shopId: OTHER_SHOP },
    });
  });

  it("trims the cashier and shop ids", () => {
    const result = parseReassignInput({
      cashierId: `  ${CASHIER} `,
      shopId: `  ${SHOP} `,
    });
    expect(result).toEqual({
      ok: true,
      value: { cashierId: CASHIER, shopId: SHOP },
    });
  });

  it("rejects a blank cashier", () => {
    const result = parseReassignInput({ cashierId: "   ", shopId: SHOP });
    expect(result).toEqual({ ok: false, error: "Pick a cashier to reassign." });
  });

  it("requires a target shop", () => {
    const result = parseReassignInput({ cashierId: CASHIER, shopId: "  " });
    expect(result).toEqual({
      ok: false,
      error: "Choose a shop for this cashier.",
    });
  });

  it("rejects a no-op move to the shop they're already in", () => {
    const result = parseReassignInput({
      cashierId: CASHIER,
      shopId: SHOP,
      currentShopId: SHOP,
    });
    expect(result).toEqual({
      ok: false,
      error: "They're already in that shop.",
    });
  });

  it("detects the no-op even with surrounding whitespace on either id", () => {
    const result = parseReassignInput({
      cashierId: CASHIER,
      shopId: `  ${SHOP}`,
      currentShopId: `${SHOP}  `,
    });
    expect(result).toEqual({
      ok: false,
      error: "They're already in that shop.",
    });
  });

  it("skips the same-shop guard when the current shop is unknown", () => {
    for (const currentShopId of [undefined, null, "   "]) {
      const result = parseReassignInput({
        cashierId: CASHIER,
        shopId: SHOP,
        currentShopId,
      } as ReassignInput);
      expect(result).toEqual({
        ok: true,
        value: { cashierId: CASHIER, shopId: SHOP },
      });
    }
  });

  it("reports the missing cashier before the missing shop", () => {
    const result = parseReassignInput({ cashierId: "", shopId: "" });
    expect(result).toEqual({ ok: false, error: "Pick a cashier to reassign." });
  });
});
