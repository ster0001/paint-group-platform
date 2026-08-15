-- =============================================================================
-- Product photos
-- Every product can carry a photo (paint tin / colour swatch). Images are stored
-- in the existing public `estimate-media` bucket under a `products/` prefix; this
-- column just holds the public URL so it can be shown on estimates later.
-- =============================================================================

alter table public.products add column if not exists image_url text;
