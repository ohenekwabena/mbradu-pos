# Selling tolerates a slow, flaky connection — without going offline

Cashiers sell from a phone on mobile data, and the original "reliable connectivity at the counter" assumption (PRD) did not hold: a Sale cost a server action plus two full page loads, and a timed-out **Complete sale** left the cashier unable to tell whether the Sale was written — a retry could double-book it (double stock decrement, a phantom Over/short at Day close that reads as theft), and not retrying could lose it. We fixed the *slow/flaky* case and deliberately did **not** build offline selling: the Sell screen stays mounted across Sales, the phone calls `complete_sale` **directly** (no Next.js server hop), and every checkout carries a **client-generated Sale id** that makes completion idempotent.

## Considered Options

- **Offline selling with a sync queue**: rejected — the reported problem is latency, not outages; a queue of unsent Sales would need conflict handling against the no-oversell rule and reverses a documented v1 non-goal.
- **Keep the server action, just add retries**: rejected — retries without an idempotency key are what create duplicate Sales, and the action's checks duplicate what `complete_sale` already enforces.
- **Direct, idempotent RPC from a persistent Sell screen** (chosen).

## Consequences

- **One pending Sale at a time.** The cart stays on screen until the server confirms; the app auto-retries, then offers Retry. Resending (or re-tapping Complete) with the same Sale id returns the existing Sale — never a second one. There is no queue of unsent Sales.
- **The database is the only validator.** `complete_sale` remains the authority on authorisation, server-side prices, carried Items and no overselling; the phone's checks are for friendly input messages only. The RPC raises **stable error codes** (e.g. insufficient stock, price changed, not authorised) that the phone maps to plain-English messages — raw database text is never shown.
- **Price changes are confirmed, not absorbed.** The phone sends the total it displayed; if the server's total differs, nothing is written, and the cashier sees the new prices and confirms before resending.
- **The phone's stock figure is a hint.** With one cashier per Shop, it goes stale only when the Owner restocks, corrects, approves a Stock take, or (rarely) sells in that Shop — the realistic failure is an Item shown out of stock after a restock. A small background refresh of the Shop's stock quantities (on a timer and on returning to the tab) covers it; an "only N left" correction at checkout handles the rare clash.
- The receipt renders on the Sell screen from the confirmed RPC response; `/sales/[id]` remains the permanent page.
- Follow-up: an installable app with a service worker caching the app shell (never Sales) for fast cold starts — tracked separately.
