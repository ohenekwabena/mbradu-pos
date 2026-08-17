-- Stock takes (ADR-0006): a blind physical count of one Shop's stock. Either
-- role counts (a Cashier their own Shop, the Owner any Shop); entry is blind —
-- the counter never sees expected quantities; the expected quantity is
-- snapshotted server-side when a line is counted. Submitting changes NO stock:
-- posting happens only at Owner approval (MP-37), one `stock_take` movement per
-- non-zero Variance. MP-35 ships start / blind count / resume / cancel / submit.

-- ---------------------------------------------------------------------------
-- stock_takes: one counting session at one Shop. At most one open session per
-- Shop; `approved` is written by the approval RPC (MP-37), listed in the CHECK
-- now so the status set never needs another migration.
-- ---------------------------------------------------------------------------
create table if not exists public.stock_takes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  counted_by uuid not null references auth.users (id),
  status text not null default 'open'
    check (status in ('open', 'submitted', 'approved', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);

comment on table public.stock_takes is
  'A blind Stock take session at one Shop (ADR-0006). Written only by the stock-take RPCs.';

create index if not exists stock_takes_shop_idx
  on public.stock_takes (shop_id, created_at desc);

-- One open count per Shop — "start" is really start-or-resume.
create unique index if not exists stock_takes_one_open_per_shop
  on public.stock_takes (shop_id) where status = 'open';

drop trigger if exists stock_takes_touch_updated_at on public.stock_takes;
create trigger stock_takes_touch_updated_at
  before update on public.stock_takes
  for each row execute function public.touch_updated_at();

alter table public.stock_takes enable row level security;

drop policy if exists "Owner reads all stock takes" on public.stock_takes;
create policy "Owner reads all stock takes"
  on public.stock_takes for select to authenticated using (public.is_owner());

drop policy if exists "Cashier reads own shop stock takes" on public.stock_takes;
create policy "Cashier reads own shop stock takes"
  on public.stock_takes for select to authenticated
  using (shop_id = public.auth_shop());

-- ---------------------------------------------------------------------------
-- stock_take_lines: one line per Item in the session's scope. A line is
-- pending (nothing recorded), counted (counted_qty + the expected_qty snapshot
-- + counted_at, taken in the same statement), or skipped (explicitly not
-- counted). expected_qty is the Variance basis and is Owner-only — masked the
-- same way items_catalog masks cost.
-- ---------------------------------------------------------------------------
create table if not exists public.stock_take_lines (
  id uuid primary key default gen_random_uuid(),
  take_id uuid not null references public.stock_takes (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  expected_qty integer check (expected_qty >= 0),
  counted_qty integer check (counted_qty >= 0),
  skipped boolean not null default false,
  counted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (take_id, item_id),
  -- A line is exactly one of: pending, counted (with its snapshot), skipped.
  constraint stock_take_lines_state check (
    (skipped = false and counted_qty is null and expected_qty is null and counted_at is null)
    or (skipped = false and counted_qty is not null and expected_qty is not null and counted_at is not null)
    or (skipped = true and counted_qty is null and expected_qty is null and counted_at is not null)
  )
);

comment on table public.stock_take_lines is
  'Lines of a Stock take: expected_qty is snapshotted server-side at count time and is Owner-only (read via stock_take_lines_visible).';

create index if not exists stock_take_lines_take_idx
  on public.stock_take_lines (take_id);

drop trigger if exists stock_take_lines_touch_updated_at on public.stock_take_lines;
create trigger stock_take_lines_touch_updated_at
  before update on public.stock_take_lines
  for each row execute function public.touch_updated_at();

-- Blindness is enforced at the COLUMN level, like items.cost_pesewas: revoke
-- direct SELECT on the base table (Owner and Cashier share the one
-- `authenticated` role, so a column GRANT can't tell them apart) and expose a
-- masking view. RLS is enabled with no policies — every read goes through the
-- view, every write through the RPCs.
alter table public.stock_take_lines enable row level security;
revoke select on public.stock_take_lines from anon, authenticated;

-- SECURITY DEFINER on purpose (mirrors items_catalog): it bypasses the base
-- table's deny-all RLS and does both the row scoping (Owner all, Cashier own
-- Shop) and the expected_qty masking itself. is_owner()/auth_shop() reflect
-- the real caller — auth.uid() is session-scoped, not the definer.
create or replace view public.stock_take_lines_visible
with (security_invoker = off) as
  select
    l.id, l.take_id, l.item_id,
    case when public.is_owner() then l.expected_qty else null end as expected_qty,
    l.counted_qty, l.skipped, l.counted_at, l.created_at, l.updated_at
  from public.stock_take_lines l
  join public.stock_takes t on t.id = l.take_id
  where public.is_owner() or t.shop_id = public.auth_shop();

comment on view public.stock_take_lines_visible is
  'Read path for Stock-take lines. Masks expected_qty (Owner-only) and scopes rows: Owner all, Cashier own Shop.';

grant select on public.stock_take_lines_visible to authenticated;

-- ===========================================================================
-- RPCs — the only write path. SECURITY DEFINER so they can write through RLS;
-- each re-checks authorization (Owner, or the Shop's own Cashier).
-- ===========================================================================

-- Start a Stock take at a Shop. Scope: every carried, non-archived Item by
-- default, or the given subset for a targeted spot-count. Lines are created
-- pending — expected_qty is NOT snapshotted here, but at each line's count.
create or replace function public.start_stock_take(
  p_shop_id uuid,
  p_item_ids uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_take_id uuid;
  v_line_count integer;
begin
  if not public.is_owner() and public.auth_shop() is distinct from p_shop_id then
    raise exception 'not authorized to count at this shop';
  end if;

  if exists (
    select 1 from public.stock_takes
    where shop_id = p_shop_id and status = 'open'
  ) then
    raise exception 'a stock take is already open at this shop — continue or cancel it first';
  end if;

  if p_item_ids is not null and coalesce(array_length(p_item_ids, 1), 0) = 0 then
    raise exception 'pick at least one item to count';
  end if;

  insert into public.stock_takes (shop_id, counted_by)
  values (p_shop_id, (select auth.uid()))
  returning id into v_take_id;

  insert into public.stock_take_lines (take_id, item_id)
  select v_take_id, ss.item_id
  from public.shop_stock ss
  join public.items i on i.id = ss.item_id
  where ss.shop_id = p_shop_id
    and i.archived_at is null
    and (p_item_ids is null or ss.item_id = any (p_item_ids));

  get diagnostics v_line_count = row_count;
  if v_line_count = 0 then
    raise exception 'nothing to count — this shop carries no matching items';
  end if;
  if p_item_ids is not null
     and v_line_count < (select count(distinct x) from unnest(p_item_ids) x) then
    raise exception 'some chosen items are not carried at this shop';
  end if;

  return v_take_id;
end;
$$;

-- Record one line of an open take: a counted quantity (>= 0 — "none on the
-- shelf" is a real count), or an explicit skip. Counting snapshots the
-- expected quantity from shop_stock in the same statement — the Variance
-- basis, and what makes a mid-count Sale detectable as staleness at review.
-- Recounting before submission is allowed and refreshes the snapshot.
create or replace function public.record_stock_take_line(
  p_line_id uuid,
  p_counted integer default null,
  p_skip boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_take public.stock_takes%rowtype;
  v_line public.stock_take_lines%rowtype;
  v_expected integer;
begin
  select * into v_line from public.stock_take_lines where id = p_line_id for update;
  if v_line.id is null then
    raise exception 'unknown stock take line';
  end if;

  select * into v_take from public.stock_takes where id = v_line.take_id for update;
  if not public.is_owner() and public.auth_shop() is distinct from v_take.shop_id then
    raise exception 'not authorized to count at this shop';
  end if;
  if v_take.status <> 'open' then
    raise exception 'this stock take is no longer open';
  end if;

  if p_skip then
    update public.stock_take_lines
    set skipped = true, counted_qty = null, expected_qty = null, counted_at = now()
    where id = p_line_id;
  else
    if p_counted is null or p_counted < 0 then
      raise exception 'counted quantity must be zero or more';
    end if;

    select quantity into v_expected
    from public.shop_stock
    where item_id = v_line.item_id and shop_id = v_take.shop_id;

    update public.stock_take_lines
    set counted_qty = p_counted,
        skipped = false,
        expected_qty = coalesce(v_expected, 0),
        counted_at = now()
    where id = p_line_id;
  end if;
end;
$$;

-- Submit an open take: every line counted or explicitly skipped, and at least
-- one actually counted. Changes NO stock — the take lands in 'submitted',
-- awaiting Owner review (MP-37).
create or replace function public.submit_stock_take(p_take_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_take public.stock_takes%rowtype;
  v_pending integer;
  v_counted integer;
begin
  select * into v_take from public.stock_takes where id = p_take_id for update;
  if v_take.id is null then
    raise exception 'unknown stock take';
  end if;
  if not public.is_owner() and public.auth_shop() is distinct from v_take.shop_id then
    raise exception 'not authorized to count at this shop';
  end if;
  if v_take.status <> 'open' then
    raise exception 'only an open stock take can be submitted';
  end if;

  select
    count(*) filter (where counted_qty is null and not skipped),
    count(*) filter (where counted_qty is not null)
  into v_pending, v_counted
  from public.stock_take_lines
  where take_id = p_take_id;

  if v_pending > 0 then
    raise exception 'every line must be counted or skipped before submitting (% left)', v_pending;
  end if;
  if v_counted = 0 then
    raise exception 'a stock take needs at least one counted line';
  end if;

  update public.stock_takes
  set status = 'submitted', submitted_at = now()
  where id = p_take_id;
end;
$$;

-- Cancel an open take. Nothing was ever posted, so this simply closes the
-- session; the lines (and any snapshots taken) are kept for the audit trail.
create or replace function public.cancel_stock_take(p_take_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_take public.stock_takes%rowtype;
begin
  select * into v_take from public.stock_takes where id = p_take_id for update;
  if v_take.id is null then
    raise exception 'unknown stock take';
  end if;
  if not public.is_owner() and public.auth_shop() is distinct from v_take.shop_id then
    raise exception 'not authorized to count at this shop';
  end if;
  if v_take.status <> 'open' then
    raise exception 'only an open stock take can be cancelled';
  end if;

  update public.stock_takes
  set status = 'cancelled'
  where id = p_take_id;
end;
$$;

revoke execute on function public.start_stock_take(uuid, uuid[]) from public, anon;
revoke execute on function public.record_stock_take_line(uuid, integer, boolean) from public, anon;
revoke execute on function public.submit_stock_take(uuid) from public, anon;
revoke execute on function public.cancel_stock_take(uuid) from public, anon;
grant execute on function public.start_stock_take(uuid, uuid[]) to authenticated;
grant execute on function public.record_stock_take_line(uuid, integer, boolean) to authenticated;
grant execute on function public.submit_stock_take(uuid) to authenticated;
grant execute on function public.cancel_stock_take(uuid) to authenticated;
