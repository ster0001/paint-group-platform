-- 20270166 — the Preparation line's wording (Tom, 17 Sep 2026).
--
-- "Allowance for TIME/ materials for job site set up, fillers and consumables."
-- The line now carries the contractor's set-up hours as well as the
-- allowance (builder_state.preparationHours → lib/pricing preparationHours),
-- so the sentence says so. The app's constant changed in lib/customer/
-- snapshot.ts; this migration changes the two places SQL writes the same
-- sentence on an invoice line — the fallback description inside
-- invoice_write_snapshot_lines (20270156) — and rewords the DRAFT lines that
-- already carry the old sentence. Issued invoices are frozen documents and
-- keep the wording they were issued with.
--
-- Nothing else in invoice_write_snapshot_lines changes.

create or replace function public.invoice_write_snapshot_lines(
  p_invoice_id uuid, p_estimate_id uuid, p_sort_start integer, p_informational boolean
) returns integer language plpgsql security definer set search_path = public as $$
declare v_snap jsonb; v_sel jsonb; r jsonb; v_sort integer := p_sort_start;
        v_areas_ex bigint := 0; v_lines_ex bigint := 0; v_opts_ex bigint := 0;
        v_base bigint; v_sundries bigint; v_discount bigint := 0; v_line_ex bigint;
        v_prep bigint := 0; v_prep_desc text; v_pre_areas bigint := 0; v_pre_lines bigint := 0;
        v_prep_words constant text := 'Preparation — Allowance for time/ materials for job site set up, fillers and consumables.';
begin
  select coalesce(sent_snapshot, '{}'::jsonb), selected_options into v_snap, v_sel
    from public.estimates where id = p_estimate_id;
  if v_snap is null then return v_sort; end if;

  -- The Preparation line FIRST. From the snapshot's own entry when it has one;
  -- for a snapshot sent before the line existed, the residual of the base
  -- subtotal over the itemised areas and line items IS that allowance.
  v_prep := coalesce((v_snap->'preparation'->>'priceCents')::bigint, 0);
  if v_prep > 0 then
    v_prep_desc := coalesce(nullif(v_snap->'preparation'->>'title', ''), 'Preparation') ||
      case when public.invoice_strip_html(v_snap->'preparation'->>'descriptionHtml') <> ''
           then ' — ' || public.invoice_strip_html(v_snap->'preparation'->>'descriptionHtml') else '' end;
  else
    select coalesce(sum(coalesce((a->>'priceCents')::bigint, 0)), 0) into v_pre_areas
      from jsonb_array_elements(coalesce(v_snap->'areas', '[]'::jsonb)) a;
    select coalesce(sum(coalesce((l->>'priceCents')::bigint, 0)), 0) into v_pre_lines
      from jsonb_array_elements(coalesce(v_snap->'lineItems', '[]'::jsonb)) l;
    v_prep := coalesce((v_snap->>'baseSubtotalCents')::bigint, v_pre_areas + v_pre_lines) - v_pre_areas - v_pre_lines;
    v_prep_desc := v_prep_words;
  end if;
  if v_prep > 0 then
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents, informational)
      values (p_invoice_id, v_sort, 'estimate_snapshot', 'preparation', v_prep_desc, v_prep::integer, p_informational);
    v_sort := v_sort + 1;
  else
    v_prep := 0;
  end if;

  -- Areas and line items, as the customer saw them (ex GST).
  for r in select value from jsonb_array_elements(coalesce(v_snap->'areas', '[]'::jsonb))
  loop
    v_line_ex := coalesce((r->>'priceCents')::bigint, 0);
    v_areas_ex := v_areas_ex + v_line_ex;
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents, informational)
      values (p_invoice_id, v_sort, 'estimate_snapshot', r->>'id',
              coalesce(r->>'title', '') ||
              case when public.invoice_strip_html(r->>'descriptionHtml') <> ''
                   then ' — ' || public.invoice_strip_html(r->>'descriptionHtml') else '' end,
              v_line_ex::integer, p_informational);
    v_sort := v_sort + 1;
  end loop;

  for r in select value from jsonb_array_elements(coalesce(v_snap->'lineItems', '[]'::jsonb))
  loop
    v_line_ex := coalesce((r->>'priceCents')::bigint, 0);
    v_lines_ex := v_lines_ex + v_line_ex;
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents, informational)
      values (p_invoice_id, v_sort, 'estimate_snapshot', r->>'id',
              coalesce(r->>'title', '') ||
              case when public.invoice_strip_html(r->>'descriptionHtml') <> ''
                   then ' — ' || public.invoice_strip_html(r->>'descriptionHtml') else '' end,
              v_line_ex::integer, p_informational);
    v_sort := v_sort + 1;
  end loop;

  -- baseSubtotalCents = preparation + included items (ex GST). Anything the
  -- lines above still don't account for is written as a further Preparation
  -- line so the invoice always reconciles to the accepted subtotal.
  v_base := coalesce((v_snap->>'baseSubtotalCents')::bigint, v_prep + v_areas_ex + v_lines_ex);
  v_sundries := v_base - v_prep - v_areas_ex - v_lines_ex;
  if v_sundries > 0 then
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents, informational)
      values (p_invoice_id, v_sort, 'estimate_snapshot', 'preparation', v_prep_words, v_sundries::integer, p_informational);
    v_sort := v_sort + 1;
  end if;

  -- The options the customer selected at acceptance. (Hardened: an
  -- object-shaped selected_options counts as "none selected", not an error.)
  for r in select value from jsonb_array_elements(coalesce(v_snap->'options', '[]'::jsonb))
            where (value->>'id') in (
              select jsonb_array_elements_text(
                case when jsonb_typeof(v_sel) = 'array'
                     then v_sel else '[]'::jsonb end))
  loop
    v_line_ex := coalesce((r->>'priceCents')::bigint, 0);
    v_opts_ex := v_opts_ex + v_line_ex;
    insert into public.invoice_lines (invoice_id, sort, source, source_ref, description, amount_ex_cents, informational)
      values (p_invoice_id, v_sort, 'estimate_snapshot', r->>'id',
              coalesce(r->>'title', '') || ' (selected option)', v_line_ex::integer, p_informational);
    v_sort := v_sort + 1;
  end loop;

  -- Discount, as the snapshot carried it.
  if coalesce(v_snap->>'discountMode', '') = 'fixed' then
    v_discount := least(coalesce((v_snap->>'discountFixedCents')::bigint, 0), v_base + v_opts_ex);
  else
    v_discount := round((v_base + v_opts_ex) * coalesce((v_snap->>'discountPct')::numeric, 0) / 100);
  end if;
  if v_discount > 0 then
    insert into public.invoice_lines (invoice_id, sort, source, description, amount_ex_cents, informational)
      values (p_invoice_id, v_sort, 'estimate_snapshot', 'Discount', (-v_discount)::integer, p_informational);
    v_sort := v_sort + 1;
  end if;

  return v_sort;
end $$;

revoke execute on function public.invoice_write_snapshot_lines(uuid, uuid, integer, boolean) from public, anon, authenticated;

-- Draft lines only: an issued invoice is frozen and keeps its wording.
update public.invoice_lines l
   set description = replace(l.description,
        'Allowance for materials for job site set up, fillers and consumables',
        'Allowance for time/ materials for job site set up, fillers and consumables')
  from public.invoices i
 where i.id = l.invoice_id and i.status = 'draft'
   and l.description like '%Allowance for materials for job site set up, fillers and consumables%';

-- Read-back. Read it; do not assume it.
select
  (select prosrc like '%Allowance for time/ materials%' from pg_proc where proname = 'invoice_write_snapshot_lines') as helper_reworded,
  (select prosrc not like '%Allowance for materials for job site%' from pg_proc where proname = 'invoice_write_snapshot_lines') as old_words_gone,
  (select count(*) from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
     where i.status = 'draft' and l.description like '%Allowance for materials for job site%') as draft_lines_still_old;

insert into public._prod_migrations(name) values ('20270166000000_preparation_wording_time.sql') on conflict (name) do nothing;
