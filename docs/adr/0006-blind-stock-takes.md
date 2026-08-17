# Stock takes: blind counts, Owner-approved variance, a fourth ledger reason

Theft — by customers or staff — is stock that leaves *without* a Sale, so the ledger (ADR-0004) can never see it directly; it can only be caught by comparing a physical count against the ledger. A **Stock take** is that comparison: either role counts (a Cashier their own Shop, the Owner any Shop in context), entry is **blind** (the counter never sees expected quantities), and nothing touches stock until the Owner reviews each **Variance** (counted − expected, snapshotted server-side when the line is entered), classifies it (damaged / expired / other-explained / unexplained), and approves. Approval posts one movement per non-zero Variance under a **new, fourth ledger reason — `stock_take`** — rather than reusing `correction`.

We chose blind entry plus Owner approval so a counter can't rubber-stamp the system number, and a dishonest counter must lie under their own recorded name against a future Owner spot-count — detection and attribution, since prevention is impossible in software. We chose a distinct reason so **Shrinkage** (unexplained loss valued at cost — the theft signal) is a clean query, never entangled with ad-hoc Corrections.

## Considered Options

- **Owner-only counting**: most trustworthy numbers, rejected — the Owner would have to visit every Shop for every count, so counts would be rare and theft detected months late.
- **Cashier counts auto-post**: rejected — breaks the Owner-only ledger-write invariant and lets a thief silently "correct away" evidence.
- **Reuse `correction` with a provenance link**: rejected — "Correction" would mean two things, and every shrinkage report would filter by provenance forever.
- **Blind counts + Owner-approved posting under a new reason** (chosen).

## Consequences

- **Amends ADR-0004**: the reason set becomes `sale | restock | correction | stock_take` (the CHECK widens; `stock_take` may be either sign, like `correction`). A `stock_take` movement links to the count line it settles. `STOCK_REASONS` in `lib/stock.ts` and every reason consumer follow.
- **Correction narrows in meaning**: a *known* fix (damage you witnessed, a typo). A gap discovered by counting is always a Stock take's Variance, never a Correction.
- A session covers a chosen subset of carried Items (default: all); every line is counted or explicitly skipped. Selling continues during a count, but a counted line invalidated by a mid-count Sale is flagged **stale** at review and must be recounted, not trusted — false shrinkage against honest staff is the most corrosive failure mode.
- Variances and Shrinkage join the Owner-only visibility family (with cost/margin/inventory value). Shrinkage is attributed to a *Shop and the window between two Stock takes*, never a person; shift tracking is an explicit non-goal — counting more often is the narrowing lever.
- Surfaces: Stock takes live under Inventory (start/resume, Owner review queue, per-Shop history); the Owner dashboard gains a Shrinkage figure (all-Shops rollup with per-Shop drill). A Cashier sees only "start/continue a count".
