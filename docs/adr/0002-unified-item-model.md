# One unified Item model for wigs and cosmetics

Wigs and cosmetics are sold side by side but shaped differently (wigs stand alone; cosmetics come in shades). Rather than maintain two parallel data models and duplicate every feature, we use a single `items` table as the counted/priced/sold unit, with an optional `products` grouping for cosmetic shades and a flexible `attributes` field (JSONB) for category-specific fields.

A wig is simply an Item with no parent Product; a cosmetic shade is an Item under a Product. This keeps Sales, Stock movements, and dashboard aggregation uniform over one model, while the wig-vs-cosmetic difference lives only in the UI (different add/edit forms) and the `category`/`attributes` fields.

## Consequences

- The `products` table is barely used by wigs by design — that asymmetry is intentional, not an oversight.
- Category-specific validation lives in application code, since `attributes` is schemaless at the DB level.

> **Amended by ADR-0005 (Shop-scoped multi-tenancy).** The Item model is unchanged *as a catalog/price unit*, but stock no longer lives on it: the denormalized `quantity` moves off `items` onto **Shop stock** (`item × shop`). The Item now holds only catalog, cost, and selling price — all business-wide.
