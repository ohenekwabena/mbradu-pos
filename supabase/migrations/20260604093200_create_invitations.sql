-- Invitations: the Owner authorizes a Cashier to sign up into a specific Shop.
-- See CONTEXT.md (Invitation) and ADR-0003 (custom email OTP login).

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  shop_id uuid not null references public.shops (id),
  invited_by uuid not null references auth.users (id),
  token text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

comment on table public.invitations is
  'Owner-issued authorization to sign up as a Cashier into invitations.shop_id.';

create index if not exists invitations_shop_id_idx on public.invitations (shop_id);
create index if not exists invitations_email_idx on public.invitations (email);

alter table public.invitations enable row level security;

-- Only the Owner manages invitations (issue / resend / cancel / list).
drop policy if exists "Owner manages invitations" on public.invitations;
create policy "Owner manages invitations"
  on public.invitations
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- The invitation sign-up page (§10.2) is public and token-gated: it must show
-- the invited email and the Shop being joined WITHOUT exposing the table to
-- anon. This SECURITY DEFINER lookup returns only a pending, unexpired
-- invitation's minimal fields, by exact token.
-- ---------------------------------------------------------------------------
create or replace function public.invitation_for_token(p_token text)
returns table (email text, shop_id uuid, shop_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.email, i.shop_id, s.name
  from public.invitations i
  join public.shops s on s.id = i.shop_id
  where i.token = p_token
    and i.status = 'pending'
    and (i.expires_at is null or i.expires_at > now());
$$;

revoke execute on function public.invitation_for_token(text) from public;
grant execute on function public.invitation_for_token(text) to anon, authenticated;
