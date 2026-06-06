// One-time inventory seed for Mbradu POS. Populates the business-wide catalog
// with sample Items across all three Categories (ADR-0002):
//
//   - wig       — standalone Item   → attributes: length / texture / lace / density / origin
//   - wig_tool  — standalone Item   → attributes: type / brand
//   - cosmetic  — shade Item under  → attributes: shade / size / expiry
//                 a Product grouping
//
// Money is written here in GH₵ and stored as integer pesewas (1 GH₵ = 100p; see
// lib/money.ts). Cosmetic shade Items mirror exactly what the save_cosmetic_product
// RPC / parseProductInput produce: a derived "<product> — <shade>" name and a
// flat { shade, size, expiry } attributes map (blanks dropped).
//
// Writes go through the SUPABASE_SERVICE_ROLE_KEY (bypasses RLS, like
// scripts/bootstrap-owner.mjs), so no Owner sign-in is required. Stock is NOT
// seeded: Items are business-wide and stock lives per Shop (ADR-0005) — add it
// with Restock in the app once a Shop should carry an Item.
//
// Idempotent: a re-run skips any wig/tool whose name — or any cosmetic Product
// whose name — already exists, so running it twice won't duplicate the catalog.
//
// Usage (reads .env.local, same as bootstrap-owner):
//   npm run seed:inventory

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

function loadEnvLocal(path = ".env.local") {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !(match[1] in process.env)) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local — rely on the ambient environment.
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is not set.");
if (!serviceKey)
  fail("SUPABASE_SERVICE_ROLE_KEY is not set (add it to .env.local).");

/** GH₵ (major units) → integer pesewas, the unit stored on items. */
const ghs = (cedis) => Math.round(cedis * 100);

/** Flat attributes map with blank/empty fields dropped (cf. buildAttributes). */
function attrs(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value != null && String(value).trim() !== "") out[key] = String(value).trim();
  }
  return out;
}

// ===========================================================================
// Seed data — costs and prices in GH₵.
// ===========================================================================

// --- Wigs (standalone Items) ------------------------------------------------
const WIGS = [
  { name: 'Brazilian Body Wave 16"', cost: 1200, price: 2200,
    length: '16"', texture: "Body wave", lace: "HD 5×5 closure", density: "150%", origin: "Brazilian" },
  { name: 'Peruvian Straight 20"', cost: 1800, price: 3200,
    length: '20"', texture: "Straight", lace: "13×4 frontal", density: "180%", origin: "Peruvian" },
  { name: 'Vietnamese Deep Wave 18"', cost: 1500, price: 2800,
    length: '18"', texture: "Deep wave", lace: "HD 4×4 closure", density: "200%", origin: "Vietnamese" },
  { name: 'Brazilian Kinky Curly 14"', cost: 1000, price: 1900,
    length: '14"', texture: "Kinky curly", lace: "5×5 closure", density: "150%", origin: "Brazilian" },
  { name: 'Indian Loose Wave 22"', cost: 2000, price: 3600,
    length: '22"', texture: "Loose wave", lace: "13×6 frontal", density: "180%", origin: "Indian" },
  { name: 'Straight Bob 10"', cost: 700, price: 1400,
    length: '10"', texture: "Straight bob", lace: "4×4 closure", density: "150%", origin: "Brazilian" },
  { name: 'Burmese Curly 16"', cost: 1600, price: 2900,
    length: '16"', texture: "Curly", lace: "HD 5×5 closure", density: "180%", origin: "Burmese" },
  { name: 'Pixie Cut Wig 8"', cost: 350, price: 750,
    length: '8"', texture: "Pixie", lace: "Glueless / none", density: "130%", origin: "Synthetic blend" },
  { name: 'Water Wave 24"', cost: 2200, price: 3900,
    length: '24"', texture: "Water wave", lace: "13×4 frontal", density: "200%", origin: "Brazilian" },
  { name: 'Body Wave 30"', cost: 3000, price: 5200,
    length: '30"', texture: "Body wave", lace: "13×6 HD frontal", density: "250%", origin: "Cambodian" },
];

// --- Wig tools (standalone Items) -------------------------------------------
const WIG_TOOLS = [
  { name: "Tripod Wig Stand", cost: 80, price: 160, type: "Wig stand", brand: "SilkPro" },
  { name: "Edge Control Brush", cost: 15, price: 35, type: "Brush", brand: "EcoStyle" },
  { name: "Lace Adhesive Glue", cost: 40, price: 85, type: "Adhesive", brand: "Got2b" },
  { name: "Adhesive Remover", cost: 45, price: 95, type: "Adhesive remover", brand: "Walker" },
  { name: "Wide Tooth Comb", cost: 20, price: 45, type: "Comb", brand: "Denman" },
  { name: "Mannequin Head", cost: 120, price: 240, type: "Mannequin head", brand: "SilkPro" },
  { name: "Stocking Wig Cap (2-pack)", cost: 8, price: 20, type: "Wig cap", brand: "Nu-Care" },
  { name: "Edge Lay Scarf", cost: 10, price: 25, type: "Edge scarf", brand: "HairFlair" },
  { name: "Styling Mousse", cost: 30, price: 65, type: "Styling foam", brand: "Got2b" },
];

// --- Cosmetics (each Product groups several shade Items) ---------------------
// expiry is ISO YYYY-MM-DD (a real calendar date; cf. isValidISODate).
const COSMETICS = [
  {
    name: "Velvet Matte Lipstick", brand: "Huda Beauty",
    shades: [
      { shade: "Ruby Woo", size: "4 g", expiry: "2027-08-31", cost: 55, price: 120 },
      { shade: "Nude Rose", size: "4 g", expiry: "2027-08-31", cost: 55, price: 120 },
      { shade: "Berry Crush", size: "4 g", expiry: "2027-06-30", cost: 55, price: 120 },
      { shade: "Coral Sunset", size: "4 g", expiry: "2027-10-31", cost: 55, price: 120 },
    ],
  },
  {
    name: "Pro Filt'r Foundation", brand: "Fenty Beauty",
    shades: [
      { shade: "110 Cool", size: "32 ml", expiry: "2028-01-31", cost: 130, price: 260 },
      { shade: "240 Warm", size: "32 ml", expiry: "2028-01-31", cost: 130, price: 260 },
      { shade: "370 Medium Deep", size: "32 ml", expiry: "2027-11-30", cost: 130, price: 260 },
      { shade: "440 Deep", size: "32 ml", expiry: "2027-11-30", cost: 130, price: 260 },
      { shade: "498 Rich", size: "32 ml", expiry: "2027-12-31", cost: 130, price: 260 },
    ],
  },
  {
    name: "Hydrating Concealer", brand: "Maybelline",
    shades: [
      { shade: "Fair", size: "6 ml", expiry: "2027-09-30", cost: 35, price: 75 },
      { shade: "Medium", size: "6 ml", expiry: "2027-09-30", cost: 35, price: 75 },
      { shade: "Caramel", size: "6 ml", expiry: "2027-07-31", cost: 35, price: 75 },
      { shade: "Honey", size: "6 ml", expiry: "2027-07-31", cost: 35, price: 75 },
    ],
  },
  {
    name: "Loose Setting Powder", brand: "Ben Nye",
    shades: [
      { shade: "Banana", size: "42 g", expiry: "2028-03-31", cost: 90, price: 180 },
      { shade: "Topaz", size: "42 g", expiry: "2028-03-31", cost: 90, price: 180 },
    ],
  },
  {
    name: "Liquid Glow Highlighter", brand: "Fenty Beauty",
    shades: [
      { shade: "Trophy Wife", size: "11 ml", expiry: "2027-12-31", cost: 95, price: 190 },
      { shade: "Hustla Baby", size: "11 ml", expiry: "2027-12-31", cost: 95, price: 190 },
      { shade: "Mean Money", size: "11 ml", expiry: "2027-12-31", cost: 95, price: 190 },
    ],
  },
  {
    name: "Brow Definer Pencil", brand: "Anastasia",
    shades: [
      { shade: "Soft Brown", size: "0.2 g", expiry: "2028-02-28", cost: 60, price: 130 },
      { shade: "Dark Brown", size: "0.2 g", expiry: "2028-02-28", cost: 60, price: 130 },
      { shade: "Ebony", size: "0.2 g", expiry: "2028-02-28", cost: 60, price: 130 },
    ],
  },
];

// ===========================================================================
// Build the DB rows.
// ===========================================================================

const wigRows = WIGS.map((w) => ({
  category: "wig",
  name: w.name,
  cost_pesewas: ghs(w.cost),
  price_pesewas: ghs(w.price),
  attributes: attrs({
    length: w.length, texture: w.texture, lace: w.lace, density: w.density, origin: w.origin,
  }),
}));

const toolRows = WIG_TOOLS.map((t) => ({
  category: "wig_tool",
  name: t.name,
  cost_pesewas: ghs(t.cost),
  price_pesewas: ghs(t.price),
  attributes: attrs({ type: t.type, brand: t.brand }),
}));

// ===========================================================================
// Write — service role bypasses RLS, so direct inserts stand in for the
// Owner-gated write paths (saveItem / save_cosmetic_product).
// ===========================================================================

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Existing names → make re-runs safe (skip what's already in the catalog).
const { data: existingItems, error: itemsReadErr } = await supabase.from("items").select("name");
if (itemsReadErr) fail(`Could not read existing items: ${itemsReadErr.message}`);
const itemNames = new Set((existingItems ?? []).map((r) => r.name));

const { data: existingProducts, error: prodReadErr } = await supabase.from("products").select("name");
if (prodReadErr) fail(`Could not read existing products: ${prodReadErr.message}`);
const productNames = new Set((existingProducts ?? []).map((r) => r.name));

// --- Standalone Items: wigs + wig tools -------------------------------------
const standalone = [...wigRows, ...toolRows].filter((r) => !itemNames.has(r.name));
if (standalone.length) {
  const { error } = await supabase.from("items").insert(standalone);
  if (error) fail(`Inserting wigs/tools failed: ${error.message}`);
}
const skippedStandalone = wigRows.length + toolRows.length - standalone.length;

// --- Cosmetic Products + shade Items ----------------------------------------
let insertedProducts = 0;
let insertedShades = 0;
let skippedProducts = 0;

for (const product of COSMETICS) {
  if (productNames.has(product.name)) {
    skippedProducts += 1;
    continue;
  }

  const { data: created, error: prodErr } = await supabase
    .from("products")
    .insert({ name: product.name, brand: product.brand ?? null })
    .select("id")
    .single();
  if (prodErr) fail(`Inserting product "${product.name}" failed: ${prodErr.message}`);

  const shadeRows = product.shades.map((s) => ({
    category: "cosmetic",
    name: `${product.name} — ${s.shade}`, // derived, matches parseProductInput
    product_id: created.id,
    cost_pesewas: ghs(s.cost),
    price_pesewas: ghs(s.price),
    attributes: attrs({ shade: s.shade, size: s.size, expiry: s.expiry }),
  }));

  const { error: shadeErr } = await supabase.from("items").insert(shadeRows);
  if (shadeErr) fail(`Inserting shades for "${product.name}" failed: ${shadeErr.message}`);

  insertedProducts += 1;
  insertedShades += shadeRows.length;
}

// ===========================================================================
// Summary.
// ===========================================================================
const wigsAdded = wigRows.filter((r) => standalone.includes(r)).length;
const toolsAdded = toolRows.filter((r) => standalone.includes(r)).length;

console.log("✓ Inventory seed complete");
console.log(`  wigs:      ${wigsAdded} added` + (wigsAdded < wigRows.length ? `, ${wigRows.length - wigsAdded} already present` : ""));
console.log(`  wig tools: ${toolsAdded} added` + (toolsAdded < toolRows.length ? `, ${toolRows.length - toolsAdded} already present` : ""));
console.log(`  cosmetics: ${insertedProducts} product(s) / ${insertedShades} shade Item(s) added` + (skippedProducts ? `, ${skippedProducts} product(s) already present` : ""));
if (skippedStandalone || skippedProducts) {
  console.log("  (skips are existing rows — the seed is idempotent.)");
}
