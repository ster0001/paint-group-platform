-- =============================================================================
-- Product details + customer-facing paint cards
-- Extends products with the fields behind the "The paint we're supplying"
-- section on the customer estimate, plus staff-facing specs and a photo.
-- Creates a dedicated public `product-photos` storage bucket (staff-only write).
-- =============================================================================

alter table public.products
  add column if not exists brand              text,
  add column if not exists finish             text,
  add column if not exists category           text,
  add column if not exists internal_alias     text,
  add column if not exists blurb              text,
  add column if not exists properties         text[],
  add column if not exists guarantee          text,
  add column if not exists product_url        text,
  add column if not exists coverage_m2_per_l  text,
  add column if not exists recoat             text,
  add column if not exists customer_visible   boolean not null default false,
  add column if not exists photo_url          text;

-- Carry over any photo URLs from the earlier image_url column, if present.
update public.products set photo_url = image_url
  where photo_url is null and image_url is not null;

-- ---- Storage bucket for product photos (public read, staff-only write) -------
insert into storage.buckets (id, name, public)
  values ('product-photos', 'product-photos', true)
  on conflict (id) do nothing;

drop policy if exists "product_photos_read"   on storage.objects;
drop policy if exists "product_photos_insert" on storage.objects;
drop policy if exists "product_photos_update" on storage.objects;
drop policy if exists "product_photos_delete" on storage.objects;

create policy "product_photos_read" on storage.objects
  for select using (bucket_id = 'product-photos');
create policy "product_photos_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-photos' and public.is_staff());
create policy "product_photos_update" on storage.objects
  for update to authenticated using (bucket_id = 'product-photos' and public.is_staff());
create policy "product_photos_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'product-photos' and public.is_staff());
