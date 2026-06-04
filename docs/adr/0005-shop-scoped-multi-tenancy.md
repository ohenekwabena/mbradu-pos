# Shop-scoped multi-tenancy: shared catalog, per-Shop stock

The business now runs **multiple Shops** (reversing the original single-shop scope, where "multiple branches" was an explicit non-goal — see `CONTEXT.md`). We make the **Shop** the unit that scopes all operational data — stock, Sales, staff, and the Cashier's view — while keeping the **catalog business-wide**: one set of Items/Products with one cost and one selling price, shared by every Shop. Stock is tracked per Shop on a new **Shop stock** *(Item × Shop)* grain; a Shop **carries** an Item only once a Shop-stock row exists (curated, not automatic). A single global **Owner** administers every Shop and picks a **Shop context** to sell; each **Cashier** is bound to one Shop (reassignable by the Owner) and sees only that Shop.

We chose shared-catalog-with-per-Shop-stock over fully independent per-Shop catalogs because the Shops sell the same products and the Owner wants one place to define an Item and a cross-Shop view of the business — at the cost of not supporting per-Shop pricing, which we accept for v1.

## Considered Options

- **Independent per-Shop catalogs** (just add `shop_id` to `items`): rejected — duplicates every product definition per Shop and blocks a clean "how is Ruby Woo doing across all Shops" view; its only win was leaving ADR-0002/0004 untouched.
- **Shared catalog + per-Shop stock** (chosen): one catalog, stock at the *(Item, Shop)* grain.
- **Per-Shop pricing/cost**: rejected for v1 — price and cost stay business-wide on the Item.

## Consequences

- **Amends ADR-0002**: the denormalized `quantity` no longer lives on `items`. Items hold catalog + price/cost only; quantity moves to **Shop stock**, keyed by *(item, shop)*.
- **Amends ADR-0004**: the ledger and its quantity invariant are now per *(Item, Shop)*. Every Stock movement carries a `shop_id`; a Shop stock's quantity equals the sum of *its* movements and never goes negative. The denormalized quantity lives on the Shop-stock row, updated in the same transaction as the movement.
- `sales`, `sale_line_items`-derived movements, `invitations`, and `profiles` gain a `shop_id`; `Sale.shop` is immutable even when a Cashier is reassigned.
- **RLS gains a Shop dimension**: a Cashier may read/write only their Shop's stock and Sales; the Owner spans all Shops. This is the second tenancy axis on top of the existing role/column rules.
- `shop_settings` stays a single business-wide row (one low-stock threshold, one expiry window, one currency) — deliberately *not* per-Shop in v1.
- The dashboard view-model gains an all-Shops aggregate path and a revenue-by-Shop comparison series, plus per-Shop filtering.
- Deferred: per-Shop pricing, a per-Shop manager role, and closing/deactivating a Shop.
