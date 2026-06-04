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
 * cosmetics — grouped under a Product, with shade/size/expiry — are added in
 * MP-18 (see the Cosmetic Products section at the foot of this file).
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
 * the display order in both the editor and the list-row summary. A Cosmetic
 * carries shade, size, and expiry — and, alone among the categories, groups
 * under a Product (MP-18); `expiry` is an ISO `YYYY-MM-DD` date string.
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
  cosmetic: [
    { key: "shade", label: "Shade", placeholder: "e.g. Ruby Woo" },
    { key: "size", label: "Size", placeholder: "e.g. 4g / 50 ml" },
    { key: "expiry", label: "Expiry date", placeholder: "YYYY-MM-DD" },
  ],
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

// ===========================================================================
// Cosmetic Products (MP-18)
//
// A Product groups several shade Items — a cosmetic line ("Velvet Matte
// Lipstick", brand "Huda") sold in several shades, each its own cosmetic Item
// with a shade/size/expiry and its own cost and price. Only Cosmetics group
// under a Product and carry expiry (CONTEXT.md, ADR-0002).
//
// As with {@link parseItemInput}, the validation here is pure (no I/O) so the
// client Product editor and the Server Action share it; the atomic create/edit
// is the `save_cosmetic_product` RPC. Each shade Item's `name` is *derived*
// ("<product> — <shade>") so the unified `items` table — read by the Sell
// screen, Sales, and dashboards — shows a meaningful per-shade name.
// ===========================================================================

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Is `value` a real ISO calendar date, `YYYY-MM-DD`? Rejects malformed strings
 * *and* impossible days like `2026-02-30` (round-trips the parsed parts through
 * a UTC date to confirm they survive). Parsing is from explicit components, so
 * it's deterministic — no dependence on the current date or local timezone.
 */
export function isValidISODate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Render an ISO expiry for display: `"2026-12-31"` → `"31 Dec 2026"`. Returns
 * the input unchanged if it isn't a valid date. */
export function formatExpiry(iso: string): string {
  if (!isValidISODate(iso)) return iso;
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTH_ABBR[month - 1]} ${year}`;
}

/** Raw editor input for one shade row of a Product (all strings from the form).
 * `id` is present when editing an existing shade Item. */
export interface ShadeInput {
  id?: string;
  shade: string;
  size: string;
  /** ISO `YYYY-MM-DD`. */
  expiry: string;
  /** GH₵ decimal strings. `cost` may be blank (defaults to GH₵0). */
  cost: string;
  price: string;
}

/** Raw editor input for a cosmetic Product and its shade rows. */
export interface ProductInput {
  /** Present when editing an existing Product. */
  id?: string;
  name: string;
  brand: string;
  shades: ShadeInput[];
}

/** A validated shade, ready to write as a cosmetic Item under the Product. */
export interface ShadeWrite {
  /** Present for an existing shade Item (update); absent for a new one. */
  id?: string;
  /** Derived "<product> — <shade>". */
  name: string;
  cost_pesewas: Pesewas;
  price_pesewas: Pesewas;
  /** Always holds `shade` and `expiry`; `size` only when given. */
  attributes: Attributes;
}

/** A validated, DB-ready Product write with its shade Items. */
export interface ProductWrite {
  id?: string;
  name: string;
  brand: string | null;
  shades: ShadeWrite[];
}

export type ProductParseResult =
  | { ok: true; value: ProductWrite }
  | { ok: false; error: string };

/**
 * Validate + normalize a cosmetic Product and its shades into a
 * {@link ProductWrite}, or return the first problem as a human message:
 *   - product name is required; brand is optional (blank → `null`);
 *   - there must be at least one shade, each with a (distinct) shade name;
 *   - each shade needs a non-negative selling price and a valid expiry date;
 *   - cost is optional (blank → GH₵0) and, if given, non-negative.
 *
 * Each shade's Item name is derived as `"<product> — <shade>"`, and its
 * attributes are reduced to the cosmetic fields actually filled in (shade,
 * size, expiry). Money strings go through {@link tryParse} (so "GH₵85.00" is
 * accepted). Pure — the Server Action re-checks against RLS / the RPC.
 */
export function parseProductInput(input: ProductInput): ProductParseResult {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Enter a product name." };

  const brandText = input.brand.trim();
  const brand = brandText === "" ? null : brandText;

  if (!input.shades || input.shades.length === 0) {
    return { ok: false, error: "Add at least one shade." };
  }

  const shades: ShadeWrite[] = [];
  const seen = new Set<string>();

  for (const raw of input.shades) {
    const shade = raw.shade.trim();
    if (!shade) return { ok: false, error: "Give every shade a name." };

    const dedupeKey = shade.toLowerCase();
    if (seen.has(dedupeKey)) {
      return {
        ok: false,
        error: `Two shades are both named “${shade}”. Give each shade a different name.`,
      };
    }
    seen.add(dedupeKey);

    const price = tryParse(raw.price);
    if (price === null || price < 0) {
      return { ok: false, error: `Enter a valid selling price for “${shade}” (e.g. 85.00).` };
    }

    const costText = raw.cost.trim();
    const cost = costText === "" ? 0 : tryParse(costText);
    if (cost === null || cost < 0) {
      return { ok: false, error: `Enter a valid cost for “${shade}”, or leave it blank.` };
    }

    const expiry = raw.expiry.trim();
    if (!isValidISODate(expiry)) {
      return { ok: false, error: `Enter a valid expiry date (YYYY-MM-DD) for “${shade}”.` };
    }

    const id = raw.id?.trim() ? raw.id.trim() : undefined;

    shades.push({
      ...(id ? { id } : {}),
      name: `${name} — ${shade}`,
      cost_pesewas: cost,
      price_pesewas: price,
      attributes: buildAttributes("cosmetic", { shade, size: raw.size, expiry }),
    });
  }

  const id = input.id?.trim() ? input.id.trim() : undefined;
  return { ok: true, value: { ...(id ? { id } : {}), name, brand, shades } };
}
