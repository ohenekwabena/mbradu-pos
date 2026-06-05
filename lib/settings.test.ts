import { describe, it, expect } from "vitest";

import {
  EXPIRY_WINDOW_OPTIONS,
  MAX_EXPIRY_WINDOW_DAYS,
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
  const base: SettingsInput = { lowStockThreshold: "5", expiryWarningDays: "30" };

  it("accepts valid input and normalizes it to integers", () => {
    const result = parseSettingsInput(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ lowStockThreshold: 5, expiryWarningDays: 30 });
  });

  it("accepts a padded/whitespace-wrapped whole number", () => {
    expect(parseSettingsInput({ lowStockThreshold: " 008 ", expiryWarningDays: " 60 " })).toMatchObject(
      { ok: true, value: { lowStockThreshold: 8, expiryWarningDays: 60 } },
    );
  });

  it("allows 0 for both (only a true stock-out flagged; no expiry warning)", () => {
    expect(parseSettingsInput({ lowStockThreshold: "0", expiryWarningDays: "0" })).toMatchObject({
      ok: true,
      value: { lowStockThreshold: 0, expiryWarningDays: 0 },
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
});
