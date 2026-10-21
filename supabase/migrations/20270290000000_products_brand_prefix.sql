-- =============================================================================
-- One paint order per brand, second cut (Tom, 21 Oct 2026). 20270287 inferred a blank brand
-- from the FIRST WORD of the product name, so a two-word brand (Haymes Paint, Dulux Trade)
-- never matched and the five blank products stayed blank. Now the longest prefix of the name,
-- one to four words, that is a known brand wins. Same trigger, same backfill, converging.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.products_infer_brand(p_name text, p_brand text)
returns text language plpgsql stable set search_path = public as $$
declare v text; words text[]; n int; k int; best text := null;
begin
  if coalesce(btrim(p_brand), '') <> '' then
    v := public.products_canonical_brand(p_brand);
    return coalesce(v, btrim(p_brand));
  end if;
  words := regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+');
  n := least(4, coalesce(array_length(words, 1), 0));
  for k in 1..n loop
    v := public.products_canonical_brand(array_to_string(words[1:k], ' '));
    if v is not null then best := v; end if;
  end loop;
  return best;
end $$;
revoke all on function public.products_infer_brand(text, text) from public, authenticated, anon;

update public.products p set brand = public.products_infer_brand(p.name, p.brand)
 where public.products_infer_brand(p.name, p.brand) is distinct from p.brand
   and public.products_infer_brand(p.name, p.brand) is not null;

-- ---- read-back: compare to the _expect_ values before calling this live ------------------
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'products_infer_brand') as infer_fn, 1 as _expect_infer_fn,
  (select count(*) from public.products where coalesce(btrim(brand), '') = '') as products_without_brand;

insert into public._prod_migrations(name) values ('20270290000000_products_brand_prefix.sql') on conflict (name) do nothing;
