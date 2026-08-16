-- =============================================================================
-- Colours library (Phase A)
-- A staff-managed colour library for visual colour picking. Colorbond is the full
-- public range; the paint brands are a curated set of the most-specified whites,
-- neutrals and popular colours. HEX values are APPROXIMATE / indicative — on-screen
-- colour is a guide only; confirm with a physical sample. Staff add their own.
-- =============================================================================

create table if not exists public.colours (
  id          uuid primary key default gen_random_uuid(),
  brand       text not null,
  name        text not null,
  code        text,
  hex         text not null,
  collection  text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists colours_brand_idx on public.colours (brand);

alter table public.colours enable row level security;
drop policy if exists colours_staff on public.colours;
create policy colours_staff on public.colours
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Seed only if empty (idempotent-ish: won't duplicate on re-run of a populated table).
insert into public.colours (brand, name, hex, collection)
select v.brand, v.name, v.hex, v.collection
from (values
  -- Colorbond (full standard range)
  ('Colorbond','Surfmist','#E5E2D6','Colorbond'),
  ('Colorbond','Southerly','#D5D4CC','Colorbond'),
  ('Colorbond','Dune','#B7B1A3','Colorbond'),
  ('Colorbond','Evening Haze','#C8C3AC','Colorbond'),
  ('Colorbond','Shale Grey','#BDBFB4','Colorbond'),
  ('Colorbond','Windspray','#999B99','Colorbond'),
  ('Colorbond','Bushland','#82826E','Colorbond'),
  ('Colorbond','Gully','#7C7869','Colorbond'),
  ('Colorbond','Jasper','#6E6256','Colorbond'),
  ('Colorbond','Paperbark','#CDC3A8','Colorbond'),
  ('Colorbond','Woodland Grey','#4F5450','Colorbond'),
  ('Colorbond','Wallaby','#83817A','Colorbond'),
  ('Colorbond','Cove','#C2BCAF','Colorbond'),
  ('Colorbond','Basalt','#6A6C6E','Colorbond'),
  ('Colorbond','Monument','#35373A','Colorbond'),
  ('Colorbond','Ironstone','#464B52','Colorbond'),
  ('Colorbond','Deep Ocean','#3B4657','Colorbond'),
  ('Colorbond','Cottage Green','#34433A','Colorbond'),
  ('Colorbond','Manor Red','#66201B','Colorbond'),
  ('Colorbond','Pale Eucalypt','#7A8471','Colorbond'),
  ('Colorbond','Mangrove','#4A473E','Colorbond'),
  ('Colorbond','Night Sky','#14151A','Colorbond'),
  -- Dulux — whites & neutrals + popular
  ('Dulux','Vivid White','#F6F5F0','Whites & Neutrals'),
  ('Dulux','Natural White','#EFEADB','Whites & Neutrals'),
  ('Dulux','Lexicon','#ECEEEC','Whites & Neutrals'),
  ('Dulux','Lexicon Quarter','#F0F1EE','Whites & Neutrals'),
  ('Dulux','Antique White U.S.A.','#E7E0D0','Whites & Neutrals'),
  ('Dulux','White Duck','#E5E0D2','Whites & Neutrals'),
  ('Dulux','White Duck Half','#EBE7DB','Whites & Neutrals'),
  ('Dulux','Whisper White','#EEE9DC','Whites & Neutrals'),
  ('Dulux','Casper White Quarter','#E3E2DB','Whites & Neutrals'),
  ('Dulux','Hog Bristle Quarter','#E6E0CD','Whites & Neutrals'),
  ('Dulux','Hog Bristle','#D8CFB6','Whites & Neutrals'),
  ('Dulux','Terrace White','#EAE5D6','Whites & Neutrals'),
  ('Dulux','Snowy Mountains Half','#EEEBE1','Whites & Neutrals'),
  ('Dulux','Ghosting','#DDDAD0','Whites & Neutrals'),
  ('Dulux','Silver Feather','#D2CFC5','Whites & Neutrals'),
  ('Dulux','Milton Half','#C9C5B8','Whites & Neutrals'),
  ('Dulux','Beige Royal','#C8BCA0','Whites & Neutrals'),
  ('Dulux','Tranquil Retreat','#C9C7BC','Whites & Neutrals'),
  ('Dulux','Klavier','#8C8B85','Popular greys'),
  ('Dulux','Dieskau','#6F6E68','Popular greys'),
  ('Dulux','Namadji','#6B6A5F','Popular greys'),
  ('Dulux','Colorbond Monument','#4A4C4E','Popular greys'),
  ('Dulux','Domino','#3C3C3E','Popular darks'),
  ('Dulux','Grand Piano','#2F2F2F','Popular darks'),
  ('Dulux','Western Myall','#5B5347','Popular colours'),
  ('Dulux','Timeless Grey','#B5B2A9','Popular greys'),
  -- Haymes — whites & neutrals + popular
  ('Haymes','Natural White','#EFE9DB','Whites & Neutrals'),
  ('Haymes','Whitewash','#ECE7D8','Whites & Neutrals'),
  ('Haymes','Greyology 1','#E6E4DD','Greyology'),
  ('Haymes','Greyology 3','#C9C6BC','Greyology'),
  ('Haymes','Greyology 5','#A6A399','Greyology'),
  ('Haymes','Popcorn','#E8E1CE','Whites & Neutrals'),
  ('Haymes','Linen','#E3DCC8','Whites & Neutrals'),
  ('Haymes','Ecru','#DED6C0','Whites & Neutrals'),
  ('Haymes','Klein','#C6C0B0','Whites & Neutrals'),
  ('Haymes','Sandstorm','#CFC4A9','Whites & Neutrals'),
  ('Haymes','Cool Grey','#B8B8B2','Popular greys'),
  ('Haymes','Mid Grey','#9A9890','Popular greys'),
  ('Haymes','Domain','#7E7C74','Popular greys'),
  ('Haymes','Ironbark','#5A574F','Popular darks'),
  ('Haymes','Charcoal','#3A3A38','Popular darks'),
  -- Taubmans — whites & neutrals + popular
  ('Taubmans','Crisp White','#F4F3EE','Whites & Neutrals'),
  ('Taubmans','White on White','#EFEEE7','Whites & Neutrals'),
  ('Taubmans','Ceiling White','#F2F1EC','Whites & Neutrals'),
  ('Taubmans','Cotton Balls','#ECE7D9','Whites & Neutrals'),
  ('Taubmans','Chalk U.S.A.','#E6E1D2','Whites & Neutrals'),
  ('Taubmans','Antique White U.S.A.','#E7E0D0','Whites & Neutrals'),
  ('Taubmans','Silent Ivory','#E9E2CF','Whites & Neutrals'),
  ('Taubmans','Bone White','#E5DFCC','Whites & Neutrals'),
  ('Taubmans','Grey Pebble','#C7C3B8','Popular greys'),
  ('Taubmans','Tranquil','#CFCCC2','Popular greys'),
  ('Taubmans','Stormy Grey','#9A9A94','Popular greys'),
  ('Taubmans','Fencer Grey','#7F7F79','Popular greys'),
  ('Taubmans','Deep Bassinet','#5B5A54','Popular darks'),
  ('Taubmans','Endless Dusk','#4C4B47','Popular darks')
) as v(brand, name, hex, collection)
where not exists (select 1 from public.colours);
