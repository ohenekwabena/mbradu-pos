-- The Float (ADR-0007): the fixed cash that stays in every Shop's drawer
-- overnight to make change. One business-wide amount on the singleton
-- shop_settings row — deliberately NOT per-Shop, consistent with the one-row
-- settings rule (ADR-0005); revisit only if Shops' change needs diverge.
-- Integer pesewas in a bigint, like every money column. The Day-close slice
-- (MP-40) consumes it: expected drawer cash = Float + the day's cash Payments.
-- Cash leaves the drawer only at Day close (documented operational rule).
-- No RLS change: everyone authenticated reads settings, Owner updates. MP-36.

alter table public.shop_settings
  add column if not exists float_pesewas bigint not null default 0
    check (float_pesewas >= 0);

comment on column public.shop_settings.float_pesewas is
  'Business-wide drawer Float in pesewas (ADR-0007): the fixed change cash left in every drawer overnight. Day-close expected cash = Float + the day''s cash Payments.';
