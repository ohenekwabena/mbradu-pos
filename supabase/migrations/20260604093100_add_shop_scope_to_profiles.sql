-- Bind Cashiers to a Shop and let the Owner manage staff. See ADR-0005 and
-- CONTEXT.md: each Cashier belongs to exactly one Shop; the Owner spans all
-- Shops (no home Shop) and may reassign a Cashier.

-- ---------------------------------------------------------------------------
-- profiles.shop_id: the Cashier's one Shop; null for the Owner. The invariant
-- (owner => null, cashier => set) is enforced by a check constraint. The first
-- Owner is created with role 'owner' and no shop, so the constraint holds.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists shop_id uuid references public.shops (id);

alter table public.profiles
  drop constraint if exists profiles_shop_matches_role;
alter table public.profiles
  add constraint profiles_shop_matches_role check (
    (role = 'owner'   and shop_id is null) or
    (role = 'cashier' and shop_id is not null)
  );

comment on column public.profiles.shop_id is
  'Cashier''s Shop (null for the Owner). Mutable by the Owner to reassign — past Sales keep their own shop_id.';

-- ---------------------------------------------------------------------------
-- Helper: the caller's Shop. SECURITY DEFINER, same rationale as auth_role().
-- ---------------------------------------------------------------------------
create or replace function public.auth_shop()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select shop_id from public.profiles where id = (select auth.uid());
$$;

revoke execute on function public.auth_shop() from public, anon;
grant execute on function public.auth_shop() to authenticated;

-- ---------------------------------------------------------------------------
-- A Cashier may read only their own Shop; the Owner already sees all (prior
-- migration). Adds to, not replaces, the Owner policy (policies OR together).
-- ---------------------------------------------------------------------------
drop policy if exists "Cashier reads own shop" on public.shops;
create policy "Cashier reads own shop"
  on public.shops
  for select
  to authenticated
  using (id = public.auth_shop());

-- ---------------------------------------------------------------------------
-- Owner can list all profiles (Staff screen) and update them (reassign Shop).
-- The existing "view own" policy stays for Cashiers. SELECT/UPDATE only — no
-- user-facing insert/delete (profiles are born from the auth trigger).
-- ---------------------------------------------------------------------------
drop policy if exists "Owner views all profiles" on public.profiles;
create policy "Owner views all profiles"
  on public.profiles
  for select
  to authenticated
  using (public.is_owner());

drop policy if exists "Owner updates profiles" on public.profiles;
create policy "Owner updates profiles"
  on public.profiles
  for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- handle_new_user now also reads shop_id from the signup metadata, so an
-- invited Cashier lands bound to their Shop. (Replaces the prior definition;
-- still SECURITY DEFINER with an empty search_path.)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name, shop_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'cashier'),
    new.raw_user_meta_data ->> 'full_name',
    (new.raw_user_meta_data ->> 'shop_id')::uuid
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
