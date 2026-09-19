-- =============================================================================
-- Tom, 19 Sep 2026: "Please approve the workmanship warranty terms as we
-- previously created - i am happy to proceed so remove watermark."
--
-- The customer's portal watermarks the warranty certificate and the full terms
-- with "DRAFT — AWAITING LEGAL REVIEW" until this settings row says approved
-- (lib/portal/data.ts → getPortalAftercare). Settings → Documents ticks the
-- same switch by hand; this file does it on both projects in one paste so the
-- repo, the test project and production agree.
--
-- The terms themselves live in lib/warranty/terms.ts (version 2026-09-19),
-- which is also what the customer now reads on their estimate. One change from
-- the August draft: clause 8 takes Option A — the warranty is personal to the
-- customer and DOES NOT transfer to a new owner.
--
-- No table, no policy, no grant: one row.
-- =============================================================================

insert into public.settings (key, value)
values (
  'warranty_terms',
  jsonb_build_object(
    'approved', true,
    'approvedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'approvedBy', 'Tom Roman',
    'version', '2026-09-19',
    'transferable', false)
)
on conflict (key) do update
  set value = settings.value || excluded.value,
      updated_at = now();

-- ---- read-back: what this file just made ------------------------------------
-- `approved` must be true. If it is false or this returns no row, the portal is
-- still watermarking the certificate and the terms.
select
  key,
  (value ->> 'approved')::boolean as approved,
  value ->> 'approvedAt'          as approved_at,
  value ->> 'version'             as terms_version,
  (value ->> 'transferable')::boolean as transferable
from public.settings
where key = 'warranty_terms';

insert into public._prod_migrations(name) values ('20270174000000_warranty_terms_approved.sql') on conflict (name) do nothing;
