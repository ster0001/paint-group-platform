-- =====================================================================
-- A2-02 · The rate card was saved by a loop in the browser.
--
-- app/(app)/settings/EditableTable.tsx wrote row by row:
--
--   for (const r of toSave) {
--     if (r.__new) await supabase.from(table).insert(payload(r))
--     else        await supabase.from(table).update(payload(r)).eq("id", r.id)
--   }
--
-- Each iteration its own round trip, failures collected per row. A failure
-- partway leaves the rate card HALF SAVED — some rows at the new prices, some
-- at the old, no rollback, and every estimate priced afterwards uses the
-- mixture. CLAUDE.md, verbatim:
--
--   Multi-step money operations (repricing cascades, invoice generation,
--   variation approval) run in a single Postgres transaction via an RPC —
--   never as sequential client calls.
--
-- Editing the rate card is a repricing operation. This is that RPC.
--
-- ONE function, an explicit table allowlist, and a single transaction: either
-- every row lands or none does. The allowlist is what makes a table name from
-- the client safe — the name is compared against a fixed set and then used
-- through format(%I), never concatenated.
--
-- Staff only, and it re-checks that itself rather than trusting the caller.
-- =====================================================================

create or replace function public.save_settings_rows(
  p_table text,
  p_rows  jsonb   -- [{ id?: uuid, ...columns }] — id absent means insert
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed constant text[] := array[
    'rate_items', 'modifiers', 'room_type_scope_rules',
    'room_type_defaults', 'area_names', 'area_name_presets'
  ];
  v_row      jsonb;
  v_key      text;
  v_type     text;
  v_lit      text;
  v_cols     text[];
  v_vals     text[];
  v_sets     text[];
  v_id       uuid;
  v_inserted int  := 0;
  v_updated  int  := 0;
  v_new_ids  jsonb := '[]'::jsonb;
  v_ret      uuid;
  v_count    int;
begin
  if not public.is_staff() then
    raise exception 'not_staff';
  end if;

  if not (p_table = any (v_allowed)) then
    raise exception 'table_not_allowed: %', p_table;
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'rows_must_be_an_array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_id   := nullif(v_row->>'id', '')::uuid;
    v_cols := '{}'; v_vals := '{}'; v_sets := '{}';

    for v_key in select k from jsonb_object_keys(v_row) k where k <> 'id'
    loop
      -- Every value is cast to the column's DECLARED type. Extracting with
      -- #>> yields text, and Postgres will not implicitly cast text to an enum,
      -- a uuid or a numeric — area_names.type is an enum, and the first cut of
      -- this function failed on exactly that. Looking the type up also means an
      -- unknown key RAISES instead of being silently dropped: a price that
      -- fails to save while the screen says "Saved ✓" is the whole class of
      -- bug this RPC exists to remove.
      select format_type(a.atttypid, a.atttypmod) into v_type
        from pg_attribute a
       where a.attrelid = format('public.%I', p_table)::regclass
         and a.attname  = v_key
         and a.attnum   > 0
         and not a.attisdropped;

      if v_type is null then
        raise exception 'unknown_column: %.%', p_table, v_key;
      end if;

      if jsonb_typeof(v_row -> v_key) = 'null' then
        v_lit := 'null';
      else
        v_lit := format('%L::%s', v_row #>> array[v_key], v_type);
      end if;

      v_cols := v_cols || format('%I', v_key);
      v_vals := v_vals || v_lit;
      v_sets := v_sets || format('%I = %s', v_key, v_lit);
    end loop;

    if array_length(v_cols, 1) is null then
      continue;  -- a row carrying nothing but an id: nothing to do
    end if;

    if v_id is null then
      execute format('insert into public.%I (%s) values (%s) returning id',
                     p_table, array_to_string(v_cols, ', '), array_to_string(v_vals, ', '))
        into v_ret;
      v_inserted := v_inserted + 1;
      v_new_ids  := v_new_ids || to_jsonb(v_ret);
    else
      execute format('update public.%I set %s where id = %L',
                     p_table, array_to_string(v_sets, ', '), v_id);
      -- GET DIAGNOSTICS, not FOUND. EXECUTE does NOT set FOUND — it was still
      -- true from the SELECT INTO above, so an update matching no rows reported
      -- success and the atomicity test caught it. An id that no longer exists
      -- must fail the whole batch, not be silently skipped: that is someone
      -- editing a row another session deleted.
      get diagnostics v_count = row_count;
      if v_count = 0 then
        raise exception 'row_not_found: %', v_id;
      end if;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'newIds', v_new_ids);
end $$;

revoke execute on function public.save_settings_rows(text, jsonb) from public, anon;
grant  execute on function public.save_settings_rows(text, jsonb) to authenticated;

-- Readback: CLAUDE.md's rule — a migration that creates a function ends with a
-- select that lists what it made, and that output gets READ, not assumed.
select p.proname,
       p.prosecdef                        as security_definer,
       p.proconfig                        as settings,
       pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'save_settings_rows';
