# Mbradu POS — Design System & Page Specification

> The visual and interaction source-of-truth for the Mbradu Wigs & Cosmetics POS.
> Pairs with the domain language in [`CONTEXT.md`](CONTEXT.md), the product scope in
> [`docs/prd/mbradu-pos-v1.md`](docs/prd/mbradu-pos-v1.md), and the decisions in
> [`docs/adr/0001`–`0005`](docs/adr/). Where this document and the PRD/ADRs disagree,
> the PRD/ADRs win — open an issue rather than diverging silently.
>
> **Multi-Shop (ADR-0005).** The system spans several Shops. The Owner administers all
> Shops and switches a **Shop context** to sell or view one Shop; a Cashier is bound to one
> Shop and sees only it. Items come in three Categories — **Wig**, **Cosmetic**, **Wig Tool**.
>
> **Visual direction:** clean, light, card-based SaaS dashboard. Typeface **Poppins**;
> a four-colour brand palette anchored on deep-purple `#673AB7`. Calm, legible, and
> fast — this is a counter tool first and a dashboard second.

---

## Table of contents

1. [Design principles](#1-design-principles)
2. [Brand foundations](#2-brand-foundations)
3. [Design tokens (Tailwind v4 + next/font)](#3-design-tokens-tailwind-v4--nextfont)
4. [Core components](#4-core-components)
5. [Data visualization](#5-data-visualization)
6. [Money & numbers (GH₵)](#6-money--numbers-gh)
7. [Role-aware UI (Owner vs Cashier)](#7-role-aware-ui-owner-vs-cashier)
8. [Accessibility](#8-accessibility)
9. [Responsive behaviour](#9-responsive-behaviour)
10. [Pages & screens](#10-pages--screens)
11. [Page → story → route map](#11-page--story--route-map)
12. [Adapting the reference, and what NOT to build](#12-adapting-the-reference-and-what-not-to-build)

---

## 1. Design principles

1. **The counter comes first.** A Cashier ringing up a sale must move fast with minimal
   thinking. Selling is the most-used screen — optimise it for speed, large targets, and
   keyboard flow, not for decoration.
2. **Trust through clarity.** This system exists because hand-counts drifted. Numbers must
   be unambiguous, aligned, and always in GH₵. Stock status and totals are never "almost
   right".
3. **One calm accent.** Purple `#673AB7` is the only brand colour. It marks the active nav
   item, primary actions, focus, and the primary data series — nothing else competes with
   it. Status colours (green/amber/red/pink) are reserved strictly for meaning.
4. **Surface, don't bury.** Owners need state-of-the-business at a glance: low stock,
   expiring stock, today's money. The dashboard answers "what needs my attention?" above
   the fold.
5. **Role shapes the UI.** A Cashier and an Owner see different apps. Cost, margin, and
   inventory value never render for a Cashier — and per the PRD this is enforced
   server-side, not merely hidden with CSS.
6. **Light, airy, rounded.** White surfaces on a near-white page, generous whitespace,
   soft 1px borders, gentle elevation, ~16px card radii. No heavy chrome.
7. **Restraint over flourish.** Motion is functional (feedback, focus, transitions), brief,
   and respects `prefers-reduced-motion`. No perpetual animation on a tool people stare at
   all day.

---

## 2. Brand foundations

### 2.1 Logo & mark

The reference's purple speech-bubble is a placeholder; Mbradu needs its own mark.

- **App mark:** an **"M" monogram** in a purple (`#673AB7`) rounded square (radius 12px),
  white glyph, Poppins Semi-Bold. This mirrors the reference's purple rounded-square
  active-nav treatment, so the mark and the active state feel like one family.
- **Wordmark:** `Mbradu` in Poppins Semi-Bold ink (`#212121`), optionally with
  `Wigs & Cosmetics` in Poppins Regular muted (`#616161`) beneath at a smaller size.
- **Sidebar:** show the mark only (icon rail). **Login / receipts:** mark + wordmark.
- Clear space around the mark ≥ half its height. Never recolour the glyph or stretch it.

### 2.2 Colour

**Canonical brand palette** (the four colours from the brand sheet — treat as fixed):

| Token | Hex | Role |
|---|---|---|
| Ink | `#212121` | Primary text, dark surfaces, headings |
| Surface | `#FFFFFF` | Cards, sheets, inputs |
| Primary | `#673AB7` | Brand, primary actions, active nav, focus, primary chart series |
| Neutral line | `#BDBDBD` | Borders, dividers, disabled — **never body text** (see §8) |

These four are Material **Grey 900**, **white**, **Deep Purple 500**, and **Grey 400**. We
extend them along the matching Material ramps so the system stays principled and complete
without inventing off-brand hues.

**Primary ramp (Deep Purple)** — for hovers, tints, and surfaces:

| 50 | 100 | 200 | 300 | 400 | **500** | 600 | 700 | 800 |
|---|---|---|---|---|---|---|---|---|
| `#EDE7F6` | `#D1C4E9` | `#B39DDB` | `#9575CD` | `#7E57C2` | **`#673AB7`** | `#5E35B1` | `#512DA8` | `#4527A0` |

- Primary button rest `#673AB7`, hover `#5E35B1`, active `#512DA8`.
- Tinted backgrounds (selected rows, active-nav halo, info banners) `#EDE7F6`.

**Neutral ramp (Grey)** — text, borders, fills:

| 50 | 100 | 200 | 300 | **400** | 500 | 600 | 700 | 800 | **900** |
|---|---|---|---|---|---|---|---|---|---|
| `#FAFAFA` | `#F5F5F5` | `#EEEEEE` | `#E0E0E0` | `#BDBDBD` | `#9E9E9E` | `#757575` | `#616161` | `#424242` | `#212121` |

- Page background `#FAFAFA`; card border `#EEEEEE`; divider `#E0E0E0`.
- Primary text `#212121`; secondary text `#616161`; tertiary/placeholder `#757575`.
- `#9E9E9E`/`#BDBDBD` for icons-at-rest, disabled, and 1px lines only.

**Semantic colours** — reserved for meaning, mapped to the reference's chart accents:

| Meaning | Main | On-surface text | Tint bg | Used for |
|---|---|---|---|---|
| Success / positive | `#2E7D32` | `#1B5E20` | `#E8F5E9` | positive deltas, in-stock, completed sale |
| Warning / low | `#F57C00` | `#E65100` | `#FFF3E0` | **low stock**, expiring soon, negative-but-not-error deltas |
| Danger / critical | `#D32F2F` | `#B71C1C` | `#FFEBEE` | **out of stock**, oversell block, destructive actions, errors |
| Accent / tertiary | `#EC407A` | `#AD1457` | `#FCE4EC` | a fourth chart/sparkline series (e.g. the low-stock card) |

> The four sparkline colours in the reference (purple, green, orange, pink) map directly to
> **Primary / Success / Warning / Accent**.

### 2.3 Typography — Poppins

Weights in use: **Regular 400**, **Medium 500**, **Semi-Bold 600**. (No Light, no Bold.)
Money and metrics use `font-variant-numeric: tabular-nums` so columns align.

| Style | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|
| Display | 30 / 36 | 600 | −0.02em | KPI hero numbers (e.g. `GH₵ 218,450`) |
| H1 | 24 / 32 | 600 | −0.01em | Page title ("Performance Dashboard") |
| H2 | 20 / 28 | 600 | −0.01em | Card / section title ("Revenue Overview") |
| H3 | 16 / 24 | 600 | 0 | Sub-section, modal title |
| Body | 14 / 22 | 400 | 0 | Default text, table cells |
| Body-medium | 14 / 22 | 500 | 0 | Emphasised body, nav labels, buttons |
| Caption | 12 / 16 | 400/500 | 0 | Labels under metrics, deltas, helper text |
| Overline | 11 / 16 | 500 | 0.06em (uppercase) | Table headers, eyebrows, chip text |
| Numeric | inherits | 500 | 0, `tabular-nums` | Any GH₵ amount, quantities, counts |

Default body is **Body 14/22 Regular `#212121`**; secondary text **`#616161`**.

### 2.4 Spacing & grid

- **4px base unit.** Spacing scale: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`.
- **App content max-width** ~1280px, centred, with 24–32px gutters; the sell screen runs
  full-width.
- **Card padding:** 20–24px. **Gap between cards:** 16–24px.
- **KPI row:** 4 columns on desktop, equal width, 16–20px gaps (per the reference).
- **Vertical rhythm:** 24px between major sections, 32px below the page header.

### 2.5 Radius, borders & elevation

| Token | Value | Use |
|---|---|---|
| radius-sm | 8px | chips, inputs, small buttons |
| radius-md | 12px | buttons, the nav mark, dropdowns |
| radius-lg | 16px | cards, panels, modals |
| radius-pill | 999px | search field, filter pills, icon buttons, avatars |
| border-hairline | 1px `#EEEEEE` | card outlines, table rows |
| border-strong | 1px `#E0E0E0` | dividers, input borders |

Elevation is soft and sparing — borders do most of the work:

- **shadow-sm** (cards): `0 1px 2px rgba(33,33,33,.04), 0 1px 3px rgba(33,33,33,.06)`
- **shadow-md** (dropdowns, hovered cards): `0 4px 12px rgba(33,33,33,.08)`
- **shadow-lg** (modals, chart tooltip): `0 12px 32px rgba(33,33,33,.12)`

### 2.6 Iconography

- Line/outline icons, **1.5px stroke**, rounded caps & joins, 24px grid (20px in dense
  rows). Lucide is a good match for this house style.
- Rest colour `#757575`; active/selected white-on-purple or `#673AB7`.
- Every icon-only control has an accessible label and ≥40px hit area (≥44px on Sell).

### 2.7 Motion

| Interaction | Duration | Easing |
|---|---|---|
| Hover / colour / focus | 120–150ms | ease-out |
| Card hover lift (≤2px) | 150ms | ease-out |
| Dropdown / popover | 150ms | ease-out (fade + 4px rise) |
| Modal / drawer | 200ms | ease-out (fade + 8px / slide) |
| Toast | 200ms in, 150ms out | ease-out |
| Chart line draw-in | 400–600ms | ease-in-out (once, on load) |

Always honour `prefers-reduced-motion: reduce` — drop transforms and chart draw-in, keep
instant opacity changes.

---

## 3. Design tokens (Tailwind v4 + next/font)

The project is **Tailwind v4** (tokens live in `app/globals.css` via `@theme inline`) and
loads fonts with **`next/font`**. Two concrete changes wire this system in.

### 3.1 Load Poppins (replaces Geist) — `app/layout.tsx`

```ts
import { Poppins } from "next/font/google";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600"], // Regular, Medium, Semi-Bold
  display: "swap",
});
// apply `${poppins.variable}` on <html>; remove the Geist imports.
```

### 3.2 Theme tokens — `app/globals.css`

Replace the starter `:root`/`@theme` block. Drop the `prefers-color-scheme: dark` block —
this app is **light-only** (a counter tool in a shop); revisit dark mode post-v1 if asked.

```css
@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-poppins);

  /* brand */
  --color-ink: #212121;
  --color-surface: #ffffff;
  --color-primary: #673ab7;
  --color-primary-hover: #5e35b1;
  --color-primary-active: #512da8;
  --color-primary-tint: #ede7f6;

  /* neutrals */
  --color-bg: #fafafa;
  --color-muted: #616161;      /* secondary text — AA on white */
  --color-faint: #757575;      /* placeholder / tertiary */
  --color-line: #eeeeee;       /* hairline border */
  --color-line-strong: #e0e0e0;
  --color-disabled: #bdbdbd;   /* borders / disabled only — never text */

  /* semantic */
  --color-success: #2e7d32; --color-success-tint: #e8f5e9;
  --color-warning: #f57c00; --color-warning-tint: #fff3e0;
  --color-danger:  #d32f2f; --color-danger-tint:  #ffebee;
  --color-accent:  #ec407a; --color-accent-tint:  #fce4ec;

  /* radius */
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-pill: 999px;
}

:root { --background: var(--color-bg); --foreground: var(--color-ink); }

body {
  background: var(--color-bg);
  color: var(--color-ink);
  font-family: var(--font-sans), system-ui, sans-serif;
}

/* money & metrics align in columns */
.tnum { font-variant-numeric: tabular-nums; }
```

> Tailwind v4 derives utilities from these tokens (`bg-primary`, `text-muted`,
> `border-line`, `rounded-lg`, …). Keep all colour/spacing/radius decisions in this token
> block — components reference tokens, never raw hex.

---

## 4. Core components

### 4.1 App shell

Three regions, matching the reference:

- **Sidebar (icon rail, ~72px).** Mark at top; vertical nav of icon buttons; account at
  bottom. Active item = white icon on a `#673AB7` rounded-square (radius-md) with a soft
  halo; rest = `#757575` line icon. Tooltip on hover with the label. On `lg`+ it may expand
  to a 240px labelled rail; below `md` it collapses to a bottom tab bar (Cashier) or a
  drawer (Owner). **Nav is role-aware — see §7.**
- **Top bar.** Left: page **title** (H1) + one-line **subtitle** (`#616161`), exactly as the
  reference. **Shop context switcher** (Owner only): a pill dropdown — `All shops ⌄` on the
  dashboard, or a specific `Shop name ⌄` — that scopes the dashboard, inventory, and sell
  views; selling requires a single Shop selected. A Cashier sees a non-interactive **Shop
  name** label here instead (their fixed Shop), not a switcher. Right: global **search**
  (pill), **notifications** bell (Owner — low/expiring alerts, dot when unread), **account
  avatar** (purple ring, opens menu: name, role chip, Shop, Sign out).
- **Content.** `#FAFAFA` page; cards/panels in white. 24–32px padding; sections at 24px
  rhythm.

### 4.2 Buttons

| Variant | Look | Use |
|---|---|---|
| Primary | `#673AB7` bg, white text, radius-md, 40px h | Complete sale, Save, Send invitation |
| Secondary | white bg, `#E0E0E0` border, ink text | Cancel, secondary actions |
| Subtle/ghost | transparent, ink text, tint hover | toolbar actions, table row actions |
| Destructive | `#D32F2F` text/border; solid red only on confirm | Cancel invitation, delete draft |
| Icon button | pill, 40px (44px on Sell), `#757575` icon | search, qty steppers, close |

States: hover (darken/tint), focus (§8 ring), disabled (`#BDBDBD` text on `#F5F5F5`, no
shadow), loading (spinner + label, control stays sized to avoid layout shift).

### 4.3 Inputs & forms

- Text/number field: white, 1px `#E0E0E0`, radius-sm, 40px h, 12px x-padding; label above in
  Body-medium; helper/error below in Caption. Focus → 1px `#673AB7` + focus ring.
- Error state: `#D32F2F` border + message; never colour-only (include text/icon).
- Select / dropdown: pill or radius-md trigger with chevron, matching the reference's
  `06 ⌄` / `Month ⌄` controls; menu uses shadow-md, selected row tinted `#EDE7F6`.
- Number stepper (quantities): `[ − ] value [ + ]`, tabular value, clamps to available stock.
- Segmented control / filter pills: row of pills; selected = `#673AB7` text on `#EDE7F6`
  (or solid purple for a hard toggle), rest = `#616161` on white with hairline border.

### 4.4 Cards

- **Content card:** white, radius-lg, 1px `#EEEEEE`, shadow-sm, 20–24px padding. Optional
  header row (H2 title + actions/legend on the right).
- **KPI / metric card** (the reference's hero pattern): label (Caption `#616161`) → big
  number (Display, tabular) → **delta chip** (`+12.4%` success / `−6.1%` warning, with
  ▲/▼) + context ("from last month") → **mini sparkline** bottom-right. One accent per card
  (purple / green / orange / pink). See §7 for which KPIs each role gets.

### 4.5 Tables (inventory, sales, ledger)

- Header row: Overline `#757575`, hairline bottom border, sticky on scroll.
- Rows: 48–56px, hairline separators, hover `#FAFAFA`, selected `#EDE7F6`.
- Numeric columns right-aligned, tabular; money in GH₵.
- Row actions: trailing ghost icon buttons or a `⋯` menu (Edit · Restock · Correction ·
  History for inventory).
- Each table defines **loading** (skeleton rows), **empty** (icon + message + primary CTA),
  and **error** (inline retry) states. On small screens, collapse to stacked row-cards.

### 4.6 Status & label chips

Small radius-pill chips, tint bg + on-surface text, optional 12px leading icon:

| Chip | Colour | Where |
|---|---|---|
| In stock | success tint | inventory, item detail |
| Low stock | warning tint | inventory, dashboard, item detail |
| Out of stock | danger tint | inventory, sell (disables add) |
| Expiring soon | accent or warning tint | cosmetics only |
| Expired | danger tint | cosmetics only |
| Wig / Cosmetic / Wig Tool | neutral (`#EEEEEE`/`#616161`) | category marker |
| Not carried (this Shop) | neutral, outline | inventory per-Shop view (vs out-of-stock) |
| Owner | primary tint | staff list, account menu |
| Cashier | neutral | staff list |
| Sale / Restock / Correction | neutral / success / warning | stock-movement ledger |
| Cash · MoMo · Card · Transfer | neutral chips w/ icon | sale & receipt payment rows |
| Delta `+%` / `−%` | success / warning text + ▲▼ | KPI cards |

### 4.7 Overlays

- **Modal** (focused tasks: Restock, Correction, Invite, confirmations): centred, radius-lg,
  shadow-lg, max-width ~480px, scrim `rgba(33,33,33,.4)`, title (H3) + body + action row
  (primary right). Focus-trapped; Esc closes; primary action on Enter where safe.
- **Drawer / side sheet** (longer forms: Add/Edit Item, item history): right-side, 420–520px,
  same chrome as modal, scrolls internally with a sticky footer action bar.
- **Toast:** bottom-right, radius-md, shadow-md, 1 line + optional action; success/danger
  variants; auto-dismiss ~4s. Used for "Sale completed", "Invitation sent", "Stock updated".
- **Confirmation dialog:** for irreversible/sensitive actions (cancel invitation, complete
  sale). State the consequence in plain language.

### 4.8 Empty / loading / error states

Every list and data view ships all three: **loading** (skeletons, never spinners-on-blank),
**empty** (centred icon, one-line explanation, primary CTA — e.g. "No items yet — Add your
first item"), **error** (calm message + Retry; never a raw stack trace).

---

## 5. Data visualization

Faithful to the reference's "Revenue Overview" chart and KPI sparklines.

- **Area / line chart:** single smooth (monotone) line in `#673AB7`, 2px, over a vertical
  gradient fill from `rgba(103,58,183,.18)` → transparent. Dashed horizontal gridlines in
  `#EEEEEE`; no vertical gridlines; no chart border. Y-axis labels in Caption `#757575`
  (e.g. `1k · 10k · 50k · 100k · 150k`); x-axis month/day labels.
- **Tooltip:** floating white card, radius-lg, shadow-lg, ~140px: period label (`#616161`),
  big value (Display, purple), one-line context. Active point = filled purple dot with a
  white ring, plus a faint vertical guide. (Mirrors the "May / GH₵ 205,600" tooltip.)
- **Sparklines (KPI cards):** ~64×28px, no axes/labels, smooth line + soft gradient, coloured
  per the card's accent (purple/green/orange/pink).
- **Payment-mix breakdown** (Owner): horizontal stacked bar or compact donut, one segment per
  method (Cash/MoMo/Card/Transfer) using neutral + accent shades, with a labelled legend and
  GH₵ amounts. Avoid relying on colour alone — always label segments.
- Series colour order: **Primary → Success → Warning → Accent**. Keep charts to a single
  series where possible; this is a small shop, not an analytics suite.
- Provide a **table fallback / accessible summary** for each chart (screen-reader text of the
  key figures).

---

## 6. Money & numbers (GH₵)

- **Currency is Ghana Cedi**, displayed `GH₵ 1,234.56` (symbol, thin space, grouped
  thousands, 2 decimals). Single currency — no currency picker.
- Money is stored and computed as **integer pesewas** (PRD: integer minor units, no float
  drift); format to GH₵ **only at the edge** via the **Money module** — components never do
  their own arithmetic or rounding.
- All amounts, quantities, counts, and deltas use **`tabular-nums`** and right-align in
  tables and totals so columns line up.
- Negative/refund-style values don't exist in v1 (no returns); a negative **delta** on a KPI
  is a trend indicator, not money owed.
- **No tax/VAT line** anywhere (PRD non-goal) — prices are final.

---

## 7. Role-aware UI (Owner vs Cashier)

Two roles (`owner` | `cashier`, from `profiles`). The Owner can do everything a Cashier can,
plus inventory, staff, settings, and **Shop management**. **Cost, margin/profit, and inventory
value are Owner-only — and per the PRD the dashboard payload itself omits these fields for a
Cashier; the UI hiding is the second layer, not the only one.**

**Shop scope is a second axis alongside role.** The Owner spans all Shops and chooses a **Shop
context** (top-bar switcher, §4.1) to sell or view one Shop; the dashboard additionally offers
an all-Shops rollup. A Cashier is locked to their one Shop — every list they see (sell
catalogue, sales, stock health) is their Shop's, enforced server-side (RLS), not just filtered
in the UI.

| Surface | Owner | Cashier |
|---|---|---|
| Sidebar nav | Dashboard · Sell · Inventory · Sales · **Shops** · Staff · Settings | Dashboard · Sell · Sales |
| Shop context switcher (top bar) | ✓ (All shops / pick one) | ✗ (shows own Shop name, fixed) |
| Dashboard | full, **defaulting to all Shops** (revenue, **profit/margin**, **inventory value**, payment mix, trend, **revenue-by-Shop**, low/out/expiring lists, recent sales); drill into one Shop | trimmed to **their Shop**: today's sales (count + revenue) + stock health (low / out / expiring). **No** cost, margin, or value |
| Sell (POS) | ✓ (must select a Shop context first) | ✓ (their Shop) |
| Inventory list & item editor | ✓ (catalog business-wide; stock per Shop) | ✗ (hidden from nav; route blocked) |
| Stock movements (Restock / Correction) | ✓ (at a chosen Shop) | ✗ |
| Cost / selling-price-cost / margin fields | visible | **never rendered** |
| Shops (open / edit) | ✓ | ✗ |
| Staff & invitations (invite into a Shop, reassign) | ✓ | ✗ |
| Settings (threshold, expiry window — business-wide) | ✓ | ✗ |

A Cashier who reaches an Owner-only route, or any data outside their Shop, sees the
**Not-authorized** state (§10.12), not a broken page. Item rows on the Sell screen show
**selling price + available quantity (at this Shop) only** — never cost.

---

## 8. Accessibility

- **Target WCAG 2.1 AA.** Verified contrast on white: `#212121` 16:1 ✓, `#673AB7` **7.3:1 ✓**
  (so purple text and white-on-purple buttons both pass), `#616161` 6.2:1 ✓, `#757575` 4.6:1
  ✓ (minimum for secondary). **`#BDBDBD` is ~1.9:1 — fails for text; use it only for borders,
  dividers, and disabled states.** This is why secondary text is `#616161`, not the brand
  grey.
- **Never colour-only.** Stock status, deltas, payment methods, and form errors always carry
  an icon and/or text label as well as colour.
- **Focus visible:** 2px `#673AB7` ring at 2px offset on every interactive element; never
  remove outlines without an equivalent.
- **Keyboard:** full operability. The Sell screen is keyboard-first — focus the item search
  on load, arrow/Enter to add, steppers reachable, `Complete sale` reachable without a mouse.
  Modals trap focus and restore it on close.
- **Touch:** ≥44px targets on Sell (counter use, possibly a tablet); ≥40px elsewhere.
- **Semantics:** real headings, labelled inputs, `aria-live` for cart totals / change-due and
  for toasts, table headers associated with cells. OTP input announces digit position.
- **Reduced motion:** honour `prefers-reduced-motion` (§2.7).

---

## 9. Responsive behaviour

Desktop-first for Owner admin; the Sell screen must also work on a **tablet** at the counter.

| Breakpoint | Layout |
|---|---|
| `< 640` (sm) | single column; KPI cards stack 1-up; sidebar → bottom tab bar; tables → stacked row-cards; Sell becomes cart-first with a full-screen item picker |
| `640–1024` (md) | KPI cards 2-up; icon-rail sidebar; Sell is two-pane (catalogue + cart) on landscape tablet |
| `≥ 1024` (lg) | KPI cards 4-up (reference layout); optional expanded labelled sidebar; charts at full width |
| content max | ~1280px centred; Sell runs full-width |

Charts reflow and keep ≥240px height; tooltips stay within viewport. Test the Sell two-pane
at a 1024×768 tablet landscape.

---

## 10. Pages & screens

Routing follows the PRD's "App Router UI routes (login+OTP, dashboard, sell, inventory,
Owner-only invite & item editor)" and the existing `route-access` rules
(`PUBLIC_PATHS = {/login}`, `APP_HOME = /dashboard`). Routes below are proposed; confirm
exact paths in implementation.

### 10.0 App shell & navigation (wraps all authenticated pages)
Sidebar + top bar from §4.1, role-aware nav from §7. Every authenticated page renders inside
it; `/login` and the invitation sign-up render standalone (centred, no shell).

### 10.1 Login — password → emailed code  · `/login` · public
Drives the existing `loginReducer` state machine (`password` → `code` → `authenticated`).

- **Layout:** centred card (max ~400px) on `#FAFAFA`, mark + wordmark above.
- **Step `password`:** email + password fields, primary **Sign in**. On reject, inline error
  "Incorrect email or password." (from the reducer).
- **Step `code`:** notice "We emailed you a one-time code…", a 6-digit OTP input (one box per
  digit, auto-advance/paste), primary **Verify**, and a **Resend code** link with a cooldown.
  `code_rejected` → error "That code is invalid or expired…"; `code_resent` → notice "We sent
  a fresh code…". Show the masked email being verified; offer "Use a different account".
- **States:** submitting (button spinner), rate-limit/error notice. No "remember me" / social
  login (out of scope). Ties to stories 3, 4.

### 10.2 Invitation sign-up  · `/invite/[token]` (or `/signup?token=`) · token-gated
From the Owner's emailed invitation. Validates the token, shows the invited email
(read-only) **and the Shop the Cashier is joining**, lets the Cashier set a password, then
drops them into the OTP step (§10.1) to finish. Invalid/expired/used token → clear
explanation + "ask the Owner for a new invite". Ties to stories 1, 2.

### 10.3 Dashboard  · `/dashboard` · Owner & Cashier (role-shaped)
**This is the screen the reference depicts.** Header "Dashboard"; subtitle reflects the
**Shop scope** ("All shops · today at a glance" or "Shop name · today"). The Owner's top-bar
**Shop switcher** (§4.1) drives this scope; a Cashier's is fixed to their Shop.

- **Owner view** — defaults to **all Shops combined**, with the switcher narrowing to one Shop:
  - **KPI row (4):** *Today's Revenue* (purple spark), *Gross Profit / Margin* (green) —
    Owner-only, *Inventory Value* (purple/neutral) — Owner-only, *Low-stock Products* (pink,
    count like the reference's "18 Products"). Each with delta vs prior period. Figures are
    summed across Shops (all-Shops scope) or for the selected Shop.
  - **Revenue Overview** card: the area chart (§5) with period selectors (`Month ⌄`, range)
    and "Last 6 Months" legend — exactly the reference treatment, money in GH₵.
  - **Revenue by Shop** card (all-Shops scope only): a bar/column comparison of revenue per Shop
    (series order per §5), so the Owner sees which Shops perform (story 45). Hidden when one
    Shop is selected.
  - **Payment mix** card: breakdown by Cash / MoMo / Card / Transfer (story 33), within scope.
  - **Stock health:** Low-stock, Out-of-stock, and Expiring-soon lists (compact tables with
    "view all" → Inventory filtered). In all-Shops scope each row notes the Shop.
  - **Recent sales** feed: time, **Shop**, cashier, items, total, payment methods (story 38).
- **Cashier view (trimmed):** scoped to **their Shop**. KPI row limited to *Today's Sales
  (count)* and *Today's Revenue*, plus a **Stock health** summary (low / out / expiring counts
  + lists). **No** profit, margin, inventory value, payment-mix-by-cost, or other Shops.
  (Stories 31–39, 47; redaction per §7.)
- **States:** skeleton KPIs/chart on load; empty ("No sales yet today"); error with retry.

### 10.4 Sell — ring up a sale (POS)  · `/sell` · Owner & Cashier
The most-used screen; not in the reference, so built in the same language. **Two-pane.**
Scoped to one **Shop**: a Cashier's own Shop, or the Owner's selected Shop context. If the
Owner lands here on "All shops", prompt them to **pick a Shop** before selling (the catalogue
is empty until one is chosen) — a sale must belong to exactly one Shop.

- **Left (catalogue):** sticky **search by name** + **category filter pills** (All / Wigs /
  Cosmetics / Wig Tools). Shows only the Items **this Shop carries** (has a Shop-stock row).
  Results as a grid/list of item cards: name (+ shade/product/tool type), **selling price
  (GH₵)**, **available-qty at this Shop** badge, and an **Add** affordance. Out-of-stock
  (carried, qty 0) items show the red chip and disable Add (no overselling); Items the Shop
  doesn't carry simply don't appear. **No cost shown — ever.** (Stories 6, 7, 9, 10.)
- **Right (current sale):** line-item rows (name, unit price, **qty stepper** clamped to
  available, line total), a prominent **running grand total** (Display, GH₵, live `aria-live`)
  that updates as items change (story 8), and an optional **customer name** field (story 15).
- **Payment section:** method chips **Cash · MoMo · Card · Transfer**; support **split** across
  methods with per-method amounts and a live **remaining / over** indicator that must reach
  exactly the total before completion (stories 11–13). For Cash, a **tendered** field shows
  **change due** (story 14).
- **Complete sale:** primary button, enabled only when payments sum to total and no line
  exceeds **this Shop's** stock. On success: the Shop's stock decrements, the sale is recorded
  immutably **against this Shop**, and the **Receipt** (§10.5) appears. Server is the final
  authority on no-oversell, item-carried-by-Shop, and payment-sum (PRD behavioural contract) —
  surface its rejection inline if it fires.
- **States:** empty cart ("Search to add items"), oversell attempt (clamp + warning),
  payment-mismatch (block + helper), completing (lock UI, spinner), failure (toast + keep
  cart). Optimised for keyboard and touch (§8, §9).

### 10.5 Receipt  · `/sell/receipt/[saleId]` or print modal · per-sale, read-only
On-screen, **print-optimised** rendering of a completed Sale (a receipt is a *rendering* of a
Sale, never editable — CONTEXT.md).

- Mark + wordmark + **the selling Shop's name, address, and phone**; date/time; seller
  (cashier or Owner); optional customer name.
- Line items (name, qty, unit price, line total); **grand total (GH₵)**; **payments** by
  method; **change due** for cash; "Thank you" footer.
- **Print** button with a dedicated print stylesheet (hide app chrome, black-on-white, narrow
  receipt width). No edit/void/refund actions (immutability + no-returns are v1 contracts).
  Story 17, 18.

### 10.6 Inventory list  · `/inventory` · Owner-only
Catalog is business-wide; **stock is per Shop**, so the list respects the top-bar **Shop
context**: "All shops" shows the catalog with stock summed/spanned; a selected Shop shows that
Shop's carried Items and quantities.

- Toolbar: **Shop context** (from top bar), **search by name**, **category filter** (Wig /
  Cosmetic / Wig Tool), quick filters **Low stock** / **Expiring soon** (stories 19, 20), and
  a primary **Add item** split-button → *Add wig* / *Add cosmetic line* / *Add wig tool*.
- Table: Item (name + shade/product grouping or tool type), **Category** chip, attributes
  summary, **Cost** (Owner-only column), **Selling price**, **Qty** (per the Shop scope —
  per-Shop, or per-Shop breakdown / total in all-Shops), **Status** chip (in/low/out/expiring,
  or **not-carried** for a selected Shop that lacks the Item), and row actions **Edit ·
  Stock at Shop ·** (when a Shop is selected) **Restock · Correction · History**. In all-Shops
  scope, **Restock/Correction** ask which Shop first. Right-aligned tabular money/qty.
- States: empty ("No items yet — add your first"), filtered-empty, **a new Shop's empty
  carried-list** ("This shop carries nothing yet — restock an item to start"), loading
  skeleton. Cosmetics surface expiry; wigs and wig tools don't.

### 10.7 Item editor — add / edit  · `/inventory/items/new`, `/inventory/items/[id]/edit` (drawer) · Owner-only
Per ADR-0002, one Item model; the **per-Category difference lives only in this form**. This
form edits the **business-wide catalog** (name, category, attributes, cost, price) — it is
*not* where per-Shop stock lives. Stock starts when the Owner restocks the Item **at a Shop**
(§10.8): the starting-quantity field below writes the opening stock movement **for the Shop in
the current context** (and, on "All shops", asks which Shop).

- **Common fields:** category, name, **cost**, **selling price** (Owner-only context, business-
  wide), and an optional **starting quantity at \<Shop\>** (writes that Shop's opening movement;
  the first one makes the Shop carry the Item — §10.8 / ADR-0004/0005).
- **Wig:** stands alone (no Product). Attributes: length, texture, lace type, density, origin.
  (Story 21, 23.)
- **Cosmetic line:** create/choose a **Product** (name/brand) and add **one or more shade
  Items** in a repeatable rows builder — each shade with shade name, size, **expiry**, cost,
  price, and optional starting qty at the Shop (stories 22, 24). Price lives on each Item,
  never the Product; stock lives on Shop stock (CONTEXT.md / ADR-0005).
- **Wig Tool:** stands alone (no Product, no expiry). Attributes: **tool type** (brush, comb,
  wig stand, cap/net, clip/pin, adhesive, scissors, spray, …) and **brand** (story 22a).
- **Edit:** same form pre-filled (story 25). Validation is category-specific (attributes are
  schemaless at the DB level per ADR-0002 — validate in the form). No image upload (non-goal).
- Presented as a right **drawer** (§4.7) over the inventory list; sticky footer Save / Cancel.

### 10.8 Item detail & stock-movement history  · `/inventory/items/[id]` · Owner-only
- Header: item summary (name, category, attributes, selling price, cost; cosmetic expiry) plus
  a **per-Shop stock breakdown** — each Shop carrying the Item with its quantity and status,
  and a clear "not carried" for Shops without a row. Actions: **Record Restock**, **Record
  Correction** (each asks/uses a Shop), **Edit**.
- **Movement ledger** table (ADR-0004/0005, source of truth): a **Shop filter**, then date/
  time, **Shop**, **reason** chip (Sale / Restock / Correction), **signed amount**, **actor**,
  running balance **for that Shop**, and a link to the Sale for sale movements. Append-only —
  no edit/delete (story 28).
- **Restock** modal: **Shop** + quantity in + optional note → adds a Restock movement at that
  Shop; the first Restock makes the Shop carry the Item (story 26).
- **Correction** modal: **Shop** + signed quantity (up or down) + reason → adds a Correction
  movement at that Shop (story 27). Both update that Shop stock's denormalised `quantity` in
  the same transaction (ADR-0004/0005); Cashiers can't reach this (story 29).

### 10.9 Staff & invitations  · `/staff` · Owner-only
- **Invite** form: email + **Shop** (which Shop the Cashier joins) → **Send invitation**
  (story 1); success toast; pending invitations list with their target Shop and **Resend** /
  **Cancel**.
- **People** table: Owner + Cashiers with **role** chip, **Shop** column, and status (Active /
  Invited–pending). Row action **Reassign Shop** (story 46) — a small modal picking a new Shop;
  past Sales keep their original Shop. Per the PRD's triage note, **revoke/deactivate** is
  *unconfirmed* — design the row action as a placeholder ("Deactivate") but gate it behind the
  triage decision; don't ship it as final until confirmed.

### 10.10 Shops  · `/shops` · Owner-only
Manage the business's Shops (ADR-0005). The Owner can **open** Shops but not retire them in v1.

- **Shops** table: name, address, phone, staff count, and a small stat (today's revenue);
  row action **Edit**. Primary **Add shop** button.
- **Add / Edit Shop** drawer/modal: **name** (required), **address** and **phone** (optional,
  shown on receipts — §10.5). Save → toast; a new Shop starts carrying no Items (stock it via
  Inventory §10.6/§10.8). No close/deactivate action in v1 (non-goal).
- States: empty is unlikely (the business has at least one Shop), but handle a single-Shop
  business gracefully (the top-bar switcher may collapse to a label when only one Shop exists).

### 10.11 Settings  · `/settings` · Owner-only
**Business-wide** settings (`shop_settings`, single row): **low-stock threshold** (one number
applied to every Shop stock, story 30), **expiry-warning window** (days for "expiring soon"),
and **currency** shown as **GH₵** (display-only, single-currency). Simple form, Save → toast.
Deliberately **not per-Shop** (ADR-0005); no tax config (non-goal).

### 10.12 System states
- **Not authorized:** a Cashier hitting an Owner-only route, **or any data outside their
  Shop** — friendly card ("This area is for the Owner") + button back to Dashboard. Not a 403
  dump.
- **404 / not found**, **global error boundary** (calm message + retry/home), **connection
  lost** banner (the app is **online-only** per the PRD — warn clearly at the counter if
  connectivity drops, and block sale completion until restored), and a top-level **loading**
  state.

---

## 11. Page → story → route map

| Screen | Route (proposed) | Roles | PRD stories |
|---|---|---|---|
| Login (password → OTP) | `/login` | public | 3, 4 |
| Invitation sign-up | `/invite/[token]` | invited | 1, 2 |
| Dashboard (all-Shops / per-Shop) | `/dashboard` | Owner / Cashier | 31–47 |
| Sell (POS, Shop-scoped) | `/sell` | Owner / Cashier | 6–16, 43 |
| Receipt | `/sell/receipt/[id]` | Owner / Cashier | 17, 18 |
| Inventory list (per Shop) | `/inventory` | Owner | 19, 20 |
| Item editor (wig / cosmetic / wig tool) | `/inventory/items/new` · `…/[id]/edit` | Owner | 21–25, 22a |
| Item detail & movement history (per Shop) | `/inventory/items/[id]` | Owner | 26–29 |
| Shops (open / edit) | `/shops` | Owner | 42 |
| Staff & invitations (invite into Shop, reassign) | `/staff` | Owner | 1, 5, 46 |
| Settings (business-wide) | `/settings` | Owner | 30 |
| Not-authorized / errors | — | all | (visibility & Shop-scope contract) |

---

## 12. Adapting the reference, and what NOT to build

**Adapt these from the reference image** (don't copy literally):

- Currency is **GH₵, not `$`** — every amount.
- The KPI labels in the image ("Total Revenue / Gross Profit / **Pending Receivables** / Low
  Stock Products") are illustrative. **There are no receivables in v1** (payment is recorded
  at sale; no credit). Use the role-appropriate KPIs in §10.3 — do **not** build a
  "Pending Receivables" tile.
- Keep the visual treatment (mark, sidebar active state, KPI-card-with-sparkline, area chart +
  tooltip, pill controls); repopulate with POS data.

**Do NOT design or build UI for these v1 non-goals** (PRD §Out of Scope / CONTEXT.md) — their
absence is intentional, so don't "helpfully" add them:

returns/refunds · discounts · barcodes/scanning · item photos/images · stored customer
records & loyalty · offline mode · tax/VAT lines · multi-currency ·
any payment **processing** (methods are *recorded* only — no gateway, no card entry).

Multi-**Shop** is now **in scope** (ADR-0005) — build the Shop switcher, per-Shop stock,
Shops screen, and all-Shops dashboard. But still do **NOT** build: **per-Shop pricing/cost**
(price & cost are business-wide), **per-Shop settings** (threshold/expiry/currency are
business-wide), a **per-Shop manager role** (only Owner & Cashier), or **closing/deactivating
a Shop** (open-only in v1).

> **Open questions to resolve at triage** (carried from the PRD, may affect §10.9 / §10.6):
> staff **revoke/deactivation**, and Item **archiving/discontinuation**. Designed as
> placeholders above; finalise once triage decides.
</content>
</invoke>
