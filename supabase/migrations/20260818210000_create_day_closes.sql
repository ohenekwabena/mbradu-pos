-- Day closes (ADR-0007, MP-40): a blind end-of-day cash reconciliation at one
-- Shop. The declarer (the Shop's Cashier, or the Owner in Shop context) counts
-- the physical drawer and declares the amount — no expected figure is ever
-- shown — and the server computes expected = the business-wide Float + that
-- day's cash Payments at the Shop, stores the Over/short, and judges the stale
-- rule. Over/short is Owner-only money (the cash-skim signal): the declarer
-- gets a success response, never a readback. A missing close never blocks
-- selling — complete_sale is untouched.

-- ---------------------------------------------------------------------------
-- day_closes: one close per Shop per business day. The Ghana business day is
-- the UTC calendar day (GMT year-round). Written only by record_day_close.
-- ---------------------------------------------------------------------------
create table if not exists public.day_closes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  close_date date not null,
  declared_pesewas bigint not null check (declared_pesewas >= 0),
  expected_pesewas bigint not null check (expected_pesewas >= 0),
  over_short_pesewas bigint not null,
  stale boolean not null default false,
  note text,
  actor uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (shop_id, close_date)
);

comment on table public.day_closes is
  'Blind Day close per (Shop, day): declared drawer cash vs server-computed expected (Float + day''s cash Payments). Over/short is Owner-only. ADR-0007.';
comment on column public.day_closes.over_short_pesewas is
  'declared - expected, signed: positive over, negative short. The cash-skim signal; Owner-only.';
comment on column public.day_closes.stale is
  'A Sale rang at the Shop after this day ended before the close was declared — recorded, never trusted (mirrors the Stock take''s stale rule).';

-- Over/short is Owner-only: SELECT for the Owner alone; no user-facing writes
-- (the SECURITY DEFINER RPC below is the only write path).
alter table public.day_closes enable row level security;

drop policy if exists "Owner reads day closes" on public.day_closes;
create policy "Owner reads day closes"
  on public.day_closes for select to authenticated using (public.is_owner());

-- ---------------------------------------------------------------------------
-- day_close_exists: the one fact the close screen may know — whether a (Shop,
-- day) is already closed — so the UI can say "recorded" without any money
-- readback. Guarded like the RPC: the Owner may ask about any Shop, a Cashier
-- only their own.
-- ---------------------------------------------------------------------------
create or replace function public.day_close_exists(
  p_shop_id uuid,
  p_close_date date
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() and public.auth_shop() is distinct from p_shop_id then
    raise exception 'not authorized to view closes at this shop';
  end if;
  return exists (
    select 1 from public.day_closes
    where shop_id = p_shop_id and close_date = p_close_date
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- record_day_close: the only write path. Authorization mirrors complete_sale
-- (Owner anywhere, Cashier at their own Shop). Everything the declarer never
-- sees is computed here: expected = the business-wide Float + the day's cash
-- Payments at the Shop (cash only — MoMo/Card/Bank reconcile against provider
-- statements outside the app), Over/short = declared - expected, and the
-- stale flag (any Sale at the Shop at/after the day's end means the drawer no
-- longer represents that day: still recorded, marked stale, never trusted).
-- One close per (Shop, day); a duplicate is rejected. Returns nothing — the
-- declarer sees only "recorded".
-- ---------------------------------------------------------------------------
create or replace function public.record_day_close(
  p_shop_id uuid,
  p_close_date date,
  p_declared bigint,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_float bigint;
  v_cash bigint;
  v_expected bigint;
  v_stale boolean;
begin
  if not public.is_owner() and public.auth_shop() is distinct from p_shop_id then
    raise exception 'not authorized to close the day at this shop';
  end if;
  if not exists (select 1 from public.shops where id = p_shop_id) then
    raise exception 'unknown shop';
  end if;
  if p_declared is null or p_declared < 0 then
    raise exception 'declared cash must be zero or more';
  end if;
  if p_close_date is null or p_close_date > v_today then
    raise exception 'cannot close a day that has not ended';
  end if;

  -- The Ghana business day is the UTC calendar day (GMT year-round).
  v_day_start := p_close_date::timestamp at time zone 'utc';
  v_day_end := v_day_start + interval '1 day';

  -- The business-wide Float (ADR-0007; single shop_settings row, ADR-0005).
  select coalesce(s.float_pesewas, 0) into v_float
  from public.shop_settings s
  where s.id = true;
  v_float := coalesce(v_float, 0); -- defensive: no settings row yet

  -- The day's recorded cash takings at this Shop. Cash only by design.
  select coalesce(sum(p.amount_pesewas), 0) into v_cash
  from public.payments p
  join public.sales s on s.id = p.sale_id
  where s.shop_id = p_shop_id
    and p.method = 'cash'
    and s.created_at >= v_day_start
    and s.created_at < v_day_end;

  v_expected := v_float + v_cash;

  -- Stale: the Shop's next Sale has already rung, so the drawer has taken new
  -- money since the day ended. Sales during the day never stale a close.
  v_stale := exists (
    select 1 from public.sales
    where shop_id = p_shop_id and created_at >= v_day_end
  );

  insert into public.day_closes
    (shop_id, close_date, declared_pesewas, expected_pesewas,
     over_short_pesewas, stale, note, actor)
  values
    (p_shop_id, p_close_date, p_declared, v_expected,
     p_declared - v_expected, v_stale, nullif(trim(p_note), ''), (select auth.uid()));
exception
  when unique_violation then
    raise exception 'this day is already closed for this shop';
end;
$$;

revoke execute on function public.day_close_exists(uuid, date) from public, anon;
revoke execute on function public.record_day_close(uuid, date, bigint, text) from public, anon;
grant execute on function public.day_close_exists(uuid, date) to authenticated;
grant execute on function public.record_day_close(uuid, date, bigint, text) to authenticated;
