# PRD: Mbradu Wigs & Cosmetics — POS (v1)

> Status: **published to Jira** as Epic [MP-13](https://nibbies.atlassian.net/browse/MP-13) (project **MP**, `nibbies.atlassian.net`) on 2026-06-04 — broken into 18 child issues MP-14–MP-31, all labelled `needs-triage`.
> Authoritative domain language lives in `CONTEXT.md`; decisions in `docs/adr/0001`–`0005`.
> **Revised to multi-Shop** (was single-shop): see ADR-0005 and the scope-change note in `CONTEXT.md`.

## Problem Statement

Mbradu Wigs & Cosmetics runs **several Shops** and tracks stock and sales by hand. The Owner can't see, across all Shops or for any one Shop, what's in stock, what's running low, or what's about to expire. Ringing up a sale doesn't update stock, so counts drift and the Owner can't trust them. There's no record of who sold what, at which Shop, or how the day's money came in (cash vs Mobile Money vs card). And the Owner has no private view of cost and profit separate from what staff can see. The Owner needs one system to ring up sales against each Shop's real inventory, keep counts trustworthy, and see the state of the business — every Shop and the whole — at a glance.

## Solution

A web-based, **multi-Shop** POS. A single Owner administers every Shop: opens new Shops, maintains one business-wide catalog, stocks each Shop, and invites Cashiers into a specific Shop. Cashiers sign in with a password plus a one-time code emailed to them and ring up multi-item sales against **their own Shop's** live stock — never overselling — recording how the customer paid (Cash / Mobile Money / Card / Bank transfer, optionally split across methods) and printing an on-screen receipt. The Owner manages stock through a per-Shop logged ledger (Restocks and Corrections) and sees a dashboard that defaults to all Shops combined (sales, payment mix, profit, stock health: low / out / expiring) with a per-Shop drill-down and a revenue-by-Shop comparison; to sell or to view one Shop, the Owner picks a **Shop context**. Wigs, cosmetics, and wig tools share one Item model (catalog and price are business-wide); only cosmetics group into Products and track expiry. Cost, margin, and inventory value are visible only to the Owner.

## User Stories

**Access & onboarding**

1. As an Owner, I want to invite a Cashier by email **into a specific Shop**, so that only people I authorize can use the POS and each is bound to one Shop.
2. As an invited Cashier, I want to complete sign-up from my invitation, so that I can get access to my Shop.
3. As a Cashier, I want to sign in with my password and then a one-time code emailed to me, so that my account has a second layer of protection.
4. As a Cashier, I want to request a fresh code if mine expires or never arrives, so that I'm not locked out.
5. As an Owner, I want to be able to do everything a Cashier can — selling within a **Shop context** I choose — plus manage the catalog, every Shop's stock, and staff, so that I can run the business myself.

**Selling**

6. As a Cashier, I want to search the Items **my Shop carries** by name and filter by Category (Wig / Cosmetic / Wig Tool), so that I can find what the customer is buying.
7. As a Cashier, I want to add Items to a sale and set quantities, so that I can ring up a multi-item purchase.
8. As a Cashier, I want the running total to update as I add Items, so that I always know the amount due.
9. As a Cashier, I want to see each Item's available quantity **at my Shop** while selling, so that I know what I can sell.
10. As a Cashier, I want to be blocked from selling more units than are in stock **at my Shop**, so that inventory stays accurate.
11. As a Cashier, I want to record one or more payment methods on a sale, so that the money is tracked.
12. As a Cashier, I want to split a sale across methods (e.g. part cash, part MoMo), so that I can match how the customer actually pays.
13. As a Cashier, I want the system to ensure my payments sum to the total, so that money isn't mis-recorded.
14. As a Cashier, I want to enter cash tendered and see change due, so that I give correct change.
15. As a Cashier, I want to optionally type the customer's name, so that it appears on the receipt.
16. As a Cashier, I want completing a sale to decrement **my Shop's** stock automatically, so that counts stay current.
17. As a Cashier, I want a printable on-screen receipt after a sale, so that the customer has a record.
18. As a Cashier, I want completed sales to be immutable, so that records can't be altered after the fact.

**Inventory (Owner)**

19. As an Owner, I want to view all Items with **each Shop's** stock, price, and status, so that I can see inventory across Shops and drill into one Shop.
20. As an Owner, I want to search and filter inventory by Category (Wig / Cosmetic / Wig Tool), low stock, or expiring, **and by Shop**, so that I can focus on what needs attention.
21. As an Owner, I want to add a wig as a standalone Item, so that I can stock it.
22. As an Owner, I want to add a cosmetic Product with several shade Items, so that I can stock a line of shades.
22a. As an Owner, I want to add a wig tool as a standalone Item with its tool type and brand, so that I can stock accessories alongside wigs and cosmetics.
23. As an Owner, I want to set each Item's cost, selling price, and Attributes, so that pricing and details are right.
24. As an Owner, I want to set expiry on cosmetics, so that the system can warn me before they expire.
25. As an Owner, I want to edit an Item's details, so that I can correct or update it.
26. As an Owner, I want to record a Restock **at a chosen Shop** when supply arrives, so that that Shop's quantities rise with a logged reason (the first Restock starts the Shop carrying the Item).
27. As an Owner, I want to record a Correction (up or down) **at a chosen Shop**, so that I can fix miscounts or damage with an audit trail.
28. As an Owner, I want to see an Item's movement history **per Shop**, so that I understand why a Shop's count changed and who changed it.
29. As an Owner, I want only myself to change inventory **at any Shop**, so that Cashiers can't alter stock.
30. As an Owner, I want to set the business-wide low-stock threshold, so that warnings match my preference.

**Dashboard & visibility**

31. As an Owner, I want today's sales count and revenue on the dashboard, so that I know how the day is going.
32. As an Owner, I want a revenue trend over the week/month, so that I can spot patterns.
33. As an Owner, I want revenue broken down by payment method, so that I can reconcile cash vs MoMo vs card.
34. As an Owner, I want to see profit/margin, so that I know what I'm actually making.
35. As an Owner, I want to see total inventory value, so that I know the capital tied up in stock.
36. As an Owner, I want lists of low-stock and out-of-stock Items, so that I know what to reorder.
37. As an Owner, I want a list of cosmetics expiring soon, so that I can discount or pull them.
38. As an Owner, I want a recent-sales feed, so that I can review activity.
39. As a Cashier, I want a trimmed dashboard scoped to **my Shop** (today's sales + stock health), so that I have what I need to work.
40. As a Cashier, I want to never see cost, margin, or inventory value, so that sensitive figures stay with the Owner.
41. As any user, I want all amounts shown in Ghana Cedi (GH₵), so that figures match the business's currency.

**Shops (Owner)**

42. As an Owner, I want to open a new Shop (name, optional address and phone), so that I can expand the business and stock it.
43. As an Owner, I want to pick a Shop context, so that my selling, inventory, and single-Shop dashboard views are scoped to one Shop.
44. As an Owner, I want my dashboard to default to all Shops combined, so that I see the whole business at a glance.
45. As an Owner, I want to drill into a single Shop and compare revenue by Shop, so that I can see which Shops perform.
46. As an Owner, I want to reassign a Cashier to a different Shop, so that I can cover staffing moves (past Sales keep their original Shop).
47. As a Cashier, I want to see and transact for only my Shop, so that I can't affect another Shop's stock or sales.

## Implementation Decisions

**Stack & conventions**
- Next.js 16.2.6 (App Router), React 19, Tailwind v4, TypeScript; Supabase (Postgres + Auth) — see ADR-0001.
- This Next.js has breaking changes vs. common knowledge (`AGENTS.md`): bundled docs in `node_modules/next/dist/docs/` are consulted before writing code.
- Money is handled as **integer minor units (pesewas)** end to end to avoid floating-point drift; formatted as GH₵ at the edges.

**Data model** (see ADR-0002 unified Item model, ADR-0004 stock ledger, ADR-0005 Shop-scoped multi-tenancy)
- **shops** — one row per Shop: name, optional address and phone (shown on receipts), created_at. Only the Owner can insert.
- **profiles** — one per auth user, carrying role (`owner` | `cashier`) and `shop_id` (the Cashier's one Shop; null for the Owner, who spans all Shops). The Owner may update a Cashier's `shop_id` to reassign.
- **invitations** — Owner-issued authorizations for a Cashier to sign up, carrying the target `shop_id`.
- **products** — optional grouping for cosmetic shade lines (cosmetics only).
- **items** — the business-wide catalog/priced/sold unit: `category` (`wig` | `cosmetic` | `wig_tool`), cost, selling price, flexible `attributes`, optional `product_id`. **No `quantity` column** — stock lives per Shop (ADR-0005).
- **shop_stock** — the *(item, shop)* grain: `item_id`, `shop_id`, denormalized current `quantity`. A row's existence = that Shop **carries** the Item; unique on *(item_id, shop_id)*.
- **stock_movements** — append-only ledger at the *(item, shop)* grain: `item_id`, `shop_id`, reason (`sale` | `restock` | `correction`), signed amount, actor, timestamp, optional sale reference.
- **sales** — immutable: `shop_id`, seller (cashier or Owner), timestamp, total, optional customer name. `shop_id` is fixed at completion.
- **sale_line_items** — item, quantity, unit price captured at sale time.
- **payments** — one row per method (cash / momo / card / transfer) + amount; rows sum to the sale total.
- **shop_settings** — **single business-wide row**: low-stock threshold, expiry-warning window, currency (GH₵). Deliberately not per-Shop (ADR-0005).

**Auth & authorization** (see ADR-0003, ADR-0005)
- Password + a custom emailed one-time code (Supabase email OTP under the hood), not Supabase's first-class MFA. Owner issues Invitations (each naming a Shop). Production requires a custom SMTP provider (e.g. Resend) since Supabase's built-in sender is rate-limited.
- Row-level security gates row access on **two axes**: role and Shop. Inventory tables are Owner-write-only; a Cashier may read/write only rows for **their own Shop** (`shop_stock`, `stock_movements`, `sales`, `payments`, `sale_line_items` of their Shop). The Owner spans all Shops. Cost/margin must additionally be hidden from Cashiers at the **column** level — via a restricted view or column privileges, not plain RLS.

**Behavioural contracts**
- Completing a sale is a **single transaction** scoped to one **Shop**: insert the Sale (with its `shop_id`) + Line items + Payments + one Stock movement per line at that Shop, decrement the Shop's `shop_stock.quantity`. The server rejects the sale if any line exceeds the **Shop's** available stock (no negative stock), if the Item isn't carried by the Shop, or if payments don't sum to the total. A Cashier's Shop is taken from their profile; the Owner's from the active Shop context.
- A Shop stock's quantity always equals the sum of its *(item, shop)* Stock movements; the denormalized `quantity` on `shop_stock` is updated inside the same transaction as the movement.
- The dashboard view is computed per role and Shop scope — the Owner can request an all-Shops rollup, a single-Shop view, or a by-Shop comparison; a Cashier receives only their Shop's figures, with no cost/profit/value fields at all (not merely hidden in the UI).

**Modules** (deep, behind small stable interfaces — no file paths)
- **Sale builder** — line/grand totals, no-oversell guard (against the **Shop's** stock), cash-change calc, split-payment sum validation; emits a Sale (carrying its Shop) + the per-Shop Stock movements to persist.
- **Stock ledger** — quantity-from-movements at the *(item, shop)* grain (never negative), low-stock (a Shop stock vs the business-wide threshold), cosmetic expiring-soon, movement construction for sale/restock/correction with a Shop.
- **Money (GH₵)** — minor-unit arithmetic, rounding, formatting.
- **Visibility policy** — `can(actor, action, shop?)` plus redaction stripping cost/margin for a Cashier **and** restricting a Cashier to their own Shop's rows.
- **Dashboard view-model** — pure transform from Sales + Shop stock + settings + role + **Shop scope** (all Shops / one Shop / by-Shop comparison) into the dashboard figures.
- Shallow wrappers (not deep): Supabase repositories, the auth/invite flow, and the App Router UI routes (login+OTP, dashboard, sell, inventory, Owner-only Shop management, invite, & item editor). The Owner's **Shop context** is a thin UI/session concern over these.

## Testing Decisions

- **What makes a good test:** it verifies *external behaviour* through a module's public interface with realistic inputs, and never asserts on internals — so refactors that preserve behaviour don't break tests.
- **Runner:** Vitest for the pure modules (no prior test art exists; this establishes the first setup). A small set of integration tests run against a **Supabase branch**.
- **Unit-tested modules (all five deep modules):**
  - *Sale builder* — totals; rejects overselling **against the Shop's stock**; rejects selling an Item the Shop doesn't carry; correct change; rejects payments that don't sum to the total; the emitted Sale and movements carry the Shop.
  - *Stock ledger* — a Shop stock's quantity equals the sum of its *(item, shop)* movements and never goes negative; low-stock at/below the business-wide threshold per Shop stock; cosmetic expiring-soon windows; correct movement construction with a Shop.
  - *Money* — arithmetic, rounding, and formatting with no float drift.
  - *Visibility policy* — Owner vs Cashier permissions; cost/margin redaction for Cashiers; a Cashier is confined to their own Shop's rows.
  - *Dashboard view-model* — correct figures from fixture data across Shop scopes (all / one / by-Shop comparison); Owner-only fields absent from a Cashier payload; a Cashier payload covers only their Shop.
- **Integration tests (shallow layer):** the sale-write transaction (atomicity + no-oversell enforced at the database) and the auth/invitation flow. These exercise Supabase directly, so they run against a branch rather than mocks.
- **Prior art:** none — this PRD introduces both the unit-test (Vitest) and integration-test (Supabase branch) patterns for the repo.

## Out of Scope

Deliberate v1 non-goals (their absence is intentional — see `CONTEXT.md`): returns/refunds; discounts; barcodes/scanning; item photos/images; stored customer records & loyalty; offline use; tax/VAT lines; multi-currency; and any payment *processing* — methods are recorded only, with no gateway integration.

Multi-Shop **is now in scope** (ADR-0005), but these multi-Shop refinements are deliberately deferred: **per-Shop pricing or cost** (price and cost are business-wide on the Item); **per-Shop settings** (the low-stock threshold, expiry window, and currency stay business-wide); a **per-Shop manager role** (only Owner and Cashier exist); and **closing/deactivating a Shop** (Shops can be opened, not retired, in v1).

## Further Notes

- Production email OTP needs a custom SMTP provider (e.g. Resend) wired into Supabase before go-live.
- Assumes **online-only** operation with reliable connectivity at the counter; hosting assumed to be Vercel + Supabase cloud.
- **Needs confirmation at triage** (not explicitly decided during grilling): staff revoke/deactivation (story 5 implies management) and Item archiving/discontinuation. Included as plausible needs; cut or split as triage sees fit.
- Published to Jira as Epic [MP-13](https://nibbies.atlassian.net/browse/MP-13) (project MP, `nibbies.atlassian.net`) on 2026-06-04; git remote `origin` → `github.com/ohenekwabena/mbradu-pos`.
