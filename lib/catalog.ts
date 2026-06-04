/**
 * Catalog domain — an Item's {@link Category}, its category-specific
 * **Attributes**, and the pure validation that turns raw editor input into a
 * database-ready payload.
 *
 * Deliberately free of any server/Supabase imports so the Server Action that
 * writes Items *and* the client item-editor can both import it; its only
 * dependency is the Money module (GH₵ string → integer pesewas).
 *
 * One unified Item model (ADR-0002): a single `items` row is the priced/sold
 * unit, and the wig-vs-cosmetic-vs-tool difference lives only in `category`
 * plus the schemaless `attributes` JSONB — validated here in app code, since
 * the column is schemaless at the DB. MP-17 ships the wig and wig-tool editors;
 * cosmetics (a Product grouping + expiry) arrive in MP-18.
 */

import { tryParse, type Pesewas } from "@/lib/money";

/** Every Item Category (CONTEXT.md). Mirrors the `items.category` CHECK. */
export const CATEGORIES = ["wig", "cosmetic", "wig_tool"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Human label per Category. */
export const CATEGORY_LABEL: Record<Category, string> = {
  wig: "Wig",
  cosmetic: "Cosmetic",
  wig_tool: "Wig Tool",
};

/**
 * Categories the item editor can create/edit today. Cosmetics need the
 * Product-grouping + expiry UI from MP-18, so they're excluded here — the
 * catalog table still renders any cosmetic rows that already exist.
 */
export const EDITABLE_CATEGORIES = ["wig", "wig_tool"] as const satisfies readonly Category[];

/** Narrow an arbitrary string to a {@link Category}. */
export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** Is this a Category the editor can currently add/edit (MP-17: wig, wig tool)? */
export function isEditableCategory(value: string): value is Category {
  return (EDITABLE_CATEGORIES as readonly string[]).includes(value);
}

/** One category-specific attribute field, stored flat in `items.attributes`. */
export interface AttributeField {
  /** Key the value is stored under in the JSONB `attributes` object. */
  key: string;
  label: string;
  placeholder?: string;
  /** Render across both columns of the editor's attribute grid. */
  full?: boolean;
}

/**
 * The Attributes each Category carries (CONTEXT.md → Attributes). Array order is
 * the display order in both the editor and the list-row summary. Cosmetics get
 * their fields (shade, size, expiry) in MP-18.
 */
export const ATTRIBUTE_FIELDS: Record<Category, AttributeField[]> = {
  wig: [
    { key: "length", label: "Length", placeholder: 'e.g. 16"' },
    { key: "texture", label: "Texture", placeholder: "e.g. Body wave" },
    { key: "lace", label: "Lace type", placeholder: "e.g. HD 5×5" },
    { key: "density", label: "Density", placeholder: "e.g. 150%" },
    { key: "origin", label: "Origin", placeholder: "e.g. Brazilian", full: true },
  ],
  wig_tool: [
    { key: "type", label: "Tool type", placeholder: "e.g. Brush, Wig stand, Adhesive" },
    { key: "brand", label: "Brand", placeholder: "e.g. SilkPro" },
  ],
  cosmetic: [],
};

/** An Item's flexible attributes — a flat map of present, non-blank fields. */
export type Attributes = Record<string, string>;

/**
 * Collect a Category's attribute values from raw (string) inputs, trimming and
 * dropping blanks — so `attributes` only ever holds the fields actually filled
 * in. Keys outside {@link ATTRIBUTE_FIELDS} for the Category are ignored, so a
 * stale field from a previous Category can't leak in.
 */
export function buildAttributes(
  category: Category,
  raw: Record<string, string | null | undefined>,
): Attributes {
  const out: Attributes = {};
  for (const field of ATTRIBUTE_FIELDS[category]) {
    const value = (raw[field.key] ?? "").trim();
    if (value) out[field.key] = value;
  }
  return out;
}

/**
 * A compact "Brazilian · 16″ · Body wave" line for a catalog row: the present
 * attribute values in field order, joined with " · ". Empty when none are set.
 */
export function attributeSummary(
  category: Category,
  attributes: Attributes | null | undefined,
): string {
  if (!attributes) return "";
  return ATTRIBUTE_FIELDS[category]
    .map((field) => attributes[field.key])
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" · ");
}

/** Raw item-editor input, as pulled from the submitted form (all strings). */
export interface ItemInput {
  category: string;
  name: string;
  /** GH₵ decimal strings. `cost` may be blank (defaults to GH₵0). */
  cost: string;
  price: string;
  attributes: Record<string, string | null | undefined>;
}

/** A validated, DB-ready Item write — money as integer pesewas. */
export interface ItemWrite {
  category: Category;
  name: string;
  cost_pesewas: Pesewas;
  price_pesewas: Pesewas;
  attributes: Attributes;
}

export type ParseResult =
  | { ok: true; value: ItemWrite }
  | { ok: false; error: string };

/**
 * Validate + normalize raw editor input into an {@link ItemWrite}, or return the
 * first problem as a human message. Pure (no I/O) so it is the unit-tested core
 * the Server Action wraps and re-checks against RLS:
 *   - name is required;
 *   - category must be one the editor supports (wig / wig tool in MP-17);
 *   - selling price is required and a non-negative GH₵ amount;
 *   - cost is optional (blank → GH₵0) and, if given, non-negative;
 *   - attributes are reduced to the Category's known, non-blank fields.
 *
 * Money strings go through {@link tryParse}, so grouped/symbol'd input like
 * "GH₵1,450.00" is accepted and stored as `145000` pesewas.
 */
export function parseItemInput(input: ItemInput): ParseResult {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Enter an item name." };

  if (!isEditableCategory(input.category)) {
    return { ok: false, error: "Choose a category." };
  }
  const category = input.category;

  const price = tryParse(input.price);
  if (price === null || price < 0) {
    return { ok: false, error: "Enter a valid selling price (e.g. 1450.00)." };
  }

  const costText = input.cost.trim();
  const cost = costText === "" ? 0 : tryParse(costText);
  if (cost === null || cost < 0) {
    return { ok: false, error: "Enter a valid cost, or leave it blank." };
  }

  return {
    ok: true,
    value: {
      category,
      name,
      cost_pesewas: cost,
      price_pesewas: price,
      attributes: buildAttributes(category, input.attributes),
    },
  };
}
