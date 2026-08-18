/**
 * Stock-take approval integration test (MP-37) — exercises the real
 * `approve_stock_take` RPC against the remote Supabase, end to end, to prove
 * what the pure review logic can't: approval is **atomic** (movement + line
 * verdict + quantity + status in one transaction), the posted delta **lands
 * stock exactly on the counted value** with a **provenance link** to its line,
 * a **stale** line (moved-after-snapshot) is excluded and flagged instead of
 * posted, classification is **required** per postable Variance, blindness
 * holds for the Cashier through the masking view, and only the Owner can
 * approve or reject. The pure unit tests live in `stock-take.test.ts`.
 *
 * Seeds its own throwaway Shop, Items, stock, a Cashier bound to the Shop
 * (the counter), and an Owner (the approver) — the RPCs authorize via the
 * caller's real `auth.uid()`, so both run with real sessions. Everything is
 * cleaned up afterwards. Kept out of the default `npm test`; run with
 * `npm run test:integration`. Skips itself when the Supabase env is absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ready = Boolean(url && anonKey && serviceKey);

describe.skipIf(!ready)("approve_stock_take RPC (remote integration)", () => {
  const uniq = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`).replace(/-/g, "").slice(0, 10);

  let admin: SupabaseClient;
  let cashier: SupabaseClient;
  let owner: SupabaseClient;
  let shopId: string;
  let itemA: string; // counted short → the posted Variance
  let itemB: string; // counted dead-on → verified correct
  let itemC: string; // zero-variance line in the stale take
  let cashierId: string;
  let ownerId: string;

  // Take 1 (approve path) and its lines.
  let take1: string;
  let lineA1: string;
  let lineB1: string;

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: shop, error: shopErr } = await admin
      .from("shops")
      .insert({ name: `ITEST Take Shop ${uniq}` })
      .select("id")
      .single();
    if (shopErr) throw shopErr;
    shopId = shop.id as string;

    const { data: items, error: itemErr } = await admin
      .from("items")
      .insert([
        { category: "wig", name: `ITEST Take A ${uniq}`, price_pesewas: 10_000, cost_pesewas: 4_000 },
        { category: "wig", name: `ITEST Take B ${uniq}`, price_pesewas: 8_000, cost_pesewas: 3_000 },
        { category: "wig", name: `ITEST Take C ${uniq}`, price_pesewas: 6_000, cost_pesewas: 2_000 },
      ])
      .select("id, name");
    if (itemErr) throw itemErr;
    itemA = (items.find((i) => i.name.includes("Take A")) as { id: string }).id;
    itemB = (items.find((i) => i.name.includes("Take B")) as { id: string }).id;
    itemC = (items.find((i) => i.name.includes("Take C")) as { id: string }).id;

    const { error: stockErr } = await admin.from("shop_stock").insert([
      { item_id: itemA, shop_id: shopId, quantity: 10 },
      { item_id: itemB, shop_id: shopId, quantity: 4 },
      { item_id: itemC, shop_id: shopId, quantity: 6 },
    ]);
    if (stockErr) throw stockErr;

    const cashierEmail = `itest_take_cashier_${uniq}@example.com`;
    const ownerEmail = `itest_take_owner_${uniq}@example.com`;
    const password = `Itest!${uniq}aA9`;

    const { data: cashierUser, error: cashierErr } = await admin.auth.admin.createUser({
      email: cashierEmail,
      password,
      email_confirm: true,
      user_metadata: { role: "cashier", shop_id: shopId, full_name: `ITEST Counter ${uniq}` },
    });
    if (cashierErr) throw cashierErr;
    cashierId = cashierUser.user.id;

    const { data: ownerUser, error: ownerErr } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: { role: "owner", full_name: `ITEST Approver ${uniq}` },
    });
    if (ownerErr) throw ownerErr;
    ownerId = ownerUser.user.id;

    cashier = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    owner = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: cashierSignIn } = await cashier.auth.signInWithPassword({
      email: cashierEmail,
      password,
    });
    if (cashierSignIn) throw cashierSignIn;
    const { error: ownerSignIn } = await owner.auth.signInWithPassword({
      email: ownerEmail,
      password,
    });
    if (ownerSignIn) throw ownerSignIn;
  });

  afterAll(async () => {
    if (!admin) return;
    const best = async (run: () => PromiseLike<unknown>) => {
      try {
        await run();
      } catch {
        /* best-effort cleanup */
      }
    };
    // FK-safe order: movements (reference take lines) → takes (cascade lines)
    // → shop_stock → items → users (cascade profiles) → shop.
    if (shopId) {
      await best(() => admin.from("stock_movements").delete().eq("shop_id", shopId));
      await best(() => admin.from("stock_takes").delete().eq("shop_id", shopId));
      await best(() => admin.from("shop_stock").delete().eq("shop_id", shopId));
    }
    await best(() => admin.from("items").delete().in("id", [itemA, itemB, itemC].filter(Boolean)));
    if (cashierId) await best(() => admin.auth.admin.deleteUser(cashierId));
    if (ownerId) await best(() => admin.auth.admin.deleteUser(ownerId));
    if (shopId) await best(() => admin.from("shops").delete().eq("id", shopId));
  });

  async function qty(itemId: string): Promise<number> {
    const { data } = await admin
      .from("shop_stock")
      .select("quantity")
      .eq("item_id", itemId)
      .eq("shop_id", shopId)
      .single();
    return data!.quantity as number;
  }

  async function lineFor(takeId: string, itemId: string) {
    const { data } = await admin
      .from("stock_take_lines")
      .select("id, expected_qty, counted_qty, skipped, stale, variance_reason, variance_note")
      .eq("take_id", takeId)
      .eq("item_id", itemId)
      .single();
    return data!;
  }

  /** Start (as the Cashier), count each given line, and submit. */
  async function countAndSubmit(counts: { itemId: string; counted: number }[]): Promise<string> {
    const { data: takeId, error: startErr } = await cashier.rpc("start_stock_take", {
      p_shop_id: shopId,
      p_item_ids: counts.map((c) => c.itemId),
    });
    expect(startErr).toBeNull();
    for (const { itemId, counted } of counts) {
      const line = await lineFor(takeId as string, itemId);
      const { error } = await cashier.rpc("record_stock_take_line", {
        p_line_id: line.id as string,
        p_counted: counted,
        p_skip: false,
      });
      expect(error).toBeNull();
    }
    const { error: submitErr } = await cashier.rpc("submit_stock_take", {
      p_take_id: takeId as string,
    });
    expect(submitErr).toBeNull();
    return takeId as string;
  }

  it("keeps the Cashier blind through the masking view, verdict columns included", async () => {
    take1 = await countAndSubmit([
      { itemId: itemA, counted: 7 }, // expected 10 → Variance −3
      { itemId: itemB, counted: 4 }, // expected 4 → verified
    ]);
    lineA1 = (await lineFor(take1, itemA)).id as string;
    lineB1 = (await lineFor(take1, itemB)).id as string;

    const { data: cashierRows } = await cashier
      .from("stock_take_lines_visible")
      .select("id, expected_qty, counted_qty, variance_reason, variance_note, stale")
      .eq("take_id", take1)
      .eq("id", lineA1);
    expect(cashierRows).toHaveLength(1);
    expect(cashierRows![0]).toMatchObject({
      counted_qty: 7,
      expected_qty: null, // blind
      variance_reason: null,
      variance_note: null,
      stale: null,
    });

    const { data: ownerRows } = await owner
      .from("stock_take_lines_visible")
      .select("id, expected_qty")
      .eq("id", lineA1);
    expect(ownerRows![0].expected_qty).toBe(10); // the Owner sees the snapshot
  });

  it("refuses approval from a non-Owner", async () => {
    const { error } = await cashier.rpc("approve_stock_take", {
      p_take_id: take1,
      p_classifications: [{ line_id: lineA1, reason: "unexplained", note: null }],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/only the Owner/i);
    expect(await qty(itemA)).toBe(10); // nothing moved
  });

  it("refuses approval while a Variance is unclassified", async () => {
    const { error } = await owner.rpc("approve_stock_take", {
      p_take_id: take1,
      p_classifications: [],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/must be classified/i);

    const { data: take } = await admin.from("stock_takes").select("status").eq("id", take1).single();
    expect(take!.status).toBe("submitted"); // untouched
    expect(await qty(itemA)).toBe(10);
  });

  it("approves: posts the Variance with provenance, lands stock on the counted value, atomically", async () => {
    const { data, error } = await owner.rpc("approve_stock_take", {
      p_take_id: take1,
      p_classifications: [{ line_id: lineA1, reason: "unexplained", note: "shelf gap" }],
    });
    expect(error).toBeNull();
    expect(data).toEqual({ posted: 1, verified: 1, stale: 0 });

    // Stock healed to the counted values.
    expect(await qty(itemA)).toBe(7);
    expect(await qty(itemB)).toBe(4);

    // One stock_take movement, linked to the line it settles.
    const { data: movements } = await admin
      .from("stock_movements")
      .select("reason, amount, actor, note, take_line_id")
      .eq("shop_id", shopId)
      .eq("reason", "stock_take");
    expect(movements).toEqual([
      {
        reason: "stock_take",
        amount: -3,
        actor: ownerId,
        note: "unexplained — shelf gap",
        take_line_id: lineA1,
      },
    ]);

    // Line verdicts: the Variance is classified; the dead-on line stands as
    // verified correct (no classification, nothing posted).
    expect(await lineFor(take1, itemA)).toMatchObject({
      variance_reason: "unexplained",
      variance_note: "shelf gap",
      stale: false,
    });
    expect(await lineFor(take1, itemB)).toMatchObject({
      variance_reason: null,
      variance_note: null,
      stale: false,
    });

    const { data: take } = await admin
      .from("stock_takes")
      .select("status, approved_at, approved_by")
      .eq("id", take1)
      .single();
    expect(take!.status).toBe("approved");
    expect(take!.approved_by).toBe(ownerId);
    expect(take!.approved_at).not.toBeNull();
  });

  it("flags a moved-after-snapshot line stale: excluded from posting, listed for recount", async () => {
    // Count A short again (expected 7 → counted 5) and C dead-on…
    const take3 = await countAndSubmit([
      { itemId: itemA, counted: 5 },
      { itemId: itemC, counted: 6 },
    ]);
    // …but a restock lands on A after its snapshot (the mid-count movement).
    const { error: restockErr } = await owner.rpc("record_restock", {
      p_item_id: itemA,
      p_shop_id: shopId,
      p_amount: 2,
      p_note: "ITEST mid-count delivery",
    });
    expect(restockErr).toBeNull();
    expect(await qty(itemA)).toBe(9);

    // Approving (with a classification for A, which must be ignored) posts
    // nothing for the stale line and leaves its quantity alone.
    const { data, error } = await owner.rpc("approve_stock_take", {
      p_take_id: take3,
      p_classifications: [{ line_id: (await lineFor(take3, itemA)).id, reason: "unexplained", note: null }],
    });
    expect(error).toBeNull();
    expect(data).toEqual({ posted: 0, verified: 1, stale: 1 });

    expect(await qty(itemA)).toBe(9); // stale line never posted
    expect(await lineFor(take3, itemA)).toMatchObject({
      stale: true,
      variance_reason: null,
    });
    expect(await lineFor(take3, itemC)).toMatchObject({ stale: false, variance_reason: null });

    // Still exactly one stock_take movement in the whole suite (from take 1).
    const { count } = await admin
      .from("stock_movements")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("reason", "stock_take");
    expect(count).toBe(1);

    const { data: take } = await admin.from("stock_takes").select("status").eq("id", take3).single();
    expect(take!.status).toBe("approved");
  });

  it("lets only the Owner cancel a submitted take — nothing posts", async () => {
    const take4 = await countAndSubmit([{ itemId: itemB, counted: 1 }]); // expected 4 → Variance −3

    const { error: cashierCancel } = await cashier.rpc("cancel_stock_take", {
      p_take_id: take4,
    });
    expect(cashierCancel).not.toBeNull();
    expect(cashierCancel!.message).toMatch(/only the Owner/i);

    const { error: ownerCancel } = await owner.rpc("cancel_stock_take", { p_take_id: take4 });
    expect(ownerCancel).toBeNull();

    const { data: take } = await admin.from("stock_takes").select("status").eq("id", take4).single();
    expect(take!.status).toBe("cancelled");
    expect(await qty(itemB)).toBe(4); // untouched

    // A cancelled take can't be approved afterwards.
    const { error: approveErr } = await owner.rpc("approve_stock_take", {
      p_take_id: take4,
      p_classifications: [],
    });
    expect(approveErr).not.toBeNull();
    expect(approveErr!.message).toMatch(/only a submitted/i);
  });
});
