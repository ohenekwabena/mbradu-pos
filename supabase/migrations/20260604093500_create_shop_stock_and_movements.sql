-- Per-Shop stock and the append-only movement ledger, plus the RPCs that are
-- the only write path. See ADR-0004 (ledger is source of truth; quantity and
-- movement updated in one transaction) and ADR-0005 (grain is (Item, Shop)).

-- ---------------------------------------------------------------------------
-- shop_stock: one Item's stock at one Shop. Row existence = the Shop carries
-- the Item. quantity is the denormalized current count (= sum of its
-- movements), never negative. Written only by the RPCs below.
-- ---------------------------------------------------------------------------
create table if not exists public.shop_stock (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, shop_id)
);

comment on table public.shop_stock is 'Stock at the (Item, Shop) grain. Row exists = Shop carries the Item. ADR-0005.';

create index if not exists shop_stock_shop_idx on public.shop_stock (shop_id);

drop trigger if exists shop_stock_touch_updated_at on public.shop_stock;
create trigger shop_stock_touch_updated_at
  before update on public.shop_stock
  for each row execute function public.touch_updated_at();

alter table public.shop_stock enable row level security;

drop policy if exists "Owner reads all stock" on public.shop_stock;
create policy "Owner reads all stock"
  on public.shop_stock for select to authenticated using (public.is_owner());

drop policy if exists "Cashier reads own shop stock" on public.shop_stock;
create policy "Cashier reads own shop stock"
  on public.shop_stock for select to authenticated
  using (shop_id = public.auth_shop());

-- ---------------------------------------------------------------------------
-- stock_movements: append-only ledger at the (Item, Shop) grain. Signed
-- amount; sign must match the reason. Written only by the RPCs below.
-- ---------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  reason text not null check (reason in ('sale', 'restock', 'correction')),
  amount integer not null,
  note text,
  actor uuid references auth.users (id),
  sale_id uuid references public.sales (id),
  created_at timestamptz not null default now(),
  -- sign follows reason: restock adds, sale subtracts, correction either way
  constraint stock_movements_sign check (
    (reason = 'restock'    and amount > 0) or
    (reason = 'sale'       and amount < 0) or
    (reason = 'correction' and amount <> 0)
  )
);

comment on table public.stock_movements is 'Append-only stock ledger per (Item, Shop). ADR-0004/0005.';

create index if not exists stock_movements_item_shop_idx
  on public.stock_movements (item_id, shop_id, created_at desc);
create index if not exists stock_movements_sale_idx on public.stock_movements (sale_id);

alter table public.stock_movements enable row level security;

-- Read-only to users (append-only; no update/delete policies). Writes happen
-- through the SECURITY DEFINER RPCs below, which bypass RLS.
drop policy if exists "Owner reads all movements" on public.stock_movements;
create policy "Owner reads all movements"
  on public.stock_movements for select to authenticated using (public.is_owner());

drop policy if exists "Cashier reads own shop movements" on public.stock_movements;
create policy "Cashier reads own shop movements"
  on public.stock_movements for select to authenticated
  using (shop_id = public.auth_shop());

-- ===========================================================================
-- RPCs — the only write path for stock and sales. SECURITY DEFINER so they can
-- write through RLS and keep shop_stock + ledger in one transaction.
-- ===========================================================================

-- Restock (Owner only). The first Restock of an Item at a Shop creates the
-- shop_stock row, i.e. the Shop begins carrying the Item.
create or replace function public.record_restock(
  p_item_id uuid,
  p_shop_id uuid,
  p_amount integer,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'only the Owner can restock';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'restock amount must be positive';
  end if;

  insert into public.shop_stock (item_id, shop_id, quantity)
  values (p_item_id, p_shop_id, p_amount)
  on conflict (item_id, shop_id)
  do update set quantity = shop_stock.quantity + excluded.quantity,
                updated_at = now();

  insert into public.stock_movements (item_id, shop_id, reason, amount, note, actor)
  values (p_item_id, p_shop_id, 'restock', p_amount, p_note, (select auth.uid()));
end;
$$;

-- Correction (Owner only). Signed; cannot drive a carried Shop stock negative,
-- and cannot apply to an Item the Shop does not carry.
create or replace function public.record_correction(
  p_item_id uuid,
  p_shop_id uuid,
  p_amount integer,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty integer;
begin
  if not public.is_owner() then
    raise exception 'only the Owner can correct stock';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'correction amount must be non-zero';
  end if;

  select quantity into v_qty
  from public.shop_stock
  where item_id = p_item_id and shop_id = p_shop_id
  for update;

  if v_qty is null then
    raise exception 'cannot correct an Item the Shop does not carry';
  end if;
  if v_qty + p_amount < 0 then
    raise exception 'correction would make stock negative';
  end if;

  update public.shop_stock
  set quantity = v_qty + p_amount, updated_at = now()
  where item_id = p_item_id and shop_id = p_shop_id;

  insert into public.stock_movements (item_id, shop_id, reason, amount, note, actor)
  values (p_item_id, p_shop_id, 'correction', p_amount, p_note, (select auth.uid()));
end;
$$;

-- Complete a sale at one Shop, atomically. Authz: the Owner (any Shop) or a
-- Cashier whose Shop = p_shop_id. Unit prices are read server-side from the
-- catalog (never trusted from the client). Rejects: empty cart, unknown item,
-- item not carried at the Shop, oversell, payments not summing to the total.
--   p_lines:    jsonb array of { item_id: uuid, quantity: int }
--   p_payments: jsonb array of { method: text, amount_pesewas: bigint }
create or replace function public.complete_sale(
  p_shop_id uuid,
  p_customer text,
  p_lines jsonb,
  p_payments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_id uuid;
  v_total bigint := 0;
  v_pay_total bigint;
  v_item_id uuid;
  v_qty integer;
  v_price bigint;
  v_stock integer;
  v_line jsonb;
begin
  -- Authorization: a Cashier may only sell at their own Shop.
  if not public.is_owner() and public.auth_shop() is distinct from p_shop_id then
    raise exception 'not authorized to sell at this shop';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale needs at least one line item';
  end if;

  -- Pass 1: validate every line and lock its Shop stock; accumulate the total
  -- from server-side prices. Locks held until commit, so the decrement in pass
  -- 2 is safe against concurrent sales.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_qty := (v_line ->> 'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid quantity for item %', v_item_id;
    end if;

    select price_pesewas into v_price from public.items where id = v_item_id;
    if v_price is null then
      raise exception 'unknown item %', v_item_id;
    end if;

    select quantity into v_stock
    from public.shop_stock
    where item_id = v_item_id and shop_id = p_shop_id
    for update;

    if v_stock is null then
      raise exception 'item % is not carried at this shop', v_item_id;
    end if;
    if v_stock < v_qty then
      raise exception 'insufficient stock for item % (have %, need %)', v_item_id, v_stock, v_qty;
    end if;

    v_total := v_total + v_qty::bigint * v_price;
  end loop;

  -- Payments must sum exactly to the total.
  select coalesce(sum((e ->> 'amount_pesewas')::bigint), 0) into v_pay_total
  from jsonb_array_elements(p_payments) e;

  if v_pay_total <> v_total then
    raise exception 'payments (%) do not sum to the sale total (%)', v_pay_total, v_total;
  end if;

  -- Write the Sale.
  insert into public.sales (shop_id, seller, customer_name, total_pesewas)
  values (p_shop_id, (select auth.uid()), nullif(p_customer, ''), v_total)
  returning id into v_sale_id;

  -- Pass 2: line items, stock decrement, and one Sale movement per line.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_qty := (v_line ->> 'quantity')::integer;
    select price_pesewas into v_price from public.items where id = v_item_id;

    insert into public.sale_line_items (sale_id, item_id, quantity, unit_price_pesewas)
    values (v_sale_id, v_item_id, v_qty, v_price);

    update public.shop_stock
    set quantity = quantity - v_qty, updated_at = now()
    where item_id = v_item_id and shop_id = p_shop_id;

    insert into public.stock_movements (item_id, shop_id, reason, amount, actor, sale_id)
    values (v_item_id, p_shop_id, 'sale', -v_qty, (select auth.uid()), v_sale_id);
  end loop;

  -- Payments.
  insert into public.payments (sale_id, method, amount_pesewas)
  select v_sale_id, e ->> 'method', (e ->> 'amount_pesewas')::bigint
  from jsonb_array_elements(p_payments) e;

  return v_sale_id;
end;
$$;

revoke execute on function public.record_restock(uuid, uuid, integer, text) from public, anon;
revoke execute on function public.record_correction(uuid, uuid, integer, text) from public, anon;
revoke execute on function public.complete_sale(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.record_restock(uuid, uuid, integer, text) to authenticated;
grant execute on function public.record_correction(uuid, uuid, integer, text) to authenticated;
grant execute on function public.complete_sale(uuid, text, jsonb, jsonb) to authenticated;
