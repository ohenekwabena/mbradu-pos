-- Profiles: one row per auth user, carrying the POS role (owner | cashier).
-- See ADR-0001 (Supabase backend) and CONTEXT.md (Owner vs Cashier).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'cashier' check (role in ('owner', 'cashier')),
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'POS profile per auth user; role is owner or cashier.';

-- Auto-create a profile whenever an auth user is created. Role/full name are
-- read from the user''s metadata, defaulting to cashier. SECURITY DEFINER so it
-- can write through RLS; empty search_path per Supabase security guidance.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'cashier'),
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row-level security: a user may read only their own profile. Inserts happen via
-- the SECURITY DEFINER trigger; no user-facing insert/update/delete in v1, which
-- also prevents a cashier from escalating their own role.
alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by the owning user" on public.profiles;
create policy "Profiles are viewable by the owning user"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);
