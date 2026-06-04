-- Atomic create/edit of a cosmetic Product and its shade Items (MP-18). A
-- Product groups several cosmetic Items, each its own shade with a cost, price,
-- and attributes (shade / size / expiry). Only Cosmetics group under a Product
-- (CONTEXT.md, ADR-0002): the items_product_only_cosmetic CHECK enforces that,
-- and this function always writes category 'cosmetic'.
--
-- Why an RPC: writing a Product plus N shade Items is a multi-row write that
-- must be atomic — a half-written Product (orphaned, or shades duplicated when
-- a failed save is retried) would corrupt the catalog. So, like complete_sale
-- and record_restock, this is the single SECURITY DEFINER write path, Owner-
-- gated in the body. Field validation lives in app code (parseProductInput);
-- the table CHECKs are the backstop.
--
--   p_id:     the Product to update, or null to create a new one
--   p_brand:  optional brand (null/blank stored as null)
--   p_shades: jsonb array of
--             { id?: uuid, name, cost_pesewas, price_pesewas, attributes } —
--             an id present updates that shade Item, absent inserts a new one.
create or replace function public.save_cosmetic_product(
  p_id uuid,
  p_name text,
  p_brand text,
  p_shades jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_shade jsonb;
  v_item_id uuid;
begin
  if not public.is_owner() then
    raise exception 'only the Owner can manage the catalog';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'a product needs a name';
  end if;
  if p_shades is null or jsonb_array_length(p_shades) = 0 then
    raise exception 'a product needs at least one shade';
  end if;

  -- Upsert the Product itself.
  if p_id is null then
    insert into public.products (name, brand)
    values (btrim(p_name), nullif(btrim(coalesce(p_brand, '')), ''))
    returning id into v_product_id;
  else
    update public.products
    set name = btrim(p_name), brand = nullif(btrim(coalesce(p_brand, '')), '')
    where id = p_id
    returning id into v_product_id;
    if v_product_id is null then
      raise exception 'product % not found', p_id;
    end if;
  end if;

  -- Upsert each shade as a cosmetic Item under the Product.
  for v_shade in select * from jsonb_array_elements(p_shades)
  loop
    v_item_id := nullif(v_shade ->> 'id', '')::uuid;

    if v_item_id is null then
      insert into public.items
        (category, name, product_id, cost_pesewas, price_pesewas, attributes)
      values (
        'cosmetic',
        v_shade ->> 'name',
        v_product_id,
        coalesce((v_shade ->> 'cost_pesewas')::bigint, 0),
        (v_shade ->> 'price_pesewas')::bigint,
        coalesce(v_shade -> 'attributes', '{}'::jsonb)
      );
    else
      -- Scope the update to this Product, so an id from another Product can't
      -- be repointed by passing it in.
      update public.items
      set name = v_shade ->> 'name',
          cost_pesewas = coalesce((v_shade ->> 'cost_pesewas')::bigint, 0),
          price_pesewas = (v_shade ->> 'price_pesewas')::bigint,
          attributes = coalesce(v_shade -> 'attributes', '{}'::jsonb)
      where id = v_item_id and product_id = v_product_id;
      if not found then
        raise exception 'shade % does not belong to product %', v_item_id, v_product_id;
      end if;
    end if;
  end loop;

  return v_product_id;
end;
$$;

revoke execute on function public.save_cosmetic_product(uuid, text, text, jsonb) from public, anon;
grant execute on function public.save_cosmetic_product(uuid, text, text, jsonb) to authenticated;
