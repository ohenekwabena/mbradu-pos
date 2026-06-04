# Item stock is derived from a movement ledger

An Item's stock is tracked as an append-only ledger of Stock movements — each a Sale (out), Restock (in), or Correction (either way), with amount, actor, and timestamp — rather than a single editable quantity field.

We chose this for accountability and trust: the ledger explains *why* a count changed and *who* changed it, supports dashboard inputs like "received this week", and pairs naturally with the no-overselling rule (a Sale movement can't take stock negative). The cost is an extra table and a movement row written on every stock change.

## Consequences

- Current quantity is the sum of an Item's movements. For read performance we may keep a denormalized `quantity` column on the Item, but the ledger remains the source of truth and the two must be updated together in one transaction.

> **Amended by ADR-0005 (Shop-scoped multi-tenancy).** The ledger is now per *(Item, Shop)*, not per Item. Every Stock movement carries a `shop_id`; a **Shop stock**'s quantity is the sum of *its* movements and never goes negative, and the denormalized `quantity` lives on the Shop-stock row (not the Item), updated in the same transaction as the movement.
