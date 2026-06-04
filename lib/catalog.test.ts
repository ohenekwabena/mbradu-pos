import { describe, it, expect } from "vitest";

import {
  ATTRIBUTE_FIELDS,
  attributeSummary,
  buildAttributes,
  EDITABLE_CATEGORIES,
  isCategory,
  isEditableCategory,
  parseItemInput,
  type ItemInput,
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
    expect(ATTRIBUTE_FIELDS.cosmetic).toEqual([]); // MP-18
  });
});
