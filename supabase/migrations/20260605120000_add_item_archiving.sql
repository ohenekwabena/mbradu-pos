-- Item archiving / discontinuation (MP-31). The Owner may archive ("discontinue")
-- an Item so it drops out of the sell and restock pickers, while its history —
-- past Sale line items and the append-only stock ledger — stays intact. Archiving
-- is a reversible soft-delete: a nullable archived_at stamp on items, surfaced
-- through items_catalog so each read path can choose to include or exclude it.
--
-- This is a HITL / triage story; the confirmed semantics are: reversible (archive
-- + restore), granular at the Item with a whole-Product convenience, and BLOCKED
-- while any stock remains on hand — the Owner must sell through or zero the count
-- first. The block is enforced server-side here (a live aggregate over shop_stock),
-- not only in the UI, mirroring how complete_sale / record_correction re-check on
-- the server. See ADR-0002 (one Item model) and ADR-0005 (stock per Shop).

-- ---------------------------------------------------------------------------
-- 1. The soft-delete column. Nullable: NULL = active, a timestamp = archived
--    (and records when). No backfill needed — every existing Item is active.
-- ---------------------------------------------------------------------------
alter table public.items
  add column if not exists archived_at timestamptz;

comment on column public.items.archived_at is
  'When the Item was archived/discontinued (MP-31). NULL = active. Soft-delete: excluded from sell/restock pickers, history preserved, reversible via restore_item.';

create index if not exists items_archived_at_idx on public.items (archived_at);

-- ---------------------------------------------------------------------------
-- 2. Surface archived_at on the read path. items_catalog masks cost (Owner-only)
--    and is SECURITY DEFINER; append the new column so readers can filter on it.
--    Extend the base-table column grant too, for symmetry with created_at/updated_at
--    (reads still go through the view; the view's definer bypasses the grant).
-- ---------------------------------------------------------------------------
grant select (archived_at) on public.items to authenticated;

create or replace view public.items_catalog
with (security_invoker = off) as
  select
    i.id, i.category, i.name, i.product_id,
    i.price_pesewas, i.attributes, i.created_at, i.updated_at,
    case when public.is_owner() then i.cost_pesewas else null end as cost_pesewas,
    i.archived_at
  from public.items i;

comment on view public.items_catalog is
  'Read path for Items. Masks cost_pesewas (Owner-only) and carries archived_at (MP-31) so pickers exclude archived Items while history/detail reads keep resolving them.';

-- ---------------------------------------------------------------------------
-- 3. Archive / restore RPCs — the single write path, Owner-gated and SECURITY
--    DEFINER (like record_restock / record_correction). Archiving is BLOCKED while
--    any Shop still holds stock: the aggregate on-hand must be 0 (block-until-zero).
-- ---------------------------------------------------------------------------

-- Archive one Item. Refuses if it still has stock on hand at any Shop. Idempotent:
-- archiving an already-archived Item is a no-op (keeps the original timestamp).
create or replace function public.archive_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on_hand integer;
  v_archived timestamptz;
begin
  if not public.is_owner() then
    raise exception 'only the Owner can archive items';
  end if;

  select archived_at into v_archived from public.items where id = p_item_id;
  if not found then
    raise exception 'item % not found', p_item_id;
  end if;
  if v_archived is not null then
    return; -- already archived
  end if;

  select coalesce(sum(quantity), 0) into v_on_hand
  from public.shop_stock where item_id = p_item_id;

  if v_on_hand > 0 then
    raise exception 'cannot discontinue an item with % unit(s) still in stock', v_on_hand;
  end if;

  update public.items set archived_at = now() where id = p_item_id;
end;
$$;

-- Restore (un-archive) one Item back into the active catalog. No stock guard —
-- bringing an Item back is always safe. Idempotent for an already-active Item.
create or replace function public.restore_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'only the Owner can restore items';
  end if;

  update public.items set archived_at = null where id = p_item_id;
  if not found then
    raise exception 'item % not found', p_item_id;
  end if;
end;
$$;

-- Discontinue a whole cosmetic Product — archive all its shade Items at once.
-- All-or-nothing: refuses if any shade still holds stock (block-until-zero across
-- the line), so a line never ends up half-archived.
create or replace function public.archive_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on_hand integer;
  v_active integer;
begin
  if not public.is_owner() then
    raise exception 'only the Owner can archive items';
  end if;

  select count(*) into v_active from public.items
  where product_id = p_product_id and archived_at is null;
  if v_active = 0 then
    return; -- unknown product, or every shade already discontinued
  end if;

  select coalesce(sum(ss.quantity), 0) into v_on_hand
  from public.items i
  join public.shop_stock ss on ss.item_id = i.id
  where i.product_id = p_product_id;

  if v_on_hand > 0 then
    raise exception 'cannot discontinue the line: % unit(s) still in stock across its shades', v_on_hand;
  end if;

  update public.items set archived_at = now()
  where product_id = p_product_id and archived_at is null;
end;
$$;

revoke execute on function public.archive_item(uuid) from public, anon;
revoke execute on function public.restore_item(uuid) from public, anon;
revoke execute on function public.archive_product(uuid) from public, anon;
grant execute on function public.archive_item(uuid) to authenticated;
grant execute on function public.restore_item(uuid) to authenticated;
grant execute on function public.archive_product(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Keep the "archived ⇒ unsellable" invariant: a discontinued Item must not be
--    re-stocked behind the picker's back. record_restock now refuses an archived
--    Item (restore it first). complete_sale needs no change — an archived Item is
--    at 0 stock and can't be restocked, so it can never be sold. Body otherwise
--    unchanged from …_create_shop_stock_and_movements.sql; CREATE OR REPLACE keeps
--    the existing grants.
-- ---------------------------------------------------------------------------
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
  if exists (select 1 from public.items where id = p_item_id and archived_at is not null) then
    raise exception 'cannot restock a discontinued item — restore it first';
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
