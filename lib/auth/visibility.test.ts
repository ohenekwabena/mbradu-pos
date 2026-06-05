import { describe, it, expect } from "vitest";

import {
  type Action,
  type Actor,
  assertCan,
  can,
  isSensitiveField,
  NotAuthorizedError,
  redactForActor,
} from "./visibility";

const owner: Actor = { role: "owner", shopId: null };
const eastLegon: Actor = { role: "cashier", shopId: "shop-east-legon" };
const OTHER_SHOP = "shop-osu";

describe("can — the Owner spans everything", () => {
  const everyAction: Action[] = [
    "catalog:read",
    "catalog:write",
    "shop:create",
    "shop:manage",
    "inventory:read",
    "stock:read",
    "stock:restock",
    "stock:correct",
    "sale:read",
    "sale:create",
    "staff:read",
    "staff:invite",
    "staff:reassign",
    "staff:reset",
    "staff:deactivate",
    "settings:read",
    "settings:write",
    "cost:view",
    "dashboard:view",
    "dashboard:all-shops",
  ];

  for (const action of everyAction) {
    it(`allows the Owner to ${action}`, () => {
      expect(can(owner, action)).toBe(true);
    });
  }

  it("allows the Owner to act on any specific Shop", () => {
    expect(can(owner, "sale:create", OTHER_SHOP)).toBe(true);
    expect(can(owner, "stock:restock", "shop-tema")).toBe(true);
  });
});

describe("can — Owner-only writes are denied to a Cashier", () => {
  const ownerOnly: Action[] = [
    "catalog:write",
    "shop:create",
    "shop:manage",
    "stock:restock",
    "stock:correct",
    "staff:read",
    "staff:invite",
    "staff:reassign",
    "staff:reset",
    "staff:deactivate",
    "settings:write",
    "cost:view",
    "dashboard:all-shops",
  ];

  for (const action of ownerOnly) {
    it(`denies a Cashier ${action}`, () => {
      expect(can(eastLegon, action)).toBe(false);
      // even when naming their own Shop, an Owner-only action stays denied
      expect(can(eastLegon, action, eastLegon.shopId!)).toBe(false);
    });
  }
});

describe("can — a Cashier is confined to their own Shop", () => {
  it("allows Shop-scoped reads/sells for their own Shop", () => {
    expect(can(eastLegon, "sale:create", "shop-east-legon")).toBe(true);
    expect(can(eastLegon, "sale:read", "shop-east-legon")).toBe(true);
    expect(can(eastLegon, "inventory:read", "shop-east-legon")).toBe(true);
    expect(can(eastLegon, "stock:read", "shop-east-legon")).toBe(true);
  });

  it("treats an omitted Shop as the Cashier's own Shop", () => {
    expect(can(eastLegon, "sale:create")).toBe(true);
    expect(can(eastLegon, "sale:read")).toBe(true);
  });

  it("denies a Cashier acting on another Shop", () => {
    expect(can(eastLegon, "sale:create", OTHER_SHOP)).toBe(false);
    expect(can(eastLegon, "sale:read", OTHER_SHOP)).toBe(false);
    expect(can(eastLegon, "inventory:read", OTHER_SHOP)).toBe(false);
    expect(can(eastLegon, "stock:read", OTHER_SHOP)).toBe(false);
  });

  it("allows a Cashier the shared, non-Shop-scoped reads", () => {
    expect(can(eastLegon, "catalog:read")).toBe(true);
    expect(can(eastLegon, "settings:read")).toBe(true);
    expect(can(eastLegon, "dashboard:view")).toBe(true);
  });

  it("defensively denies a Shop-scoped action when a Cashier has no Shop", () => {
    const unbound: Actor = { role: "cashier", shopId: null };
    expect(can(unbound, "sale:create", "shop-east-legon")).toBe(false);
    expect(can(unbound, "sale:create")).toBe(false);
  });
});

describe("can — unknown actions fail closed", () => {
  it("denies an action that is not in the policy", () => {
    expect(can(owner, "totally:made-up" as Action)).toBe(false);
    expect(can(eastLegon, "totally:made-up" as Action)).toBe(false);
  });
});

describe("assertCan", () => {
  it("returns silently when allowed", () => {
    expect(() => assertCan(owner, "catalog:write")).not.toThrow();
    expect(() => assertCan(eastLegon, "sale:create", "shop-east-legon")).not.toThrow();
  });

  it("throws NotAuthorizedError when denied", () => {
    expect(() => assertCan(eastLegon, "catalog:write")).toThrow(NotAuthorizedError);
    expect(() => assertCan(eastLegon, "sale:create", OTHER_SHOP)).toThrow(
      /not authorized to sale:create at shop shop-osu/i,
    );
  });
});

describe("isSensitiveField — every spelling of cost & friends", () => {
  it("flags cost/margin/profit/inventory-value in snake or camel case", () => {
    for (const key of [
      "cost",
      "cost_pesewas",
      "costPesewas",
      "margin",
      "margin_pesewas",
      "marginPesewas",
      "profit",
      "profit_pesewas",
      "inventory_value",
      "inventoryValue",
      "inventory_value_pesewas",
      // the dashboard's Owner-only figures (MP-24/26)
      "cogs",
      "cogs_pesewas",
      "cogsPesewas",
      "gross_profit",
      "grossProfit",
      "grossProfitPesewas",
      "marginRatio",
      "margin_ratio",
    ]) {
      expect(isSensitiveField(key)).toBe(true);
    }
  });

  it("flags the dashboard's Owner-only figures by their exact field names", () => {
    for (const key of [
      "cogsPesewas",
      "grossProfitPesewas",
      "marginRatio",
      "inventoryValuePesewas",
    ]) {
      expect(isSensitiveField(key)).toBe(true);
    }
  });

  it("leaves ordinary fields alone", () => {
    for (const key of ["price_pesewas", "pricePesewas", "name", "quantity", "discount"]) {
      expect(isSensitiveField(key)).toBe(false);
    }
  });
});

describe("redactForActor — cost/margin stripped for a Cashier", () => {
  const item = {
    id: "item-1",
    name: "16in Lace Front",
    price_pesewas: 250000,
    cost_pesewas: 150000,
    marginPesewas: 100000,
  };

  it("returns the Owner's payload unchanged", () => {
    expect(redactForActor(owner, item)).toEqual(item);
  });

  it("removes the money fields for a Cashier — absent, not nulled", () => {
    const redacted = redactForActor(eastLegon, item) as Record<string, unknown>;
    expect(redacted).toEqual({
      id: "item-1",
      name: "16in Lace Front",
      price_pesewas: 250000,
    });
    expect("cost_pesewas" in redacted).toBe(false);
    expect("marginPesewas" in redacted).toBe(false);
    expect(redacted.cost_pesewas).toBeUndefined();
  });

  it("recurses through arrays and nested objects", () => {
    const payload = {
      shop: "East Legon",
      inventory_value_pesewas: 9_999_999,
      items: [
        { id: "a", price_pesewas: 100, cost_pesewas: 60 },
        { id: "b", price_pesewas: 200, cost_pesewas: 110, detail: { cost: 1 } },
      ],
    };

    const redacted = redactForActor(eastLegon, payload);

    expect(redacted).toEqual({
      shop: "East Legon",
      items: [
        { id: "a", price_pesewas: 100 },
        { id: "b", price_pesewas: 200, detail: {} },
      ],
    });
  });

  it("does not mutate the original payload", () => {
    const original = { cost_pesewas: 5, price_pesewas: 10 };
    redactForActor(eastLegon, original);
    expect(original.cost_pesewas).toBe(5);
  });

  it("strips the dashboard's Owner figures, keeping revenue and emptying the owner block", () => {
    const payload = {
      today: { revenuePesewas: 64500 },
      owner: {
        cogsPesewas: 18500,
        grossProfitPesewas: 46000,
        marginRatio: 0.71,
        inventoryValuePesewas: 123000,
      },
    };
    // Revenue is shared (visible to both roles); every cost-derived figure goes.
    expect(redactForActor(eastLegon, payload)).toEqual({
      today: { revenuePesewas: 64500 },
      owner: {},
    });
  });
});
