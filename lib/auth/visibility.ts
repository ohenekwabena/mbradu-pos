/**
 * Visibility policy — the application-layer mirror of the database's row-level
 * security (role × Shop) and the Owner-only RPCs. The database is the *hard*
 * boundary (RLS + the `items_catalog` cost-masking view + SECURITY DEFINER
 * RPCs); this module lets the UI and Server Actions make the *same* decision
 * early — to gate buttons/links, reject a forbidden action before a round-trip,
 * and strip Owner-only money fields from anything bound for a Cashier.
 *
 * Two halves:
 *   - {@link can}/{@link assertCan} — may this actor take this action (at this
 *     Shop)? Owner spans all Shops; a Cashier is confined to their one Shop and
 *     barred from every Owner-only write.
 *   - {@link redactForActor} — remove cost / margin / inventory-value fields
 *     from a Cashier-bound payload (the fields are *absent*, never nulled).
 *
 * See ADR-0005 (Shop-scoped multi-tenancy) and CONTEXT.md (Owner vs Cashier,
 * Visibility). MP-15.
 */

export type Role = "owner" | "cashier";

/**
 * The acting user, as far as authorization cares. Structurally compatible with
 * `CurrentProfile` from {@link "@/lib/dal"}, so a loaded profile can be passed
 * straight in. A Cashier always has a `shopId`; the Owner's is `null`
 * (they have no home Shop and pick a Shop context instead).
 */
export interface Actor {
  role: Role;
  shopId: string | null;
}

/**
 * Every guarded action in v1. Grouped by area; the suffix says read vs write.
 * Kept deliberately explicit (no wildcards) so the policy table below is an
 * exhaustive, reviewable mirror of the SQL policies.
 */
export type Action =
  // Catalog — business-wide. Everyone reads (cost masked); only the Owner writes.
  | "catalog:read"
  | "catalog:write"
  | "item:archive" // archive/discontinue or restore an Item — Owner-only (MP-31)
  // Shops — only the Owner opens or edits a Shop.
  | "shop:create"
  | "shop:manage"
  // Inventory & stock — read is Shop-scoped; every write is Owner-only.
  | "inventory:read"
  | "stock:read"
  | "stock:restock"
  | "stock:correct"
  // Sales — read and sell are Shop-scoped (Owner spans all Shops).
  | "sale:read"
  | "sale:create"
  // Staff — only the Owner invites, reassigns, resets, or manages Cashiers.
  | "staff:read"
  | "staff:invite"
  | "staff:reassign"
  | "staff:reset" // trigger a Cashier's password reset (they can't self-serve)
  // Settings — only the Owner edits the business-wide settings row.
  | "settings:read"
  | "settings:write"
  // Money visibility & dashboards.
  | "cost:view" // see cost / margin / profit / inventory value (Owner-only)
  | "dashboard:view" // a dashboard scoped to the actor (both roles)
  | "dashboard:all-shops"; // the cross-Shop rollup & revenue comparison (Owner-only)

interface Rule {
  /** Denied to a Cashier outright (an Owner-only capability). */
  ownerOnly: boolean;
  /**
   * Concerns a specific Shop. For a Cashier the target Shop must be their own
   * (an omitted target means "their own Shop"); the Owner spans all Shops.
   */
  shopScoped: boolean;
}

/**
 * The policy table — one row per {@link Action}, mirroring the migrations:
 * Owner-only writes (catalog/shops/stock/staff/settings) and the cost view sit
 * `ownerOnly: true`; Shop-scoped reads and selling sit `shopScoped: true`.
 */
const POLICY: Record<Action, Rule> = {
  "catalog:read": { ownerOnly: false, shopScoped: false },
  "catalog:write": { ownerOnly: true, shopScoped: false },
  "item:archive": { ownerOnly: true, shopScoped: false },

  "shop:create": { ownerOnly: true, shopScoped: false },
  "shop:manage": { ownerOnly: true, shopScoped: false },

  "inventory:read": { ownerOnly: false, shopScoped: true },
  "stock:read": { ownerOnly: false, shopScoped: true },
  "stock:restock": { ownerOnly: true, shopScoped: true },
  "stock:correct": { ownerOnly: true, shopScoped: true },

  "sale:read": { ownerOnly: false, shopScoped: true },
  "sale:create": { ownerOnly: false, shopScoped: true },

  "staff:read": { ownerOnly: true, shopScoped: false },
  "staff:invite": { ownerOnly: true, shopScoped: false },
  "staff:reassign": { ownerOnly: true, shopScoped: false },
  "staff:reset": { ownerOnly: true, shopScoped: false },

  "settings:read": { ownerOnly: false, shopScoped: false },
  "settings:write": { ownerOnly: true, shopScoped: false },

  "cost:view": { ownerOnly: true, shopScoped: false },
  "dashboard:view": { ownerOnly: false, shopScoped: false },
  "dashboard:all-shops": { ownerOnly: true, shopScoped: false },
};

/**
 * May `actor` take `action`? For Shop-scoped actions, `shop` is the Shop the
 * action concerns:
 *   - Owner → always allowed (spans all Shops); `shop` is irrelevant.
 *   - Cashier → denied for any Owner-only action; for a Shop-scoped action,
 *     allowed only when `shop` is their own Shop (omitting `shop` means "my
 *     own Shop"). Never allowed to act on another Shop.
 *
 * Unknown actions are denied (fail closed).
 */
export function can(actor: Actor, action: Action, shop?: string): boolean {
  const rule = POLICY[action];
  if (!rule) return false; // unknown action → fail closed

  // The Owner can do everything defined, in or across any Shop.
  if (actor.role === "owner") return true;

  // Cashier: no Owner-only capability.
  if (rule.ownerOnly) return false;

  // Cashier on a Shop-scoped action: confined to their own Shop.
  if (rule.shopScoped) {
    if (!actor.shopId) return false; // a Cashier must have a Shop (defensive)
    if (shop === undefined) return true; // implicitly their own Shop
    return shop === actor.shopId;
  }

  // Shared, non-Shop-scoped action (e.g. read the catalog, view own dashboard).
  return true;
}

/** Thrown by {@link assertCan} when an actor is not permitted to act. */
export class NotAuthorizedError extends Error {
  constructor(action: Action, shop?: string) {
    super(
      shop
        ? `Not authorized to ${action} at shop ${shop}`
        : `Not authorized to ${action}`,
    );
    this.name = "NotAuthorizedError";
  }
}

/**
 * {@link can} as a guard: returns normally when allowed, throws
 * {@link NotAuthorizedError} when not. For early rejection at the top of a
 * Server Action before any database work.
 */
export function assertCan(actor: Actor, action: Action, shop?: string): void {
  if (!can(actor, action, shop)) {
    throw new NotAuthorizedError(action, shop);
  }
}

// ---------------------------------------------------------------------------
// Redaction — strip Owner-only money fields from a Cashier-bound payload.
// ---------------------------------------------------------------------------

/**
 * Canonical, normalized names of the fields a Cashier must never see: cost and
 * everything derived from it (margin, profit, inventory value). Comparison is
 * on the *normalized* key (lower-cased, non-alphanumerics removed), so every
 * spelling is caught — `cost_pesewas`, `costPesewas`, `marginPesewas`,
 * `inventory_value`, … all collapse onto an entry here.
 */
const REDACTED_KEYS: ReadonlySet<string> = new Set([
  "cost",
  "costpesewas",
  "margin",
  "marginpesewas",
  "profit",
  "profitpesewas",
  "inventoryvalue",
  "inventoryvaluepesewas",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Is `key` an Owner-only money field (in any snake/camel spelling)? */
export function isSensitiveField(key: string): boolean {
  return REDACTED_KEYS.has(normalizeKey(key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function strip<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => strip(entry)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (isSensitiveField(key)) continue; // omit entirely — absent, not nulled
      out[key] = strip(val);
    }
    return out as T;
  }
  return value;
}

/**
 * Return `payload` with cost/margin/profit/inventory-value fields removed when
 * the actor is a Cashier; unchanged for the Owner. Recurses through arrays and
 * plain objects (so a list of Items, or a nested shape, is fully cleaned).
 * Removed fields are **absent** from the result, never set to `null`.
 *
 * This is defence-in-depth for the UI/serialization layer — the database's
 * `items_catalog` view is what actually withholds cost from a Cashier.
 */
export function redactForActor<T>(actor: Actor, payload: T): T {
  if (actor.role === "owner") return payload;
  return strip(payload);
}
