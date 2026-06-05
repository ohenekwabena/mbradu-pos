-- MP-30: soft, reversible deactivation for staff.
--
-- A nullable timestamp on profiles: null = active, set = deactivated. A
-- deactivated Cashier can no longer sign in or sell — enforced in the app's
-- per-request auth check (`getCurrentProfile`, lib/dal) and at the login front
-- door — while their past Sales are untouched (a Sale's seller and shop are
-- fixed at completion). Reversible: the Owner clears the column to reactivate.
--
-- No new policy is needed: the Owner sets/clears this through the existing
-- "Owner updates profiles" RLS policy (…_add_shop_scope_to_profiles.sql), which
-- is the server-side proof that only the Owner can deactivate. The column is
-- nullable with no default, so every existing profile reads as active.

alter table public.profiles
  add column if not exists deactivated_at timestamptz;

comment on column public.profiles.deactivated_at is
  'When the Owner deactivated this Cashier (null = active). A set value blocks sign-in and selling; cleared on reactivate. Past Sales are preserved. MP-30.';
