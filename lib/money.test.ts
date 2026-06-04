import { describe, it, expect } from "vitest";

import {
  add,
  assertPesewas,
  CEDI_SYMBOL,
  format,
  MAX_PESEWAS,
  multiply,
  parse,
  PESEWAS_PER_CEDI,
  subtract,
  sum,
  tryParse,
  ZERO,
} from "./money";

describe("money — constants", () => {
  it("uses 100 pesewas per cedi and a GH₵ symbol", () => {
    expect(PESEWAS_PER_CEDI).toBe(100);
    expect(ZERO).toBe(0);
    expect(CEDI_SYMBOL).toBe("GH₵");
  });
});

describe("money — arithmetic (integer pesewas, no floats)", () => {
  it("adds and subtracts", () => {
    expect(add(12345, 100)).toBe(12445);
    expect(subtract(12345, 345)).toBe(12000);
  });

  it("subtraction can go negative (e.g. change owed / downward delta)", () => {
    expect(subtract(500, 1200)).toBe(-700);
  });

  it("multiplies a unit price by a whole quantity", () => {
    expect(multiply(1599, 3)).toBe(4797);
    expect(multiply(1599, 0)).toBe(0);
  });

  it("rejects a fractional or negative quantity", () => {
    expect(() => multiply(1599, 1.5)).toThrow();
    expect(() => multiply(1599, -1)).toThrow();
  });

  it("sums a list, with an empty list summing to zero", () => {
    expect(sum([100, 200, 300])).toBe(600);
    expect(sum([])).toBe(ZERO);
  });

  it("the classic float trap stays exact in pesewas", () => {
    // 0.10 + 0.20 GH₵ must be exactly GH₵0.30, never 0.30000000000000004.
    expect(add(10, 20)).toBe(30);
    expect(format(add(10, 20))).toBe("GH₵0.30");
  });

  it("rejects non-integer (float) amounts loudly", () => {
    expect(() => add(10.5, 1)).toThrow(TypeError);
    expect(() => assertPesewas(1.5)).toThrow();
    expect(() => assertPesewas(Number.NaN)).toThrow();
  });
});

describe("money — format", () => {
  it("formats with exactly two decimals and the symbol", () => {
    expect(format(12345)).toBe("GH₵123.45");
    expect(format(5)).toBe("GH₵0.05");
    expect(format(50)).toBe("GH₵0.50");
    expect(format(100)).toBe("GH₵1.00");
  });

  it("formats zero", () => {
    expect(format(0)).toBe("GH₵0.00");
  });

  it("groups thousands by default", () => {
    expect(format(1234567)).toBe("GH₵12,345.67");
    expect(format(100000000)).toBe("GH₵1,000,000.00");
  });

  it("places the sign before the symbol for negatives", () => {
    expect(format(-500)).toBe("-GH₵5.00");
    expect(format(-1)).toBe("-GH₵0.01");
  });

  it("honours symbol/grouping options", () => {
    expect(format(1234567, { symbol: false })).toBe("12,345.67");
    expect(format(1234567, { grouping: false })).toBe("GH₵12345.67");
    expect(format(1234567, { symbol: false, grouping: false })).toBe("12345.67");
  });
});

describe("money — parse", () => {
  it("parses a plain decimal", () => {
    expect(parse("123.45")).toBe(12345);
    expect(parse("0.05")).toBe(5);
    expect(parse("1")).toBe(100);
    expect(parse("1.5")).toBe(150);
  });

  it("tolerates the symbol, grouping commas, and whitespace", () => {
    expect(parse("GH₵123.45")).toBe(12345);
    expect(parse("  GH₵12,345.67 ")).toBe(1234567);
    expect(parse("₵1,000")).toBe(100000);
    expect(parse("GHS 50.00")).toBe(5000);
  });

  it("parses negatives", () => {
    expect(parse("-5.00")).toBe(-500);
    expect(parse("-GH₵5")).toBe(-500);
  });

  it("accepts a bare leading dot", () => {
    expect(parse(".5")).toBe(50);
  });

  it("rejects nonsense via parse (throws) and tryParse (null)", () => {
    expect(() => parse("abc")).toThrow(SyntaxError);
    expect(() => parse("")).toThrow();
    expect(() => parse("1.2.3")).toThrow();
    expect(tryParse("abc")).toBeNull();
    expect(tryParse("12,,34")).not.toBe(NaN);
  });
});

describe("money — rounding (explicit, ties away from zero)", () => {
  it("rounds a third decimal half away from zero", () => {
    expect(parse("12.345")).toBe(1235);
    expect(parse("12.344")).toBe(1234);
    expect(parse("12.346")).toBe(1235);
  });

  it("rounds negatives away from zero symmetrically", () => {
    expect(parse("-0.005")).toBe(-1);
    expect(parse("-12.344")).toBe(-1234);
  });

  it("carries rounding across the pesewa/cedi boundary", () => {
    expect(parse("12.999")).toBe(1300);
    expect(parse("0.999")).toBe(100);
  });
});

describe("money — format/parse round-trip is lossless", () => {
  const samples = [0, 1, 5, 50, 99, 100, 12345, 1234567, 9999999999, MAX_PESEWAS - 1];

  // Negate only non-zero samples: -0 is normalised to +0 (no negative-zero money).
  for (const value of [...samples, ...samples.filter((v) => v !== 0).map((v) => -v)]) {
    it(`round-trips ${value}`, () => {
      expect(parse(format(value))).toBe(value);
      // and without the symbol/grouping decorations
      expect(parse(format(value, { symbol: false, grouping: false }))).toBe(value);
    });
  }
});

describe("money — large values stay exact within the safe range", () => {
  it("handles a large but safe amount", () => {
    const large = 9_000_000_000_000; // GH₵90 billion in pesewas
    expect(add(large, large)).toBe(18_000_000_000_000);
    expect(format(large)).toBe("GH₵90,000,000,000.00");
    expect(parse("GH₵90,000,000,000.00")).toBe(large);
  });

  it("throws rather than silently overflowing the safe integer range", () => {
    expect(() => add(MAX_PESEWAS, MAX_PESEWAS)).toThrow(RangeError);
    expect(() => multiply(MAX_PESEWAS, 2)).toThrow(RangeError);
    expect(() => assertPesewas(MAX_PESEWAS + 1)).toThrow(RangeError);
  });
});
