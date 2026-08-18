import { describe, it, expect } from "vitest";

import { format } from "./money";
import {
  EXPIRY_WINDOW_OPTIONS,
  MAX_EXPIRY_WINDOW_DAYS,
  MAX_FLOAT_PESEWAS,
  MAX_LOW_STOCK_THRESHOLD,
  parseSettingsInput,
  type SettingsInput,
} from "./settings";

describe("EXPIRY_WINDOW_OPTIONS", () => {
  it("offers the default 30-day window among the choices", () => {
    expect(EXPIRY_WINDOW_OPTIONS).toContain(30);
  });
});

describe("parseSettingsInput", () => {
  const base: SettingsInput = {
    lowStockThreshold: "5",
    expiryWarningDays: "30",
    floatAmount: "250",
  };

  it("accepts valid input and normalizes it to integers", () => {
    const result = parseSettingsInput(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      lowStockThreshold: 5,
      expiryWarningDays: 30,
      floatPesewas: 25_000,
    });
  });

  it("accepts a padded/whitespace-wrapped whole number", () => {
    expect(
      parseSettingsInput({ lowStockThreshold: " 008 ", expiryWarningDays: " 60 ", floatAmount: " 250 " }),
    ).toMatchObject({ ok: true, value: { lowStockThreshold: 8, expiryWarningDays: 60 } });
  });

  it("allows 0 for all (only a true stock-out flagged; no expiry warning; empty drawer)", () => {
    expect(
      parseSettingsInput({ lowStockThreshold: "0", expiryWarningDays: "0", floatAmount: "0" }),
    ).toMatchObject({
      ok: true,
      value: { lowStockThreshold: 0, expiryWarningDays: 0, floatPesewas: 0 },
    });
  });

  it("rejects a non-whole, negative, or non-numeric threshold", () => {
    for (const lowStockThreshold of ["", "-1", "2.5", "five", "1e2", "  "]) {
      expect(parseSettingsInput({ ...base, lowStockThreshold }).ok).toBe(false);
    }
  });

  it("rejects a threshold above the ceiling", () => {
    expect(parseSettingsInput({ ...base, lowStockThreshold: String(MAX_LOW_STOCK_THRESHOLD + 1) }).ok).toBe(
      false,
    );
    expect(parseSettingsInput({ ...base, lowStockThreshold: String(MAX_LOW_STOCK_THRESHOLD) }).ok).toBe(
      true,
    );
  });

  it("rejects a non-whole, negative, or out-of-range expiry window", () => {
    for (const expiryWarningDays of ["", "-7", "1.5", "soon", String(MAX_EXPIRY_WINDOW_DAYS + 1)]) {
      expect(parseSettingsInput({ ...base, expiryWarningDays }).ok).toBe(false);
    }
    expect(parseSettingsInput({ ...base, expiryWarningDays: String(MAX_EXPIRY_WINDOW_DAYS) }).ok).toBe(
      true,
    );
  });

  it("parses the drawer float through the Money module (symbol, commas, decimals)", () => {
    const result = parseSettingsInput({ ...base, floatAmount: "GH₵ 1,250.50" });
    expect(result).toMatchObject({ ok: true, value: { floatPesewas: 125_050 } });
  });

  it("round-trips a formatted float (what the form shows back on load)", () => {
    const shown = format(25_000, { symbol: false, grouping: false }); // "250.00"
    expect(parseSettingsInput({ ...base, floatAmount: shown })).toMatchObject({
      ok: true,
      value: { floatPesewas: 25_000 },
    });
  });

  it("rejects a blank, negative, or non-numeric drawer float", () => {
    for (const floatAmount of ["", "  ", "-5", "-0.01", "lots", "12..5"]) {
      expect(parseSettingsInput({ ...base, floatAmount }).ok).toBe(false);
    }
  });

  it("rejects a drawer float above the ceiling, accepts one at it", () => {
    expect(parseSettingsInput({ ...base, floatAmount: format(MAX_FLOAT_PESEWAS + 1) }).ok).toBe(false);
    expect(parseSettingsInput({ ...base, floatAmount: format(MAX_FLOAT_PESEWAS) })).toMatchObject({
      ok: true,
      value: { floatPesewas: MAX_FLOAT_PESEWAS },
    });
  });
});
