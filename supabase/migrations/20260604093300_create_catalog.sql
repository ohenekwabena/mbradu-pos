-- Business-wide catalog: Products and Items. See ADR-0002 (one Item model) and
-- ADR-0005 (catalog is business-wide; price/cost on the Item, stock per Shop).
-- NB: there is no quantity column on items — stock lives on shop_stock.

-- ---------------------------------------------------------------------------
-- products: optional grouping for a cosmetic shade line (cosmetics only).
-- No sensitive data, so any authenticated user may read it; Owner writes.
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  created_at timestamptz not null default now()
);

comment on table public.products is 'Groups cosmetic shade Items (ADR-0002). Wigs and wig tools never group.';

alter table public.products enable row level security;

drop policy if exists "Authenticated reads products" on public.products;
create policy "Authenticated reads products"
  on public.products for select to authenticated using (true);

drop policy if exists "Owner writes products" on public.products;
create policy "Owner writes products"
  on public.products for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- items: the priced/sold catalog unit. Money is integer pesewas (PRD).
-- category drives attributes; only cosmetics may belong to a product.
-- ---------------------------------------------------------------------------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('wig', 'cosmetic', 'wig_tool')),
  name text not null,
  product_id uuid references public.products (id),
  cost_pesewas bigint not null default 0 check (cost_pesewas >= 0),
  price_pesewas bigint not null check (price_pesewas >= 0),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- only cosmetics group under a Product (CONTEXT.md)
  constraint items_product_only_cosmetic
    check (product_id is null or category = 'cosmetic')
);

comment on table public.items is 'Business-wide catalog Item. cost_pesewas is Owner-only — read via items_catalog, never directly.';

create index if not exists items_product_id_idx on public.items (product_id);
create index if not exists items_category_idx on public.items (category);

drop trigger if exists items_touch_updated_at on public.items;
create trigger items_touch_updated_at
  before update on public.items
  for each row execute function public.touch_updated_at();

alter table public.items enable row level security;

-- Only the Owner writes the catalog. There is deliberately NO base-table SELECT
-- policy for Cashiers: everyone reads through the items_catalog view below,
-- which masks cost. The Owner's write path (insert/update/delete) is gated here.
drop policy if exists "Owner writes items" on public.items;
create policy "Owner writes items"
  on public.items for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Cost visibility (PRD: hide cost/margin from Cashiers at the COLUMN level via
-- a restricted view — RLS alone can't, and column GRANTs can't either, because
-- Owner and Cashier share the one `authenticated` Postgres role). So: revoke
-- direct SELECT on the base table and expose a view that returns cost_pesewas
-- only when the caller is the Owner.
--
-- The view is SECURITY DEFINER (security_invoker = off) on purpose: it bypasses
-- the base table (catalog is global — every shop sees the same Items) and does
-- the role-based masking itself. Supabase's linter flags SECURITY DEFINER views;
-- this one is intentional and is the cost-hiding mechanism. is_owner() still
-- reflects the real caller (auth.uid() is session-scoped, not the definer).
--
-- Cost is hidden at the COLUMN level: revoke the blanket SELECT, then grant
-- SELECT on every column EXCEPT cost_pesewas. Owner and Cashier share the one
-- `authenticated` role, so neither can read cost from the base table — the Owner
-- reads it only through the masked view. The non-cost grant is what still lets
-- the Owner run catalog UPDATEs (whose WHERE/SET reference id, name, price, …).
-- ---------------------------------------------------------------------------
revoke select on public.items from anon, authenticated;
grant select (id, category, name, product_id, price_pesewas, attributes, created_at, updated_at)
  on public.items to authenticated;
grant insert, update, delete on public.items to authenticated;  -- RLS gates to Owner

create or replace view public.items_catalog
with (security_invoker = off) as
  select
    i.id, i.category, i.name, i.product_id,
    i.price_pesewas, i.attributes, i.created_at, i.updated_at,
    case when public.is_owner() then i.cost_pesewas else null end as cost_pesewas
  from public.items i;

comment on view public.items_catalog is
  'Read path for Items. Masks cost_pesewas (Owner-only). All catalog rows visible; carried-by-shop filtering is a join to shop_stock.';

grant select on public.items_catalog to authenticated;
