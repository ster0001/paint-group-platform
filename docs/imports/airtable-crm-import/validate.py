"""Schema-rule validation of the import pack (no database needed)."""
import csv, json, re, datetime as dt, collections, sys, os
D=sys.argv[1] if len(sys.argv)>1 else 'out'
def rd(n): return list(csv.DictReader(open(os.path.join(D,n),encoding='utf-8')))
A=rd('accounts.csv'); C=rd('account_contacts.csv'); P=rd('properties.csv'); E=rd('estimates.csv'); J=rd('jobs.csv'); V=rd('crm_events.csv')
errs=collections.Counter(); ex=[]
def bad(rule,ref,msg): errs[rule]+=1; ex.append((rule,ref,msg))
def ts(s): 
    if not s: return None
    return dt.datetime.strptime(s,'%Y-%m-%dT%H:%M:%SZ')
# accounts
emails=collections.Counter(a['email'].lower() for a in A if a['email'])
for a in A:
    if not a['name']: bad('account_name_missing',a['account_key'],'')
    if not a['email'] and not a['phone_e164']: bad('reachability',a['account_key'],'no email and no phone')
    if a['email'] and emails[a['email'].lower()]>1: bad('email_not_unique',a['account_key'],a['email'])
    if a['email'] and not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$',a['email']): bad('email_invalid',a['account_key'],a['email'])
    if a['phone_e164'] and not re.match(r'^\+61\d{9}$',a['phone_e164']): bad('phone_not_e164',a['account_key'],a['phone_e164'])
    if a['account_type'] not in ('residential','trade'): bad('account_type_enum',a['account_key'],a['account_type'])
    if a['relationship_state'] not in ('active','delayed','do_not_contact','lost','archived'): bad('relationship_state_enum',a['account_key'],a['relationship_state'])
    if a['temperature'] not in ('','hot','warm','cold'): bad('temperature_enum',a['account_key'],a['temperature'])
    if a['relationship_state']=='lost' and a['lost_reason'] not in ('competitor','other','no_response'): bad('lost_reason',a['account_key'],a['lost_reason'])
    if not ts(a['first_seen_at']): bad('first_seen_at',a['account_key'],a['first_seen_at'])
akeys={a['account_key'] for a in A}
for c in C:
    if c['account_key'] not in akeys: bad('contact_orphan',c['name'],'')
pkeys=set()
for p in P:
    if p['account_key'] not in akeys: bad('property_orphan',p['property_key'],'')
    if not p['address_norm'] or not p['address']: bad('property_address_missing',p['property_key'],'')
    if p['postcode'] and not re.fullmatch(r'\d{4}',p['postcode']): bad('postcode',p['property_key'],p['postcode'])
    if p['state']!='VIC': bad('state',p['property_key'],p['state'])
    pkeys.add(p['property_key'])
ekeys=set(); 
for e in E:
    ekeys.add(e['estimate_key'])
    if e['account_key'] not in akeys: bad('estimate_orphan_account',e['estimate_key'],'')
    if e['property_key'] and e['property_key'] not in pkeys: bad('estimate_orphan_property',e['estimate_key'],'')
    if e['status'] not in ('draft','sent','accepted','declined','expired'): bad('estimate_status_enum',e['estimate_key'],e['status'])
    if e['status']!='draft' and e['level_of_finish'] not in ('2','3','4'): bad('finish_required_when_sent',e['estimate_key'],e['level_of_finish'])
    for col in ('subtotal_cents','total_cents'):
        v=e[col]
        if e['status']!='draft' and (v=='' or not re.fullmatch(r'-?\d+',v) or int(v)<0): bad('cents_integer',e['estimate_key'],f'{col}={v!r}')
    if e['subtotal_cents'] and e['total_cents'] and int(e['subtotal_cents'])>int(e['total_cents']): bad('subtotal_gt_total',e['estimate_key'],'')
    if e['total_cents'] and e['subtotal_cents'] and abs(int(e['total_cents'])-round(int(e['subtotal_cents'])*1.1))>2: bad('gst_mismatch',e['estimate_key'],f"{e['subtotal_cents']} {e['total_cents']}")
    if e['status']!='draft' and not ts(e['sent_at']): bad('sent_at_missing',e['estimate_key'],'')
    if e['status']=='accepted' and not ts(e['accepted_at']): bad('accepted_at_missing',e['estimate_key'],'')
    if ts(e['sent_at']) and ts(e['accepted_at']) and ts(e['accepted_at'])<ts(e['sent_at'])-dt.timedelta(days=1): bad('accepted_before_sent',e['estimate_key'],f"{e['sent_at']} > {e['accepted_at']}")
    if e['size_band'] not in ('','under_10k','10_to_20k','over_20k'): bad('size_band',e['estimate_key'],e['size_band'])
for j in J:
    if j['estimate_key'] not in ekeys: bad('job_orphan_estimate',j['job_key'],'')
    if j['status'] not in ('completed','in_progress','scheduled','accepted_unscheduled','cancelled','on_hold',''): bad('job_status',j['job_key'],j['status'])
    for col in ('start_date','end_date'):
        if j[col] and not re.fullmatch(r'\d{4}-\d{2}-\d{2}',j[col]): bad('job_date',j['job_key'],j[col])
    if j['start_date'] and j['end_date'] and j['end_date']<j['start_date']: bad('job_end_before_start',j['job_key'],f"{j['start_date']}..{j['end_date']}")
    if not j['quote_url']: bad('job_without_quote_url',j['job_key'],j['project_name'])
kinds={'account_created','estimate_sent','estimate_viewed','estimate_accepted','estimate_declined','estimate_lapsed','job_started','job_completed','invoice_sent','invoice_paid','note','call','visit'}
dk=collections.Counter(v['event_key'] for v in V)
for v in V:
    if v['type'] not in kinds: bad('event_kind',v['event_key'],v['type'])
    if v['account_key'] not in akeys: bad('event_orphan_account',v['event_key'],'')
    if v['estimate_key'] and v['estimate_key'] not in ekeys: bad('event_orphan_estimate',v['event_key'],'')
    if not ts(v['occurred_at']): bad('event_occurred_at',v['event_key'],v['occurred_at'])
    elif ts(v['occurred_at'])>dt.datetime(2026,9,18): bad('event_in_future',v['event_key'],v['occurred_at'])
    try: json.loads(v['payload'])
    except Exception: bad('event_payload_json',v['event_key'],'')
    if dk[v['event_key']]>1: bad('event_dedupe_dup',v['event_key'],'')
print('rows:',dict(accounts=len(A),contacts=len(C),properties=len(P),estimates=len(E),jobs=len(J),events=len(V)))
print('violations:',dict(errs) or 'NONE')
for x in ex[:30]: print(' ',x)
json.dump({'rows':dict(accounts=len(A),contacts=len(C),properties=len(P),estimates=len(E),jobs=len(J),events=len(V)),'violations':dict(errs),'examples':ex[:200]},open(os.path.join(D,'validation.json'),'w'),indent=1)
