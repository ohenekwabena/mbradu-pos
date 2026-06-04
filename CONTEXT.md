# Mbradu Wigs & Cosmetics — POS

The point-of-sale and inventory system for Mbradu, a wigs-and-cosmetics business
operating **several Shops**. Cashiers ring up sales against their own Shop's stock; the
Owner administers every Shop — catalog, stock, sales, and staff — and opens new Shops.

## Language

### Shops & people

**Shop**:
One physical sales location. The unit that scopes everything operational: stock, sales,
staff, and settings all belong to a Shop. The business runs one or more Shops; the Owner
can open new ones.
_Avoid_: Store, Branch, Location, Outlet (all mean **Shop**)

**Owner**:
The single super-user who administers **all** Shops — manages the shared catalog and each
Shop's stock, sees every Shop's sales and staff, and opens new Shops. There is exactly one
Owner across the whole business (not one per Shop).
_Avoid_: Admin (the Owner *is* the administrator — there is no separate admin role);
Manager (there is no per-Shop manager role in v1)

**Cashier**:
A staff member bound to **exactly one Shop**, who rings up sales for that Shop only. Joins
by invitation from the Owner. A Cashier never sees or transacts for another Shop.
_Avoid_: Staff, employee, user

**Invitation**:
The Owner's act of authorizing a new Cashier to sign up **into a specific Shop**. Sign-in
afterwards is password + an emailed one-time code.

### Catalog & stock

**Item**:
The single catalog unit that is priced and sold — defined **once, business-wide**. A wig is one Item; each cosmetic shade is its own Item. An Item is *not* counted in stock directly; its stock is held per Shop on **Shop stock** (below). The same Item can be carried by several Shops.
_Avoid_: SKU, variant, product (a Product *groups* Items — see below)

**Shop stock**:
One Item's stock at one Shop — the *(Item × Shop)* grain. Holds that Shop's current quantity and is the unit the ledger moves. A Shop **carries** an Item exactly when a Shop-stock row exists for it (created when the Owner first stocks it there); a Shop that doesn't carry an Item has no row at all. "Out of stock" (carried, quantity 0) is therefore distinct from "not carried" (no row).
_Avoid_: Inventory (ambiguous), shelf, stock level

**Product**:
An optional grouping of related Items that share a name/brand — used mainly for a cosmetic line sold in several shades. A wig usually has no Product.
_Avoid_: Item, line

**Category**:
Whether an Item is a **Wig**, a **Cosmetic**, or a **Wig Tool** (`wig`, `cosmetic`, `wig_tool`). Determines which Attributes apply, whether the Item can group under a Product, and whether it tracks expiry.

**Attributes**:
Category-specific fields carried on an Item, stored flexibly (not as fixed columns):
- **Wig**: length, texture, lace type, density, origin.
- **Cosmetic**: shade, size, expiry.
- **Wig Tool**: tool type (brush, comb, wig stand, cap/net, clip/pin, adhesive, scissors, spray, …), brand.

A **Wig Tool** behaves like a **Wig**: it stands alone (never groups under a Product) and never tracks expiry — only **Cosmetics** carry expiry and can be grouped.

Each Item carries a **cost** (what the shop paid) and a **selling price**, both set **once on the Item and identical at every Shop** — there is no per-Shop pricing in v1. Cost and any derived margin are visible only to the **Owner**, never to a **Cashier**.

### Selling

**Sale**:
A completed, immutable transaction recording which Items were sold, **at which Shop**, by which seller (a Cashier, or the Owner acting in a Shop context), when, and how it was paid. The Shop is fixed at completion and never changes, even if the seller is later reassigned.
_Avoid_: Order, transaction, purchase, receipt (a receipt is a *rendering* of a Sale, not the Sale itself)

**Shop context**:
The single Shop the Owner is currently acting in. The Owner has no home Shop, so before selling — and to scope the inventory and single-shop dashboard views — they pick an active Shop. A Cashier has no Shop context to choose: it is always their one assigned Shop.

**Line item**:
One Item and the quantity sold within a Sale, priced at the moment of sale.
_Avoid_: Sale item, entry

**Payment**:
One amount paid toward a Sale by one method (Cash, Mobile Money, Card, or Bank transfer). A Sale may hold several Payments that sum to its total. Methods are only *recorded* — no money moves through the app.
_Avoid_: Tender, transaction

### Inventory

**Stock movement**:
A logged change to one **Shop stock** — i.e. an Item's stock *at a specific Shop* — with amount, who, and when. Every movement names its Shop and has a reason: **Sale** (out), **Restock** (in), or **Correction** (a manual fix, either direction).
_Avoid_: Adjustment (use **Correction**), transaction

**Restock**:
An Owner-only Stock movement that adds units to a Shop's stock when new supply arrives. The **first** Restock of an Item at a Shop is what makes that Shop begin **carrying** the Item.

**Correction**:
An Owner-only Stock movement that fixes a miscount (damage, shrinkage, error) for a Shop's stock, up or down.

## Relationships

- The business has **one or more Shops**; only the **Owner** can open a new Shop
- The business has exactly one **Owner** (spanning all Shops) and zero or more **Cashiers**
- Each **Cashier** belongs to **exactly one Shop**; the **Owner** may reassign a Cashier to a different Shop (which only affects future Sales)
- An **Owner** can do everything a **Cashier** can — but must pick a **Shop context** to sell — plus manage the catalog, every Shop's stock, and staff
- A **Cashier** exists only after the **Owner** issues an **Invitation**, which names the Shop the Cashier joins
- The **catalog** (**Items**, **Products**, **cost**, **selling price**) is business-wide — one definition shared by all Shops
- Every **Item** has exactly one **Category** (Wig, Cosmetic, or Wig Tool)
- A **Product** groups one or more **Items** (the shades of a cosmetic line); only **Cosmetics** group — **Wigs** and **Wig Tools** always stand alone
- An **Item** optionally belongs to a **Product**; wigs and wig tools stand alone
- Price lives on the **Item** (business-wide); **stock quantity lives on Shop stock** (per Shop), never on the **Item** or the **Product**
- A **Shop** carries an **Item** iff a **Shop stock** row exists for that *(Item, Shop)* pair; a new Shop carries nothing until the Owner stocks it
- A **Sale** belongs to exactly one **Shop** and has one or more **Line items** and one or more **Payments**; the Payments sum to the Sale total
- Completing a **Sale** decrements that **Shop's** stock for each Item; a Sale cannot exceed the Shop's available stock (no overselling, stock never goes negative)
- A **Line item**'s price is captured at sale time — later price changes never alter past **Sales**
- A **Sale** is immutable once completed, including its **Shop**
- A **Shop stock**'s current quantity equals the sum of its **Stock movements** (which are scoped to that *(Item, Shop)*)
- Completing a **Sale** writes one Sale **Stock movement** per Line item against the selling **Shop**; only the **Owner** can write **Restock** or **Correction** movements, for any Shop

## Business rules

- **Currency**: Ghana Cedi (GH₵), single-currency, business-wide. Prices are final — no separate VAT/tax line.
- **Low stock**: a single **business-wide** threshold flags any **Shop stock** at or below it; there is no per-Shop or per-Item reorder level. The expiry-warning window is likewise business-wide.
- **Shop scoping**: a **Cashier** sees and acts on **only their own Shop** — its carried Items, stock, and Sales. The **Owner** sees every Shop, defaults to an all-Shops dashboard rollup (with per-Shop drill and a revenue-by-Shop comparison), and narrows to one Shop via the **Shop context**. This scoping is enforced server-side (row-level), not merely hidden in the UI.
- **Visibility**: cost, margin/profit, and inventory value are **Owner-only**. A **Cashier**'s dashboard is trimmed to their Shop's today-sales and stock health (low / out / expiring), with no money-at-cost figures.
- **v1 non-goals** (deliberately deferred): returns/refunds, discounts, barcodes, item photos, customer records, offline use, tax; **per-Shop pricing/cost** (price and cost are business-wide); **a per-Shop manager role** (only Owner and Cashier exist); **closing/deactivating a Shop** (Shops can be opened, not retired, in v1). These are noted so they aren't "fixed" by accident — their absence is intentional.

> **Scope change (this revision):** v1 was originally single-shop, and "multiple branches" was an explicit non-goal. That has been **reversed** — the system is now multi-Shop. See the new ADR on Shop-scoped multi-tenancy.

## Example dialogue

> **Dev:** "When you stock a new lipstick line in six shades, is that one thing or six?"
> **Owner:** "Six — each shade has its own price and count. But they're all the same **Product**, so group them."
> **Dev:** "And a 16-inch lace front wig?"
> **Owner:** "That's just one **Item**. No grouping — wigs stand on their own."
>
> **Dev:** "Ruby Woo sells at both East Legon and Osu. Same Item or two?"
> **Owner:** "Same **Item** — one price, one entry. But East Legon has 5 and Osu has 3; that's two **Shop stocks**."
> **Dev:** "Your new Tema shop — does it sell Ruby Woo?"
> **Owner:** "Not until I stock it there. A new **Shop** carries nothing; stocking an Item is what makes the Shop **carry** it."

## Flagged ambiguities

- "Item" vs "Product": the **Item** is the priced/sold unit; a **Product** is only a grouping of Items. A wig is an Item with no Product.
- "Item" vs "Shop stock": the **Item** is the business-wide catalog/price unit; **Shop stock** is its quantity at one Shop. An Item is sold; a Shop stock is counted.
- "Not carried" vs "out of stock": no **Shop stock** row = the Shop doesn't carry the Item; a row at quantity 0 = carried but out of stock. They look different on the Sell screen.
- "Owner" vs per-Shop manager: there is **one Owner** over all Shops, not one per Shop. A Cashier is the only Shop-bound staff role.
