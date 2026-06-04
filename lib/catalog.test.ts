import { describe, it, expect } from "vitest";

import {
  ATTRIBUTE_FIELDS,
  attributeSummary,
  buildAttributes,
  EDITABLE_CATEGORIES,
  formatExpiry,
  isCategory,
  isEditableCategory,
  isValidISODate,
  parseItemInput,
  parseProductInput,
  type ItemInput,
  type ProductInput,
} from "./catalog";

describe("isCategory / isEditableCategory", () => {
  it("accepts the three real categories", () => {
    expect(isCategory("wig")).toBe(true);
    expect(isCategory("cosmetic")).toBe(true);
    expect(isCategory("wig_tool")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isCategory("")).toBe(false);
    expect(isCategory("WIG")).toBe(false);
    expect(isCategory("product")).toBe(false);
  });

  it("treats only wig and wig_tool as editable in MP-17 (cosmetic is MP-18)", () => {
    expect(isEditableCategory("wig")).toBe(true);
    expect(isEditableCategory("wig_tool")).toBe(true);
    expect(isEditableCategory("cosmetic")).toBe(false);
    expect(EDITABLE_CATEGORIES).toEqual(["wig", "wig_tool"]);
  });
});

describe("buildAttributes", () => {
  it("keeps the category's filled fields, trimmed", () => {
    const attrs = buildAttributes("wig", {
      length: '16"',
      texture: "  Body wave  ",
      lace: "HD 5×5",
      density: "150%",
      origin: "Brazilian",
    });
    expect(attrs).toEqual({
      length: '16"',
      texture: "Body wave",
      lace: "HD 5×5",
      density: "150%",
      origin: "Brazilian",
    });
  });

  it("drops blank, whitespace-only, and missing fields", () => {
    expect(buildAttributes("wig", { length: '18"', texture: "   ", origin: "" })).toEqual({
      length: '18"',
    });
  });

  it("ignores keys not defined for the category (no leakage across categories)", () => {
    // `length`/`texture` belong to wig, not wig_tool — they must not survive.
    const attrs = buildAttributes("wig_tool", {
      type: "Brush",
      brand: "SilkPro",
      length: '16"',
      texture: "Body wave",
    });
    expect(attrs).toEqual({ type: "Brush", brand: "SilkPro" });
  });
});

describe("attributeSummary", () => {
  it("joins present values in field order with a middot", () => {
    expect(
      attributeSummary("wig", { origin: "Brazilian", length: '16"', texture: "Body wave" }),
    ).toBe('16" · Body wave · Brazilian');
  });

  it("summarizes a wig tool", () => {
    expect(attributeSummary("wig_tool", { type: "Brush", brand: "SilkPro" })).toBe(
      "Brush · SilkPro",
    );
  });

  it("is empty when there are no attributes", () => {
    expect(attributeSummary("wig", {})).toBe("");
    expect(attributeSummary("wig", null)).toBe("");
    expect(attributeSummary("wig", undefined)).toBe("");
  });
});

describe("parseItemInput", () => {
  const base: ItemInput = {
    category: "wig",
    name: "Bodywave 16\" Bundle",
    cost: "900",
    price: "1450",
    attributes: { length: '16"', texture: "Body wave", origin: "Brazilian" },
  };

  it("accepts a valid wig and stores money as integer pesewas", () => {
    const result = parseItemInput(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      category: "wig",
      name: 'Bodywave 16" Bundle',
      cost_pesewas: 90000,
      price_pesewas: 145000,
      attributes: { length: '16"', texture: "Body wave", origin: "Brazilian" },
    });
  });

  it("accepts a valid wig tool", () => {
    const result = parseItemInput({
      category: "wig_tool",
      name: "Boar-Bristle Detangling Brush",
      cost: "18",
      price: "40",
      attributes: { type: "Brush", brand: "SilkPro" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.category).toBe("wig_tool");
    expect(result.value.attributes).toEqual({ type: "Brush", brand: "SilkPro" });
  });

  it("parses grouped/symbol'd GH₵ strings via the Money module", () => {
    const result = parseItemInput({ ...base, cost: "GH₵900.00", price: "1,450.00" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cost_pesewas).toBe(90000);
    expect(result.value.price_pesewas).toBe(145000);
  });

  it("trims the name and rejects a blank one", () => {
    expect(parseItemInput({ ...base, name: "  Lace Front  " })).toMatchObject({
      ok: true,
      value: { name: "Lace Front" },
    });
    expect(parseItemInput({ ...base, name: "   " })).toEqual({
      ok: false,
      error: "Enter an item name.",
    });
  });

  it("defaults a blank cost to GH₵0", () => {
    const result = parseItemInput({ ...base, cost: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cost_pesewas).toBe(0);
  });

  it("rejects a missing or non-numeric price", () => {
    expect(parseItemInput({ ...base, price: "" }).ok).toBe(false);
    expect(parseItemInput({ ...base, price: "free" }).ok).toBe(false);
  });

  it("rejects negative money", () => {
    expect(parseItemInput({ ...base, price: "-5" }).ok).toBe(false);
    expect(parseItemInput({ ...base, cost: "-1" }).ok).toBe(false);
  });

  it("rejects a category the editor can't create (cosmetic in MP-17, or garbage)", () => {
    expect(parseItemInput({ ...base, category: "cosmetic" })).toEqual({
      ok: false,
      error: "Choose a category.",
    });
    expect(parseItemInput({ ...base, category: "" }).ok).toBe(false);
  });

  it("only keeps attributes defined for the chosen category", () => {
    const result = parseItemInput({
      ...base,
      category: "wig_tool",
      attributes: { type: "Comb", brand: "SilkPro", length: '16"' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attributes).toEqual({ type: "Comb", brand: "SilkPro" });
  });
});

describe("ATTRIBUTE_FIELDS", () => {
  it("matches the Attributes named in CONTEXT.md", () => {
    expect(ATTRIBUTE_FIELDS.wig.map((f) => f.key)).toEqual([
      "length",
      "texture",
      "lace",
      "density",
      "origin",
    ]);
    expect(ATTRIBUTE_FIELDS.wig_tool.map((f) => f.key)).toEqual(["type", "brand"]);
    expect(ATTRIBUTE_FIELDS.cosmetic.map((f) => f.key)).toEqual(["shade", "size", "expiry"]);
  });
});

describe("isValidISODate", () => {
  it("accepts real YYYY-MM-DD dates, including a leap day", () => {
    expect(isValidISODate("2026-12-31")).toBe(true);
    expect(isValidISODate("2027-01-05")).toBe(true);
    expect(isValidISODate("2024-02-29")).toBe(true); // 2024 is a leap year
  });

  it("rejects impossible days and bad shapes", () => {
    expect(isValidISODate("2026-02-30")).toBe(false); // no Feb 30
    expect(isValidISODate("2026-02-29")).toBe(false); // 2026 isn't a leap year
    expect(isValidISODate("2026-13-01")).toBe(false); // month 13
    expect(isValidISODate("2026-00-10")).toBe(false); // month 0
    expect(isValidISODate("2026-1-1")).toBe(false); // unpadded
    expect(isValidISODate("31-12-2026")).toBe(false); // wrong order
    expect(isValidISODate("")).toBe(false);
  });
});

describe("formatExpiry", () => {
  it("renders an ISO date for display", () => {
    expect(formatExpiry("2026-12-31")).toBe("31 Dec 2026");
    expect(formatExpiry("2027-01-05")).toBe("5 Jan 2027");
  });

  it("returns the input unchanged when it isn't a valid date", () => {
    expect(formatExpiry("nope")).toBe("nope");
    expect(formatExpiry("2026-02-30")).toBe("2026-02-30");
  });
});

describe("parseProductInput", () => {
  const base: ProductInput = {
    name: "Velvet Matte Lipstick",
    brand: "Huda",
    shades: [
      { shade: "Ruby Woo", size: "4g", expiry: "2026-12-31", cost: "30", price: "85" },
      { shade: "Pink Nude", size: "4g", expiry: "2027-01-15", cost: "30", price: "85" },
    ],
  };

  it("accepts a product, deriving each shade's Item name and storing pesewas", () => {
    const result = parseProductInput(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      name: "Velvet Matte Lipstick",
      brand: "Huda",
      shades: [
        {
          name: "Velvet Matte Lipstick — Ruby Woo",
          cost_pesewas: 3000,
          price_pesewas: 8500,
          attributes: { shade: "Ruby Woo", size: "4g", expiry: "2026-12-31" },
        },
        {
          name: "Velvet Matte Lipstick — Pink Nude",
          cost_pesewas: 3000,
          price_pesewas: 8500,
          attributes: { shade: "Pink Nude", size: "4g", expiry: "2027-01-15" },
        },
      ],
    });
  });

  it("treats a blank brand as null and a blank cost as GH₵0", () => {
    const result = parseProductInput({
      ...base,
      brand: "   ",
      shades: [{ shade: "Bare", size: "", expiry: "2026-10-01", cost: "", price: "50" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.brand).toBeNull();
    expect(result.value.shades[0].cost_pesewas).toBe(0);
    // size dropped when blank; shade + expiry always present
    expect(result.value.shades[0].attributes).toEqual({ shade: "Bare", expiry: "2026-10-01" });
  });

  it("preserves the Product id and shade ids when editing", () => {
    const result = parseProductInput({
      id: "prod-1",
      name: "Velvet Matte Lipstick",
      brand: "",
      shades: [
        { id: "item-9", shade: "Ruby Woo", size: "4g", expiry: "2026-12-31", cost: "30", price: "85" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("prod-1");
    expect(result.value.shades[0].id).toBe("item-9");
  });

  it("requires a product name", () => {
    expect(parseProductInput({ ...base, name: "  " })).toEqual({
      ok: false,
      error: "Enter a product name.",
    });
  });

  it("requires at least one shade", () => {
    expect(parseProductInput({ ...base, shades: [] })).toEqual({
      ok: false,
      error: "Add at least one shade.",
    });
  });

  it("requires every shade to have a name", () => {
    const result = parseProductInput({
      ...base,
      shades: [{ shade: "  ", size: "4g", expiry: "2026-12-31", cost: "30", price: "85" }],
    });
    expect(result).toEqual({ ok: false, error: "Give every shade a name." });
  });

  it("rejects two shades sharing a name (case-insensitive)", () => {
    const result = parseProductInput({
      ...base,
      shades: [
        { shade: "Ruby Woo", size: "4g", expiry: "2026-12-31", cost: "30", price: "85" },
        { shade: "ruby woo", size: "4g", expiry: "2027-01-15", cost: "30", price: "85" },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/different name/i);
  });

  it("rejects an invalid price, cost, or expiry on a shade", () => {
    expect(
      parseProductInput({
        ...base,
        shades: [{ shade: "Ruby Woo", size: "4g", expiry: "2026-12-31", cost: "30", price: "free" }],
      }).ok,
    ).toBe(false);
    expect(
      parseProductInput({
        ...base,
        shades: [{ shade: "Ruby Woo", size: "4g", expiry: "2026-12-31", cost: "-1", price: "85" }],
      }).ok,
    ).toBe(false);
    expect(
      parseProductInput({
        ...base,
        shades: [{ shade: "Ruby Woo", size: "4g", expiry: "2026-02-30", cost: "30", price: "85" }],
      }).ok,
    ).toBe(false);
  });
});
