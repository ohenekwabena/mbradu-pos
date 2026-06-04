-- Business-wide settings (single row). Deliberately NOT per-Shop (ADR-0005):
-- one low-stock threshold applies to every Shop stock, plus one expiry window
-- and one currency. See CONTEXT.md (Business rules) and PRD.

create table if not exists public.shop_settings (
  -- singleton: the boolean PK forced to true means at most one row
  id boolean primary key default true,
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  expiry_warning_days integer not null default 30 check (expiry_warning_days >= 0),
  currency text not null default 'GHS' check (currency = 'GHS'),
  updated_at timestamptz not null default now(),
  constraint shop_settings_singleton check (id = true)
);

comment on table public.shop_settings is 'Single business-wide settings row (threshold/expiry/currency). ADR-0005.';

-- Seed the one row so the app always has settings to read.
insert into public.shop_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists shop_settings_touch_updated_at on public.shop_settings;
create trigger shop_settings_touch_updated_at
  before update on public.shop_settings
  for each row execute function public.touch_updated_at();

alter table public.shop_settings enable row level security;

-- Everyone authenticated reads settings (Cashiers need the low-stock threshold
-- and expiry window for stock-health display); only the Owner updates them.
drop policy if exists "Authenticated reads settings" on public.shop_settings;
create policy "Authenticated reads settings"
  on public.shop_settings for select to authenticated using (true);

drop policy if exists "Owner updates settings" on public.shop_settings;
create policy "Owner updates settings"
  on public.shop_settings for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
