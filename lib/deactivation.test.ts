import { describe, it, expect } from "vitest";

import { parseDeactivateInput } from "./deactivation";

const CASHIER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("parseDeactivateInput", () => {
  it("accepts a cashier and returns the normalized write", () => {
    const result = parseDeactivateInput({ cashierId: CASHIER });
    expect(result).toEqual({ ok: true, value: { cashierId: CASHIER } });
  });

  it("trims surrounding whitespace on the cashier id", () => {
    const result = parseDeactivateInput({ cashierId: `  ${CASHIER} ` });
    expect(result).toEqual({ ok: true, value: { cashierId: CASHIER } });
  });

  it("rejects a blank cashier", () => {
    const result = parseDeactivateInput({ cashierId: "   " });
    expect(result).toEqual({ ok: false, error: "Pick a cashier." });
  });

  it("rejects an empty cashier id", () => {
    const result = parseDeactivateInput({ cashierId: "" });
    expect(result).toEqual({ ok: false, error: "Pick a cashier." });
  });
});
