-- A pass must have looked at every standard. A fail need not — the point of a
-- fail is to record what was wrong and get it back to the painter.
create or replace function public.wo_record_qa(
  p_check_id uuid, p_result text, p_notes text default '', p_rectify jsonb default '[]'
) returns text language plpgsql security definer set search_path = public as $$
declare v_c public.wo_qa_checks%rowtype; v_photos integer; v_min integer; v_thin boolean;
        v_added integer := 0; v_sort integer; v_r jsonb; v_left integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_result not in ('pass', 'fail') then return 'error:bad_result'; end if;

  select * into v_c from public.wo_qa_checks where id = p_check_id for update;
  if not found then return 'error:not_found'; end if;
  if v_c.result is not null then return 'error:already_' || v_c.result; end if;

  if p_result = 'pass' then
    v_left := public.wo_qa_outstanding(p_check_id);
    if v_left > 0 then return 'error:standards_outstanding:' || v_left::text; end if;
  end if;

  select count(*) into v_photos
    from public.wo_photos where work_order_id = v_c.work_order_id and kind = 'qa';

  v_min := coalesce((public.wo_loop_setting(array['photoMinimums','perQaCheck']))::text::integer, 3);
  v_thin := v_photos < v_min;

  update public.wo_qa_checks
     set result = p_result, notes = coalesce(p_notes, ''), checked_by = auth.uid(),
         checked_at = now(), photo_count = v_photos, thin_record = v_thin
   where id = p_check_id;

  if p_result = 'fail' then
    select coalesce(max(sort), 0) into v_sort
      from public.wo_surfaces where work_order_id = v_c.work_order_id;

    for v_r in select * from jsonb_array_elements(coalesce(p_rectify, '[]'::jsonb))
    loop
      v_sort := v_sort + 1;
      insert into public.wo_surfaces
          (work_order_id, heading, heading_meta, label, sort, rectification, source_ref)
        values (v_c.work_order_id, coalesce(v_r->>'heading', 'Rectification'), 'raised by QA',
                coalesce(v_r->>'label', 'Rectification'), v_sort, true, p_check_id);
      v_added := v_added + 1;
    end loop;

    perform public.wo_set_stage(v_c.work_order_id, 'in_progress', 'staff',
      jsonb_build_object('qa_check_id', p_check_id, 'rectifications', v_added, 'via', 'qa_fail'));
  end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_c.work_order_id, 'qa_' || p_result, auth.uid(), 'staff',
            jsonb_build_object('check_id', p_check_id, 'kind', v_c.kind,
                               'photos', v_photos, 'thin_record', v_thin,
                               'rectifications', v_added, 'notes', coalesce(p_notes, '')));

  return 'ok:' || p_result || case when v_thin then ':thin_record' else '' end;
end $$;
