-- CRM v2 · Phase 5 — campaigns with real rules (deep dive §4.3, decisions 8.1, 8.9).
--
-- What this adds, in the order the office meets it:
--
--   1. Audience facts. The rules read crm_account_facts in SQL, so every fact a
--      rule can ask about must be a column there. New: last_sent_at,
--      last_estimate_status, last_accepted_at, last_declined_at, decline_reason,
--      job_types (from ANY estimate, not just won work), quoted_cents,
--      dwell_seconds, invoice_state / invoice_due_on, campaigns_received,
--      last_inbound_at / last_inbound_call_at (they wrote or rang),
--      last_staff_contact_at (a person logged a call, email or text).
--   2. The audience compiler. A rule tree (ALL of the groups; each group ANY or
--      ALL of its rules; NOT on any rule) arrives as jsonb of PRIMITIVES —
--      {col, op, v} — never field names, never SQL. Columns are whitelisted,
--      identifiers go through %I, values through %L, so a staff session can
--      build any list and cannot read any other table. Four callers:
--      crm_audience_count / _sample / _ids / _match. The preview, the sweep and
--      the send-time guard all call these — one evaluator, still.
--   3. Campaigns: a class (quote follow-up vs marketing — decision 8.1), an
--      entry (everyone on an audience, or when an event happens), exit rules,
--      a conversion window, an event watermark.
--   4. Enrolments anchored on an event: waits count from the anchor, and a
--      customer can be enrolled again on a NEW quote (anchor_key).
--   5. campaign_messages.campaign_id (denormalised; stats and the queue filter
--      read it), a step condition, click count.
--   6. crm_campaign_mark_conversions + crm_campaign_stats — analytics in SQL
--      over messages, events and enrolments; nothing counted twice in TS.
--
-- Idempotent. Read-back at the end.

-- ---- 1 · audience facts ------------------------------------------------------
alter table public.crm_account_facts
  add column if not exists last_sent_at          timestamptz,
  add column if not exists last_estimate_status  text not null default 'none',
  add column if not exists last_accepted_at      timestamptz,
  add column if not exists last_declined_at      timestamptz,
  add column if not exists decline_reason        text,
  add column if not exists job_types             text[] not null default '{}',
  add column if not exists quoted_cents          bigint,
  add column if not exists dwell_seconds         integer not null default 0,
  add column if not exists invoice_state         text not null default 'none',
  add column if not exists invoice_due_on        date,
  add column if not exists campaigns_received    text[] not null default '{}',
  add column if not exists last_inbound_at       timestamptz,
  add column if not exists last_inbound_call_at  timestamptz,
  add column if not exists last_staff_contact_at timestamptz;

create index if not exists crm_account_facts_job_types_idx on public.crm_account_facts using gin (job_types);
create index if not exists crm_account_facts_campaigns_idx on public.crm_account_facts using gin (campaigns_received);
create index if not exists crm_account_facts_last_sent_idx on public.crm_account_facts (last_sent_at desc nulls last);
create index if not exists crm_account_facts_est_status_idx on public.crm_account_facts (last_estimate_status);

comment on column public.crm_account_facts.campaigns_received is
  'Keys of every campaign that has SENT this customer a message. "Received campaign X" is a rule, and a campaign never re-sends its own step (send_key).';

-- A sent campaign message changes campaigns_received; an invoice change moves invoice_state.
create or replace function public.campaign_messages_touch_facts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.state = 'sent' and (tg_op = 'INSERT' or old.state is distinct from 'sent') then
    perform public.crm_facts_touch(new.account_id);
  end if;
  return new;
end $$;
drop trigger if exists t_campaign_messages_touch_facts on public.campaign_messages;
create trigger t_campaign_messages_touch_facts after insert or update of state on public.campaign_messages
  for each row execute function public.campaign_messages_touch_facts();

create or replace function public.invoices_touch_facts()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_account uuid;
begin
  if new.estimate_id is null then return new; end if;
  select account_id into v_account from public.estimates where id = new.estimate_id;
  perform public.crm_facts_touch(v_account);
  return new;
end $$;
drop trigger if exists t_invoices_touch_facts on public.invoices;
create trigger t_invoices_touch_facts after insert or update of status, due_on on public.invoices
  for each row execute function public.invoices_touch_facts();

-- ---- 2 · the audience compiler ---------------------------------------------
create or replace function public.crm_audience_where(p_rules jsonb)
returns text language plpgsql immutable as $$
declare
  v_allowed text[] := array[
    'name','email','phone','suburb','account_type','temperature','owner_id','stage','stage_since',
    'needs_you','wants_call','value_cents','source','draft_bucket','draft_last_seen_at','quote_at',
    'last_activity_at','last_contact_at','last_contact_channel','opened_count','last_opened_at',
    'estimates_count','open_value_cents','won_cents','last_job_completed_at','next_followup_at',
    'snoozed_until','relationship_state','state_until','lost_reason','tags','permit_email','permit_sms',
    'permit_phone','last_job_completed_type','repaint_due_at',
    'last_sent_at','last_estimate_status','last_accepted_at','last_declined_at','decline_reason','job_types',
    'quoted_cents','dwell_seconds','invoice_state','invoice_due_on','campaigns_received','last_inbound_at',
    'last_inbound_call_at','last_staff_contact_at'];
  v_groups jsonb; g jsonb; r jsonb; p jsonb;
  v_group_sql text[] := '{}'; v_rule_sql text[]; v_prim_sql text[];
  v_col text; v_op text; v_val jsonb; v_frag text; v_join text; v_list text; v_num numeric;
begin
  v_groups := case when jsonb_typeof(p_rules) = 'object' then p_rules->'groups' else p_rules end;
  if v_groups is null or jsonb_typeof(v_groups) <> 'array' or jsonb_array_length(v_groups) = 0 then
    return 'false';
  end if;
  for g in select * from jsonb_array_elements(v_groups) loop
    v_join := case when g->>'match' = 'any' then ' or ' else ' and ' end;
    v_rule_sql := '{}';
    for r in select * from jsonb_array_elements(coalesce(g->'rules', '[]'::jsonb)) loop
      v_prim_sql := '{}';
      for p in select * from jsonb_array_elements(coalesce(r->'p', '[]'::jsonb)) loop
        v_col := p->>'col'; v_op := p->>'op'; v_val := p->'v';
        if v_col is null or not (v_col = any(v_allowed)) then
          raise exception 'audience: unknown column %', coalesce(v_col, '(none)') using errcode = '22023';
        end if;
        if v_op in ('in', 'nin', 'any', 'all', 'in_ci') then
          if v_val is null or jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) = 0 then
            raise exception 'audience: % needs a list', v_op using errcode = '22023';
          end if;
          select string_agg(quote_literal(case when v_op = 'in_ci' then lower(x) else x end), ',')
            into v_list from jsonb_array_elements_text(v_val) x;
        end if;
        if v_op in ('gt', 'gte', 'lt', 'lte', 'older', 'older_or_never', 'newer', 'within') then
          begin
            v_num := (v_val#>>'{}')::numeric;
          exception when others then
            raise exception 'audience: % needs a number', v_op using errcode = '22023';
          end;
        end if;
        v_frag := case v_op
          when 'eq'      then format('f.%I = %L', v_col, v_val#>>'{}')
          when 'ne'      then format('f.%I is distinct from %L', v_col, v_val#>>'{}')
          when 'in'      then format('f.%I in (%s)', v_col, v_list)
          when 'nin'     then format('(f.%I is null or f.%I not in (%s))', v_col, v_col, v_list)
          when 'in_ci'   then format('lower(f.%I) in (%s)', v_col, v_list)
          when 'gt'      then format('f.%I > %s', v_col, v_num)
          when 'gte'     then format('f.%I >= %s', v_col, v_num)
          when 'lt'      then format('f.%I < %s', v_col, v_num)
          when 'lte'     then format('f.%I <= %s', v_col, v_num)
          when 'between' then format('f.%I between %s and %s', v_col, (v_val->>0)::numeric, (v_val->>1)::numeric)
          when 'any'     then format('f.%I && array[%s]::text[]', v_col, v_list)
          when 'all'     then format('f.%I @> array[%s]::text[]', v_col, v_list)
          when 'null'    then format('f.%I is null', v_col)
          when 'notnull' then format('f.%I is not null', v_col)
          -- time: "more than N days ago" / "…or never" / "within the last N days" / "due within N days" / still ahead / already passed
          when 'older'   then format('(f.%I is not null and f.%I < now() - (%s * interval ''1 day''))', v_col, v_col, v_num)
          when 'older_or_never' then format('(f.%I is null or f.%I < now() - (%s * interval ''1 day''))', v_col, v_col, v_num)
          when 'newer'   then format('(f.%I is not null and f.%I >= now() - (%s * interval ''1 day''))', v_col, v_col, v_num)
          when 'within'  then format('(f.%I is not null and f.%I <= now() + (%s * interval ''1 day''))', v_col, v_col, v_num)
          when 'future'  then format('(f.%I is not null and f.%I > now())', v_col, v_col)
          when 'past'    then format('(f.%I is not null and f.%I <= now())', v_col, v_col)
          else null end;
        if v_frag is null then
          raise exception 'audience: unknown operator %', coalesce(v_op, '(none)') using errcode = '22023';
        end if;
        v_prim_sql := array_append(v_prim_sql, v_frag);
      end loop;
      if array_length(v_prim_sql, 1) is null then continue; end if;
      v_frag := '(' || array_to_string(v_prim_sql, ' and ') || ')';
      if coalesce((r->>'not')::boolean, false) then v_frag := 'not ' || v_frag; end if;
      v_rule_sql := array_append(v_rule_sql, v_frag);
    end loop;
    if array_length(v_rule_sql, 1) is null then continue; end if;
    v_group_sql := array_append(v_group_sql, '(' || array_to_string(v_rule_sql, v_join) || ')');
  end loop;
  if array_length(v_group_sql, 1) is null then return 'false'; end if;
  return array_to_string(v_group_sql, ' and ');
end $$;
revoke all on function public.crm_audience_where(jsonb) from public, anon, authenticated;

-- Staff or the service role. Archived customers are in no audience, ever.
create or replace function public.crm_audience_guard()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'audience: staff only' using errcode = '42501';
  end if;
end $$;
revoke all on function public.crm_audience_guard() from public, anon, authenticated;

create or replace function public.crm_audience_count(p_rules jsonb)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare v_n bigint;
begin
  perform public.crm_audience_guard();
  execute format('select count(*) from public.crm_account_facts f where f.tenant_id = %L and f.relationship_state <> ''archived'' and (%s)',
                 public.current_tenant(), public.crm_audience_where(p_rules)) into v_n;
  return coalesce(v_n, 0);
end $$;

create or replace function public.crm_audience_sample(p_rules jsonb, p_limit int default 20)
returns table (account_id uuid, name text, email text, suburb text, stage text, won_cents bigint, last_job_completed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_audience_guard();
  return query execute format(
    'select f.account_id, f.name, f.email, f.suburb, f.stage, f.won_cents, f.last_job_completed_at
       from public.crm_account_facts f
      where f.tenant_id = %L and f.relationship_state <> ''archived'' and (%s)
      order by f.last_activity_at desc nulls last limit %s',
    public.current_tenant(), public.crm_audience_where(p_rules), greatest(1, least(coalesce(p_limit, 20), 200)));
end $$;

create or replace function public.crm_audience_ids(p_rules jsonb, p_limit int default 5000, p_after uuid default null)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
begin
  perform public.crm_audience_guard();
  return query execute format(
    'select f.account_id from public.crm_account_facts f
      where f.tenant_id = %L and f.relationship_state <> ''archived'' and (%s) and ($1 is null or f.account_id > $1)
      order by f.account_id limit %s',
    public.current_tenant(), public.crm_audience_where(p_rules), greatest(1, least(coalesce(p_limit, 5000), 20000)))
    using p_after;
end $$;

create or replace function public.crm_audience_match(p_rules jsonb, p_account uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  perform public.crm_audience_guard();
  execute format('select exists (select 1 from public.crm_account_facts f where f.account_id = $1 and f.relationship_state <> ''archived'' and (%s))',
                 public.crm_audience_where(p_rules)) into v using p_account;
  return coalesce(v, false);
end $$;

grant execute on function public.crm_audience_count(jsonb) to authenticated, service_role;
grant execute on function public.crm_audience_sample(jsonb, int) to authenticated, service_role;
grant execute on function public.crm_audience_ids(jsonb, int, uuid) to authenticated, service_role;
grant execute on function public.crm_audience_match(jsonb, uuid) to authenticated, service_role;
revoke all on function public.crm_audience_count(jsonb) from anon;
revoke all on function public.crm_audience_sample(jsonb, int) from anon;
revoke all on function public.crm_audience_ids(jsonb, int, uuid) from anon;
revoke all on function public.crm_audience_match(jsonb, uuid) from anon;

-- The audience table gains the rule tree. `criteria` (the flat AND list) stays
-- for one release: lib/crm/segments.ts translates it on read, and the next
-- save writes `rules`. The three starters are rewritten here.
alter table public.crm_segments add column if not exists rules jsonb;
comment on column public.crm_segments.rules is
  'The rule tree: {groups:[{match:"all"|"any", rules:[{field, op, value, not}]}]}. Compiled to primitives by lib/crm/segments.ts, evaluated by crm_audience_*.';

update public.crm_segments set rules = '{"groups":[{"match":"all","rules":[
  {"field":"is_customer","op":"is","value":true},
  {"field":"permit_email","op":"is_not","value":["declined"]}]}]}'::jsonb
 where key = 'past_customers' and rules is null;
update public.crm_segments set rules = '{"groups":[{"match":"all","rules":[
  {"field":"is_customer","op":"is","value":true},
  {"field":"job_types","op":"has_any","value":["interior"]},
  {"field":"job_types","op":"has_any","value":["exterior"],"not":true},
  {"field":"permit_email","op":"is_not","value":["declined"]},
  {"field":"stage","op":"is_not","value":["job_on"]}]}]}'::jsonb
 where key = 'interior_no_exterior' and rules is null;
update public.crm_segments set rules = '{"groups":[{"match":"all","rules":[
  {"field":"is_customer","op":"is","value":true},
  {"field":"last_job_completed_type","op":"is","value":["exterior"]},
  {"field":"last_job_completed_at","op":"more_than_days","value":2555},
  {"field":"last_contact_at","op":"more_than_days","value":365},
  {"field":"permit_email","op":"is_not","value":["declined"]},
  {"field":"stage","op":"is_not","value":["job_on"]}]}]}'::jsonb
 where key = 'exteriors_due_repaint' and rules is null;

-- ---- 3 · campaigns: class, entry, exits ----------------------------------
alter table public.campaigns
  alter column segment_key drop not null,
  add column if not exists class          text not null default 'marketing',
  add column if not exists entry          text not null default 'audience',
  add column if not exists trigger_event  text,
  add column if not exists exit_rules     text[] not null default '{}',
  add column if not exists conversion_days int not null default 30,
  add column if not exists events_since   timestamptz,
  add column if not exists last_swept_at  timestamptz;

alter table public.campaigns drop constraint if exists campaigns_class_check;
alter table public.campaigns add constraint campaigns_class_check check (class in ('marketing', 'followup'));
alter table public.campaigns drop constraint if exists campaigns_entry_check;
alter table public.campaigns add constraint campaigns_entry_check check (entry in ('audience', 'event'));
alter table public.campaigns drop constraint if exists campaigns_trigger_check;
alter table public.campaigns add constraint campaigns_trigger_check
  check (trigger_event is null or trigger_event in ('estimate_sent', 'estimate_viewed', 'estimate_lapsed', 'estimate_declined', 'job_completed', 'visit_completed', 'invoice_paid'));
comment on column public.campaigns.class is
  'followup = service messages about a quote the person asked for (short, exits on any reply, exempt from the monthly marketing cap, skips delayed/lost/do-not-contact). marketing = C9a: monthly cap, quiet states skipped. Decision 8.1.';
comment on column public.campaigns.exit_rules is
  'Any of: replied, called, accepted, declined, do_not_contact, staff_took_over. Checked at queue time and again at send time; a hit finishes the enrolment.';
comment on column public.campaigns.events_since is
  'Event-entry campaigns: the sweep enrols crm_events of trigger_event newer than this, then moves it forward. Null = from the moment the campaign went live.';

-- Steps: waits now count from the ANCHOR (enrolment, or the event), not from
-- the previous message. Existing steps carried waitDays-from-previous; the
-- cumulative sum is the same schedule expressed the new way.
do $$
declare c record; s jsonb; acc int; out jsonb; v_changed int := 0;
begin
  for c in select id, steps from public.campaigns where jsonb_typeof(steps) = 'array' loop
    if exists (select 1 from jsonb_array_elements(c.steps) e where e ? 'afterDays') then continue; end if;
    acc := 0; out := '[]'::jsonb;
    for s in select * from jsonb_array_elements(c.steps) order by (value->>'step')::int loop
      acc := acc + coalesce((s->>'waitDays')::int, 0);
      out := out || jsonb_build_array(s || jsonb_build_object('afterDays', acc, 'condition', 'none'));
    end loop;
    update public.campaigns set steps = out where id = c.id;
    v_changed := v_changed + 1;
  end loop;
  raise notice 'campaign steps converted to afterDays: %', v_changed;
end $$;

-- ---- 4 · enrolments anchored on an event ---------------------------------
alter table public.campaign_enrolments
  add column if not exists anchor_at          timestamptz,
  add column if not exists anchor_key         text not null default '',
  add column if not exists anchor_estimate_id uuid references public.estimates (id) on delete set null,
  add column if not exists converted_at       timestamptz,
  add column if not exists converted_cents    bigint,
  add column if not exists converted_estimate_id uuid references public.estimates (id) on delete set null;
update public.campaign_enrolments set anchor_at = enrolled_at where anchor_at is null;
alter table public.campaign_enrolments drop constraint if exists campaign_enrolments_once;
drop index if exists public.campaign_enrolments_once_idx;
create unique index if not exists campaign_enrolments_once_idx
  on public.campaign_enrolments (campaign_id, account_id, anchor_key);
create index if not exists campaign_enrolments_campaign_idx on public.campaign_enrolments (campaign_id, finished_at);
comment on column public.campaign_enrolments.anchor_key is
  'Empty for an audience campaign (once per customer, ever). For an event campaign, the estimate or event the enrolment hangs off — so a new quote a year later starts the sequence again.';

-- ---- 5 · queue rows know their campaign ----------------------------------
alter table public.campaign_messages
  add column if not exists campaign_id uuid references public.campaigns (id) on delete cascade,
  add column if not exists condition   text,
  add column if not exists clicks      int not null default 0,
  add column if not exists judged_at   timestamptz;
update public.campaign_messages m set campaign_id = e.campaign_id
  from public.campaign_enrolments e where e.id = m.enrolment_id and m.campaign_id is null;
create index if not exists campaign_messages_campaign_idx on public.campaign_messages (campaign_id, state);

create or replace function public.campaign_messages_fill_campaign()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.campaign_id is null then
    select campaign_id into new.campaign_id from public.campaign_enrolments where id = new.enrolment_id;
  end if;
  return new;
end $$;
drop trigger if exists t_campaign_messages_fill_campaign on public.campaign_messages;
create trigger t_campaign_messages_fill_campaign before insert on public.campaign_messages
  for each row execute function public.campaign_messages_fill_campaign();

-- ---- 6 · conversions and stats -------------------------------------------
-- An enrolment converts when the customer accepts an estimate after the
-- anchor, inside the campaign's window. Marked by the sweep; idempotent.
create or replace function public.crm_campaign_mark_conversions(p_campaign uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_days int; v_n int;
begin
  perform public.crm_audience_guard();
  select conversion_days into v_days from public.campaigns where id = p_campaign;
  if v_days is null then return 0; end if;
  with hit as (
    select e.id as enrolment_id, ev.estimate_id, ev.occurred_at, (ev.payload->>'totalCents')::bigint as cents
      from public.campaign_enrolments e
      join lateral (
        select x.estimate_id, x.occurred_at, x.payload
          from public.crm_events x
         where x.account_id = e.account_id and x.type = 'estimate_accepted'
           and x.occurred_at >= coalesce(e.anchor_at, e.enrolled_at)
           and x.occurred_at <= coalesce(e.anchor_at, e.enrolled_at) + (v_days * interval '1 day')
         order by x.occurred_at limit 1
      ) ev on true
     where e.campaign_id = p_campaign and e.converted_at is null
       -- Only after we actually said something to them.
       and exists (select 1 from public.campaign_messages m where m.enrolment_id = e.id and m.state = 'sent' and m.sent_at <= ev.occurred_at)
  )
  update public.campaign_enrolments e
     set converted_at = h.occurred_at, converted_cents = h.cents, converted_estimate_id = h.estimate_id,
         finished_at = coalesce(e.finished_at, h.occurred_at),
         finished_reason = coalesce(e.finished_reason, 'They accepted a quote.')
    from hit h where h.enrolment_id = e.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.crm_campaign_mark_conversions(uuid) to authenticated, service_role;
revoke all on function public.crm_campaign_mark_conversions(uuid) from anon;

create or replace function public.crm_campaign_stats(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.crm_audience_guard();
  select jsonb_build_object(
    'enrolled',  (select count(*) from public.campaign_enrolments e where e.campaign_id = p_campaign),
    'active',    (select count(*) from public.campaign_enrolments e where e.campaign_id = p_campaign and e.finished_at is null),
    'exited',    (select count(*) from public.campaign_enrolments e where e.campaign_id = p_campaign and e.finished_at is not null and e.converted_at is null),
    'waiting',   (select count(*) from public.campaign_messages m where m.campaign_id = p_campaign and m.state in ('queued', 'held')),
    'sent',      (select count(*) from public.campaign_messages m where m.campaign_id = p_campaign and m.state = 'sent'),
    'stopped',   (select count(*) from public.campaign_messages m where m.campaign_id = p_campaign and m.state = 'stopped'),
    'failed',    (select count(*) from public.campaign_messages m where m.campaign_id = p_campaign and m.state = 'failed'),
    'delivered', (select count(*) from public.messages x join public.campaign_messages m on m.id = x.campaign_message_id
                   where m.campaign_id = p_campaign and x.status in ('delivered', 'opened', 'clicked')),
    'opened',    (select count(*) from public.messages x join public.campaign_messages m on m.id = x.campaign_message_id
                   where m.campaign_id = p_campaign and x.status in ('opened', 'clicked')),
    'clicked',   (select count(*) from public.campaign_messages m where m.campaign_id = p_campaign and m.clicks > 0),
    'bounced',   (select count(*) from public.messages x join public.campaign_messages m on m.id = x.campaign_message_id
                   where m.campaign_id = p_campaign and x.status in ('bounced', 'complained')),
    'replied',   (select count(distinct m.account_id) from public.campaign_messages m
                   where m.campaign_id = p_campaign and m.state = 'sent'
                     and exists (select 1 from public.messages x where x.account_id = m.account_id and x.direction = 'in'
                                   and x.occurred_at > m.sent_at and x.occurred_at < m.sent_at + interval '14 days')),
    'unsubscribed', (select count(distinct m.account_id) from public.campaign_messages m
                   where m.campaign_id = p_campaign and m.state = 'sent'
                     and exists (select 1 from public.crm_events e where e.account_id = m.account_id and e.occurred_at > m.sent_at
                                   and (e.type = 'campaign_unsubscribed' or (e.type = 'permission_set' and e.payload->>'value' = 'declined')))),
    'converted', (select count(*) from public.campaign_enrolments e where e.campaign_id = p_campaign and e.converted_at is not null),
    'revenue_cents', (select coalesce(sum(e.converted_cents), 0) from public.campaign_enrolments e where e.campaign_id = p_campaign and e.converted_at is not null)
  ) into v;
  return v;
end $$;
grant execute on function public.crm_campaign_stats(uuid) to authenticated, service_role;
revoke all on function public.crm_campaign_stats(uuid) from anon;

-- Every facts row is stale until the refresher has filled the new columns.
-- The daily sweep works through them in batches; /api/cron/crm-sweep?rebuild=1
-- does it in one go (3–4 minutes at 27k accounts).
update public.crm_account_facts set stale = true where stale = false and job_types = '{}' and last_estimate_status = 'none' and last_sent_at is null;

-- The tracked-link redirect and the sweep write these as the service role;
-- staff already may through the policies above.
grant select, update on public.campaign_messages to service_role;

-- ---- read-back ---------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'crm_account_facts'
     and column_name in ('last_sent_at','last_estimate_status','job_types','dwell_seconds','invoice_state','campaigns_received','last_inbound_at','last_staff_contact_at')) = 8 as facts_columns,
  (select count(*) from pg_proc where proname in ('crm_audience_where','crm_audience_count','crm_audience_sample','crm_audience_ids','crm_audience_match','crm_campaign_stats','crm_campaign_mark_conversions')) = 7 as functions_ok,
  (select count(*) from public.crm_segments where rules is not null) as segments_with_rules,
  (select count(*) from public.campaigns) as campaigns,
  (select count(*) from public.campaigns where jsonb_typeof(steps) = 'array' and steps <> '[]'::jsonb
     and not exists (select 1 from jsonb_array_elements(steps) e where e ? 'afterDays')) = 0 as steps_converted,
  (select count(*) from public.campaign_enrolments where anchor_at is null) = 0 as enrolments_anchored,
  (select count(*) from public.campaign_messages where campaign_id is null) as messages_without_campaign,
  public.crm_audience_where('{"groups":[{"match":"all","rules":[{"p":[{"col":"won_cents","op":"gt","v":0}]}]}]}'::jsonb) as compiler_smoke;
