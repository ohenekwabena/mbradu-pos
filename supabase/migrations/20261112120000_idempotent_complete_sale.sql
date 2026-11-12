-- Idempotent Sale completion + stable error codes (ADR-0008, GitHub #27).
--
-- Cashiers sell on slow, flaky mobile data. A timed-out "Complete sale" used to
-- leave the cashier unable to tell whether the Sale was written, and a retry
-- could double-book it (double stock decrement, phantom Day-close shortage).
--
-- Changes to complete_sale:
--   * p_sale_id: the CLIENT generates the Sale's id when the checkout starts and
--     resends it on every attempt. It becomes sales.id. If a Sale with that id
--     already exists (same seller, same Shop), the call returns it and writes
--     nothing — a replay can never create a second Sale. A per-id advisory lock
--     serializes concurrent attempts, so a retry racing the original waits for
--     it and then sees the committed Sale (never a false "insufficient stock").
--   * p_expected_total: the total the cashier was shown. If the server-side
--     total (catalog prices) differs, nothing is written and price_changed is
--     raised with the current prices, so the phone can ask the cashier to confirm.
--   * Every rejection raises a STABLE CODE as the error message (with a JSON
--     detail payload), so the phone maps codes to plain English and never shows
--     raw database text:
--       not_authorized, sale_id_conflict, empty_sale, invalid_quantity,
--       unknown_item, not_carried, insufficient_stock, invalid_payment,
--       payment_mismatch, price_changed
--
-- All guarantees (server-side prices, row locks, no overselling, payments sum to
-- total, one transaction) are unchanged.
--
-- The old 4-arg complete_sale(uuid, text, jsonb, jsonb) is deliberately LEFT IN
-- PLACE as an overload: the currently deployed app still calls it, and dropping
-- it before the new code ships would stop selling. Drop it in a follow-up
-- migration once this release is live.

create or replace function public.complete_sale(
  p_sale_id uuid,
  p_shop_id uuid,
  p_customer text,
  p_lines jsonb,
  p_payments jsonb,
  p_expected_total bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint := 0;
  v_pay_total bigint;
  v_item_id uuid;
  v_qty integer;
  v_price bigint;
  v_stock integer;
  v_line jsonb;
  v_pay jsonb;
  v_existing_shop uuid;
  v_existing_seller uuid;
  v_prices jsonb := '[]'::jsonb;
begin
  -- Authorization: a Cashier may only sell at their own Shop.
  if not public.is_owner() and public.auth_shop() is distinct from p_shop_id then
    raise exception using message = 'not_authorized',
      detail = jsonb_build_object('shop_id', p_shop_id)::text;
  end if;

  if p_sale_id is null then
    raise exception using message = 'sale_id_conflict',
      detail = jsonb_build_object('reason', 'missing sale id')::text;
  end if;

  -- Serialize attempts carrying the same Sale id, then short-circuit a replay.
  perform pg_advisory_xact_lock(hashtextextended(p_sale_id::text, 0));

  select shop_id, seller into v_existing_shop, v_existing_seller
  from public.sales where id = p_sale_id;

  if found then
    if v_existing_shop = p_shop_id and v_existing_seller = (select auth.uid()) then
      return p_sale_id; -- already written: idempotent success
    end if;
    raise exception using message = 'sale_id_conflict',
      detail = jsonb_build_object('sale_id', p_sale_id)::text;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using message = 'empty_sale';
  end if;

  -- Pass 1: validate every line and lock its Shop stock; accumulate the total
  -- from server-side prices. Locks are held until commit.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_qty := (v_line ->> 'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception using message = 'invalid_quantity',
        detail = jsonb_build_object('item_id', v_item_id)::text;
    end if;

    select price_pesewas into v_price from public.items where id = v_item_id;
    if v_price is null then
      raise exception using message = 'unknown_item',
        detail = jsonb_build_object('item_id', v_item_id)::text;
    end if;

    select quantity into v_stock
    from public.shop_stock
    where item_id = v_item_id and shop_id = p_shop_id
    for update;

    if v_stock is null then
      raise exception using message = 'not_carried',
        detail = jsonb_build_object('item_id', v_item_id)::text;
    end if;
    if v_stock < v_qty then
      raise exception using message = 'insufficient_stock',
        detail = jsonb_build_object('item_id', v_item_id, 'available', v_stock, 'requested', v_qty)::text;
    end if;

    v_total := v_total + v_qty::bigint * v_price;
    v_prices := v_prices || jsonb_build_object('item_id', v_item_id, 'price_pesewas', v_price);
  end loop;

  -- The cashier must have been shown this exact total.
  if p_expected_total is distinct from v_total then
    raise exception using message = 'price_changed',
      detail = jsonb_build_object('total_pesewas', v_total, 'expected_pesewas', p_expected_total, 'prices', v_prices)::text;
  end if;

  -- Payments: known methods, positive amounts, summing exactly to the total.
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception using message = 'invalid_payment';
  end if;
  for v_pay in select * from jsonb_array_elements(p_payments)
  loop
    if (v_pay ->> 'method') not in ('cash', 'momo', 'card', 'transfer')
       or (v_pay ->> 'amount_pesewas') is null
       or (v_pay ->> 'amount_pesewas')::bigint <= 0 then
      raise exception using message = 'invalid_payment',
        detail = jsonb_build_object('method', v_pay ->> 'method')::text;
    end if;
  end loop;

  select coalesce(sum((e ->> 'amount_pesewas')::bigint), 0) into v_pay_total
  from jsonb_array_elements(p_payments) e;

  if v_pay_total <> v_total then
    raise exception using message = 'payment_mismatch',
      detail = jsonb_build_object('payments_pesewas', v_pay_total, 'total_pesewas', v_total)::text;
  end if;

  -- Write the Sale under the client's id.
  insert into public.sales (id, shop_id, seller, customer_name, total_pesewas)
  values (p_sale_id, p_shop_id, (select auth.uid()), nullif(p_customer, ''), v_total);

  -- Pass 2: line items, stock decrement, and one Sale movement per line.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_qty := (v_line ->> 'quantity')::integer;
    select price_pesewas into v_price from public.items where id = v_item_id;

    insert into public.sale_line_items (sale_id, item_id, quantity, unit_price_pesewas)
    values (p_sale_id, v_item_id, v_qty, v_price);

    update public.shop_stock
    set quantity = quantity - v_qty, updated_at = now()
    where item_id = v_item_id and shop_id = p_shop_id;

    insert into public.stock_movements (item_id, shop_id, reason, amount, actor, sale_id)
    values (v_item_id, p_shop_id, 'sale', -v_qty, (select auth.uid()), p_sale_id);
  end loop;

  insert into public.payments (sale_id, method, amount_pesewas)
  select p_sale_id, e ->> 'method', (e ->> 'amount_pesewas')::bigint
  from jsonb_array_elements(p_payments) e;

  return p_sale_id;
end;
$$;

revoke execute on function public.complete_sale(uuid, uuid, text, jsonb, jsonb, bigint) from public, anon;
grant execute on function public.complete_sale(uuid, uuid, text, jsonb, jsonb, bigint) to authenticated;
