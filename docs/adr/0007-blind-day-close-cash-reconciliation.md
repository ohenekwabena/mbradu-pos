# Cash is reconciled by a blind Day close against a business-wide Float

Stock takes (ADR-0006) can't see the other loss channel: cash skimmed from a drawer whose Sales were rung correctly. A **Day close** ends each selling day at each Shop: the Cashier (or the Owner in Shop context) counts the physical drawer and *declares* the amount blind — no expected figure shown — and the app computes **Over/short** = declared − (**Float** + the day's recorded cash Payments), visible to the Owner only. It covers **cash only**: Mobile Money, Card, and Bank transfers land in accounts and reconcile against provider statements outside the app. The Float is one fixed **business-wide** amount in `shop_settings`, consistent with the one-row settings rule (ADR-0005).

## Considered Options

- **Per-Shop floats**: rejected for v1 — breaks the deliberate business-wide-settings rule for a difference between Shops that doesn't yet exist.
- **Declared-open + declared-close**: rejected — doubles the daily ritual, and the morning declaration is unverifiable, letting a thief set a false baseline each day.
- **Reconcile all payment methods**: rejected — confirming MoMo/card totals in-app is ceremony the provider statement already proves.
- **Blind cash-only close against a fixed business-wide Float** (chosen).

## Consequences

- `shop_settings` gains the Float. Cash leaves the drawer only at Day close — mid-day cash removal by the Owner becomes a documented don't, since it would fabricate a shortage.
- Over/short is **evidence, not workflow**: no approval step, no classification, an optional note. The Owner follows up in person.
- The Owner dashboard flags any selling day without a close. A missed day stays closable until the Shop's next Sale rings; after that a declaration is accepted but marked **stale** (recorded, never trusted) — mirroring the Stock take's stale-line rule. Selling is never blocked: a stopped morning queue costs more than a stale close.
- A thief's cheapest move — simply not closing — is exactly what the flag surfaces as a pattern.
