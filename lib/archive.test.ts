import { describe, it, expect } from "vitest";

import {
  archiveBlockReason,
  canArchive,
  isArchived,
  parseArchiveInput,
  parseDiscontinueProductInput,
} from "./archive";

const ITEM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PRODUCT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("isArchived", () => {
  it("treats a null/undefined stamp as active", () => {
    expect(isArchived(null)).toBe(false);
    expect(isArchived(undefined)).toBe(false);
  });

  it("treats any timestamp as archived", () => {
    expect(isArchived("2026-06-05T12:00:00.000Z")).toBe(true);
  });
});

describe("archiveBlockReason (block-until-zero)", () => {
  it("allows archiving when nothing is on hand", () => {
    expect(archiveBlockReason(0)).toBeNull();
  });

  it("blocks while stock remains, naming the units (plural)", () => {
    expect(archiveBlockReason(5)).toBe(
      "Sell or remove the 5 units still in stock before discontinuing.",
    );
  });

  it("uses the singular for a single remaining unit", () => {
    expect(archiveBlockReason(1)).toBe(
      "Sell or remove the 1 unit still in stock before discontinuing.",
    );
  });
});

describe("canArchive", () => {
  it("is true only at zero on hand", () => {
    expect(canArchive(0)).toBe(true);
    expect(canArchive(1)).toBe(false);
    expect(canArchive(99)).toBe(false);
  });
});

describe("parseArchiveInput", () => {
  it("accepts an item id and returns the normalized write", () => {
    expect(parseArchiveInput({ itemId: ITEM })).toEqual({ ok: true, value: { itemId: ITEM } });
  });

  it("trims surrounding whitespace", () => {
    expect(parseArchiveInput({ itemId: `  ${ITEM} ` })).toEqual({
      ok: true,
      value: { itemId: ITEM },
    });
  });

  it("rejects a blank id (defensive)", () => {
    expect(parseArchiveInput({ itemId: "   " })).toEqual({
      ok: false,
      error: "Pick an item to discontinue.",
    });
  });
});

describe("parseDiscontinueProductInput", () => {
  it("accepts a product id and returns the normalized write", () => {
    expect(parseDiscontinueProductInput({ productId: PRODUCT })).toEqual({
      ok: true,
      value: { productId: PRODUCT },
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseDiscontinueProductInput({ productId: `  ${PRODUCT} ` })).toEqual({
      ok: true,
      value: { productId: PRODUCT },
    });
  });

  it("rejects a blank id (defensive)", () => {
    expect(parseDiscontinueProductInput({ productId: "" })).toEqual({
      ok: false,
      error: "Pick a product line to discontinue.",
    });
  });
});
