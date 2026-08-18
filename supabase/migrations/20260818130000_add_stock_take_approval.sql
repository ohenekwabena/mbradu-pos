-- Stock-take approval (ADR-0006, MP-37): the Owner-only half that settles a
-- submitted blind count. Approval classifies each non-zero Variance, posts one
-- `stock_take` ledger movement per posted Variance (with a provenance link to
-- the count line it settles), and updates `shop_stock.quantity` in the same
-- transaction — the ADR-0004 invariant. A line invalidated by a movement after
-- its snapshot is **stale**: flagged, never posted, listed for recount — false
-- shrinkage against honest staff is the worst failure mode.

-- ---------------------------------------------------------------------------
-- Provenance: a `stock_take` movement names the count line it settles. Plain
-- FK (no cascade): an approved take's lines can never be deleted out from
-- under the append-only ledger.
-- ---------------------------------------------------------------------------
alter table public.stock_movements
  add column if not exists take_line_id uuid references public.stock_take_lines (id);

comment on column public.stock_movements.take_line_id is
  'For reason = stock_take: the count line whose Variance this movement posts (ADR-0006).';

create index if not exists stock_movements_take_line_idx
  on public.stock_movements (take_line_id) where take_line_id is not null;

-- ---------------------------------------------------------------------------
-- Review verdicts, written only by approve_stock_take: the Owner's
-- classification of a posted Variance, and the stale flag for lines excluded
-- from posting. All three are Owner-only reads (masked in the view below) —
-- a Cashier submits counts but never sees Variances (CONTEXT.md).
-- ---------------------------------------------------------------------------
alter table public.stock_take_lines
  add column if not exists variance_reason text
    check (variance_reason in ('damaged', 'expired', 'other', 'unexplained')),
  add column if not exists variance_note text,
  add column if not exists stale boolean not null default false;

comment on column public.stock_take_lines.variance_reason is
  'Owner''s classification of this line''s posted Variance (set at approval; null when nothing posted).';
comment on column public.stock_take_lines.stale is
  'Set at approval: the (Item, Shop) moved after this line''s snapshot, so its Variance was excluded — recount.';

alter table public.stock_takes
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users (id);

-- Recreate the masking view with the verdict columns, Owner-masked like
-- expected_qty (same shape and scoping as before, columns appended).
create or replace view public.stock_take_lines_visible
with (security_invoker = off) as
  select
    l.id, l.take_id, l.item_id,
    case when public.is_owner() then l.expected_qty else null end as expected_qty,
    l.counted_qty, l.skipped, l.counted_at, l.created_at, l.updated_at,
    case when public.is_owner() then l.variance_reason else null end as variance_reason,
    case when public.is_owner() then l.variance_note else null end as variance_note,
    case when public.is_owner() then l.stale else null end as stale
  from public.stock_take_lines l
  join public.stock_takes t on t.id = l.take_id
  where public.is_owner() or t.shop_id = public.auth_shop();

-- ---------------------------------------------------------------------------
-- Approve a submitted take (Owner only), atomically. For each counted line:
--   - stale (any ledger movement on its (Item, Shop) after the snapshot, or a
--     current quantity that no longer matches it — the belt for commit-order
--     edge cases where a movement's timestamp predates the snapshot): flag it,
--     post nothing, leave it for a recount;
--   - zero Variance: post nothing — the line stands as "verified correct";
--   - non-zero Variance: require a classification from p_classifications
--     (jsonb array of { line_id, reason, note }), post one `stock_take`
--     movement with the provenance link, and move shop_stock onto the counted
--     value. Non-stale means current quantity = snapshot, so the posted delta
--     lands exactly on counted_qty — asserted, not assumed.
-- Returns { posted, verified, stale } for the caller's summary.
-- ---------------------------------------------------------------------------
create or replace function public.approve_stock_take(
  p_take_id uuid,
  p_classifications jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_take public.stock_takes%rowtype;
  v_line public.stock_take_lines%rowtype;
  v_current integer;
  v_new integer;
  v_variance integer;
  v_reason text;
  v_note text;
  v_posted integer := 0;
  v_verified integer := 0;
  v_stale integer := 0;
begin
  if not public.is_owner() then
    raise exception 'only the Owner can approve a stock take';
  end if;

  select * into v_take from public.stock_takes where id = p_take_id for update;
  if v_take.id is null then
    raise exception 'unknown stock take';
  end if;
  if v_take.status <> 'submitted' then
    raise exception 'only a submitted stock take can be approved';
  end if;
  if p_classifications is null or jsonb_typeof(p_classifications) <> 'array' then
    raise exception 'classifications must be a json array';
  end if;

  for v_line in
    select * from public.stock_take_lines
    where take_id = p_take_id and counted_qty is not null
    order by created_at, id
  loop
    -- Lock the stock row first, so no Sale can slip between the staleness
    -- check and the post.
    select quantity into v_current
    from public.shop_stock
    where item_id = v_line.item_id and shop_id = v_take.shop_id
    for update;

    if exists (
         select 1 from public.stock_movements m
         where m.item_id = v_line.item_id
           and m.shop_id = v_take.shop_id
           and m.created_at > v_line.counted_at
       )
       or coalesce(v_current, 0) is distinct from v_line.expected_qty
    then
      update public.stock_take_lines set stale = true where id = v_line.id;
      v_stale := v_stale + 1;
      continue;
    end if;

    v_variance := v_line.counted_qty - v_line.expected_qty;
    if v_variance = 0 then
      v_verified := v_verified + 1;
      continue;
    end if;

    select c ->> 'reason', nullif(trim(c ->> 'note'), '')
    into v_reason, v_note
    from jsonb_array_elements(p_classifications) c
    where (c ->> 'line_id')::uuid = v_line.id;

    if v_reason is null
       or v_reason not in ('damaged', 'expired', 'other', 'unexplained') then
      raise exception 'every variance must be classified before approval';
    end if;

    update public.stock_take_lines
    set variance_reason = v_reason, variance_note = v_note
    where id = v_line.id;

    update public.shop_stock
    set quantity = quantity + v_variance, updated_at = now()
    where item_id = v_line.item_id and shop_id = v_take.shop_id
    returning quantity into v_new;

    -- The ADR-0004 assertion: a non-stale post lands stock exactly on the
    -- counted value (current = snapshot held under the row lock above).
    if v_new is distinct from v_line.counted_qty then
      raise exception 'stock take post drifted for item % (landed %, counted %)',
        v_line.item_id, v_new, v_line.counted_qty;
    end if;

    insert into public.stock_movements
      (item_id, shop_id, reason, amount, note, actor, take_line_id)
    values (
      v_line.item_id, v_take.shop_id, 'stock_take', v_variance,
      v_reason || coalesce(' — ' || v_note, ''),
      (select auth.uid()), v_line.id
    );
    v_posted := v_posted + 1;
  end loop;

  update public.stock_takes
  set status = 'approved', approved_at = now(), approved_by = (select auth.uid())
  where id = p_take_id;

  return jsonb_build_object(
    'posted', v_posted, 'verified', v_verified, 'stale', v_stale
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancelling widens (MP-37): the counter can still cancel their own *open*
-- session, and the Owner can now also reject a *submitted* one — status
-- `cancelled`, nothing posts, lines kept for the audit trail.
-- ---------------------------------------------------------------------------
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

  if v_take.status = 'submitted' then
    if not public.is_owner() then
      raise exception 'only the Owner can cancel a submitted stock take';
    end if;
  elsif v_take.status <> 'open' then
    raise exception 'this stock take is already settled';
  end if;

  update public.stock_takes
  set status = 'cancelled'
  where id = p_take_id;
end;
$$;

revoke execute on function public.approve_stock_take(uuid, jsonb) from public, anon;
grant execute on function public.approve_stock_take(uuid, jsonb) to authenticated;
