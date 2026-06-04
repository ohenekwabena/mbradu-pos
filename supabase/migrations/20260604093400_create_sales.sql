-- Sales and their line items / payments. Immutable once written and scoped to
-- one Shop (ADR-0005, CONTEXT.md). Sales are written ONLY by the complete_sale
-- RPC (next migration), so these tables expose SELECT policies only — no
-- user-facing insert/update/delete (immutability + atomic write).

-- ---------------------------------------------------------------------------
-- sales: a completed transaction at one Shop. shop_id is fixed at completion.
-- ---------------------------------------------------------------------------
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id),
  seller uuid not null references auth.users (id),
  customer_name text,
  total_pesewas bigint not null check (total_pesewas >= 0),
  created_at timestamptz not null default now()
);

comment on table public.sales is 'Immutable Sale at sales.shop_id, by seller (Cashier or Owner). ADR-0005.';

create index if not exists sales_shop_created_idx on public.sales (shop_id, created_at desc);
create index if not exists sales_seller_idx on public.sales (seller);

alter table public.sales enable row level security;

drop policy if exists "Owner reads all sales" on public.sales;
create policy "Owner reads all sales"
  on public.sales for select to authenticated using (public.is_owner());

drop policy if exists "Cashier reads own shop sales" on public.sales;
create policy "Cashier reads own shop sales"
  on public.sales for select to authenticated
  using (shop_id = public.auth_shop());

-- ---------------------------------------------------------------------------
-- sale_line_items: one Item + quantity, unit price captured at sale time.
-- ---------------------------------------------------------------------------
create table if not exists public.sale_line_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  item_id uuid not null references public.items (id),
  quantity integer not null check (quantity > 0),
  unit_price_pesewas bigint not null check (unit_price_pesewas >= 0)
);

create index if not exists sale_line_items_sale_idx on public.sale_line_items (sale_id);
create index if not exists sale_line_items_item_idx on public.sale_line_items (item_id);

alter table public.sale_line_items enable row level security;

-- Visible iff the parent Sale is visible to the caller.
drop policy if exists "Read line items of visible sales" on public.sale_line_items;
create policy "Read line items of visible sales"
  on public.sale_line_items for select to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.sales s
      where s.id = sale_line_items.sale_id and s.shop_id = public.auth_shop()
    )
  );

-- ---------------------------------------------------------------------------
-- payments: one row per method; rows sum to the Sale total. Recorded only.
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  method text not null check (method in ('cash', 'momo', 'card', 'transfer')),
  amount_pesewas bigint not null check (amount_pesewas >= 0)
);

create index if not exists payments_sale_idx on public.payments (sale_id);

alter table public.payments enable row level security;

drop policy if exists "Read payments of visible sales" on public.payments;
create policy "Read payments of visible sales"
  on public.payments for select to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.sales s
      where s.id = payments.sale_id and s.shop_id = public.auth_shop()
    )
  );
