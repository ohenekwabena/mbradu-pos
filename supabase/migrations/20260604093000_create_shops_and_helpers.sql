-- Shops + shared RLS helpers. See ADR-0005 (Shop-scoped multi-tenancy) and
-- CONTEXT.md (Shop, Owner, Cashier). A Shop is the unit that scopes stock,
-- sales, staff, and a Cashier's view; the single Owner spans all Shops.

-- ---------------------------------------------------------------------------
-- Helper: touch updated_at. Generic BEFORE UPDATE trigger reused below.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers: the caller's POS role and "is the caller the Owner?".
-- SECURITY DEFINER so policies on other tables can read profiles without
-- tripping that table's own RLS (and without recursion). These read only the
-- caller's own row, so exposing them to authenticated is harmless.
-- ---------------------------------------------------------------------------
create or replace function public.auth_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() = 'owner', false);
$$;

revoke execute on function public.auth_role() from public, anon;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.is_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- shops: one physical sales location. Owner-managed; opened, not retired (v1).
-- ---------------------------------------------------------------------------
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,                 -- optional; shown on receipts (design §10.5)
  phone text,                   -- optional; shown on receipts
  created_at timestamptz not null default now()
);

comment on table public.shops is 'A Shop: scopes stock, sales, staff, settings context. ADR-0005.';

alter table public.shops enable row level security;

-- The Owner can see and manage every Shop. (A Cashier's read of their own Shop
-- is added in the next migration, once profiles.shop_id exists.) No delete
-- policy: Shops are not closed/deactivated in v1 (ADR-0005 non-goal).
drop policy if exists "Owner manages all shops" on public.shops;
create policy "Owner manages all shops"
  on public.shops
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());
