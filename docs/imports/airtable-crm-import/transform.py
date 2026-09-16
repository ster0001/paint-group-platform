#!/usr/bin/env python3
"""
Airtable -> paint-group-platform CRM import transform.

Reads the Airtable "Estimates" and "Projects" tables (JSON API dumps or CSV
exports) and writes one CSV per CRM target table plus an exceptions list.

Usage:
  python3 transform.py --estimates estimates_all.json --projects projects.json --out out/
  python3 transform.py --estimates Estimates.csv --projects Projects.csv --out out/   (Airtable CSV export)

Nothing here touches the database. It only produces files a reviewer can read
and a loader (see the Claude Code brief) can ingest.
"""
import argparse, csv, json, re, sys, os, datetime as dt, collections, hashlib

TODAY = dt.date(2026, 9, 16)

# ----------------------------------------------------------------- helpers
def load(path):
    if path.endswith('.json'):
        d = json.load(open(path))
        recs = d['records'] if isinstance(d, dict) else d
        out = []
        for r in recs:
            if 'fields' in r:
                f = dict(r['fields']); f['_id'] = r['id']; f['_created'] = r.get('createdTime')
            else:
                f = dict(r); f.setdefault('_id', ''); f.setdefault('_created', None)
            out.append(f)
        return out
    with open(path, newline='', encoding='utf-8-sig') as fh:
        rows = list(csv.DictReader(fh))
    for i, r in enumerate(rows):
        r['_id'] = r.get('Record ID') or r.get('_id') or f'csvrow{i}'
        r['_created'] = r.get('Created') or r.get('createdTime')
    return rows

def s(v):
    if v is None: return ''
    if isinstance(v, (list, tuple)): return ', '.join(s(x) for x in v if x is not None)
    if isinstance(v, dict): return ''
    return str(v).strip()

def num(v):
    try:
        if v in (None, ''): return None
        return float(str(v).replace('$', '').replace(',', ''))
    except: return None

def cents(v):
    n = num(v)
    return None if n is None else int(round(n * 100))

def iso_date(v):
    v = s(v)
    if not v: return None
    if re.fullmatch(r'\d{12,13}', v):  # Airtable sometimes hands back epoch milliseconds
        return dt.datetime.fromtimestamp(int(v) / 1000, tz=dt.timezone.utc)
    if re.fullmatch(r'\d{9,10}', v):
        return dt.datetime.fromtimestamp(int(v), tz=dt.timezone.utc)
    for fmt in ('%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%dT%H:%M:%S.%f%z', '%Y-%m-%d', '%d/%m/%Y', '%Y-%m-%dT%H:%M:%SZ'):
        try:
            d = dt.datetime.strptime(v.replace('+00:00', '+0000'), fmt.replace('%z', '%z'))
            if d.tzinfo is None: d = d.replace(tzinfo=dt.timezone.utc)
            return d
        except: pass
    return None

def ts(d): return d.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if d else ''

def norm_email(v):
    e = s(v).lower()
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', e): return ''
    if e.count('@') != 1: return ''
    return e

def norm_phone(v):
    raw = s(v)
    d = re.sub(r'\D', '', raw)
    if not d: return '', ''
    if d.startswith('0061'): d = d[4:]
    if d.startswith('61') and len(d) == 11: return '+' + d, ''
    if d.startswith('0') and len(d) == 10: return '+61' + d[1:], ''
    if len(d) == 9 and d[0] in '4': return '+61' + d, 'assumed missing leading 0 (mobile)'
    if len(d) == 9 and d[0] in '3': return '+61' + d, 'assumed missing leading 0 (landline)'
    if len(d) == 8: return '+613' + d, 'assumed Melbourne landline (03)'
    return '', f'unparseable phone "{raw}"'

STREET_TYPES = {'street','st','road','rd','avenue','ave','av','drive','dr','crescent','cres','cr','court','ct','place','pl','terrace','tce','lane','ln','highway','hwy','parade','pde','boulevard','blvd','bvd','grove','gr','way','close','cl','circuit','cct','esplanade','esp','square','sq','walk','rise','mews','row','track','trk','promenade','prom','gardens','gdns','glade','gld','retreat','rtt','loop','bend','vista','entrance','ent','alley','arcade','concourse','quay','strand'}
ABBR = {'st':'street','rd':'road','ave':'avenue','av':'avenue','dr':'drive','cres':'crescent','cr':'crescent','ct':'court','pl':'place','tce':'terrace','ln':'lane','hwy':'highway','pde':'parade','blvd':'boulevard','bvd':'boulevard','gr':'grove','cl':'close','cct':'circuit','esp':'esplanade','sq':'square','gdns':'gardens','prom':'promenade'}
DESCRIPTORS = r'\b(interior|exterior|internal|external|inside|outside|stage\s*\d+|part\s*\d+|pt\s*\d+|full interior|full exterior|plastering|test|copy|ceilings?|bathroom|kitchen|laundry|deck|fence|garage|roof|unit\s*\d+\s*only|only)\b'

def parse_address(line1, suburb, state, postcode):
    """Return (address, suburb, state, postcode, address_norm, warnings)."""
    warn = []
    a = s(line1)
    sub = s(suburb); st = s(state); pc = s(postcode)
    # trailing full-address pattern "… Suburb Victoria 3175 Australia AU"
    m = re.search(r'^(.*?)[,\s]+((?:vic|victoria))[,\s]+(\d{4})(?:[,\s]+australia)?(?:[,\s]+au)?\s*$', a, re.I)
    if m:
        head = m.group(1); pc = pc if re.fullmatch(r'\d{4}', pc) else m.group(3)
        toks = head.replace(',', ' ').split()
        idx = max((i for i, t in enumerate(toks) if t.lower().strip('.') in STREET_TYPES), default=-1)
        if idx >= 0 and idx < len(toks) - 1 and not sub:
            sub = ' '.join(toks[idx + 1:]); a = ' '.join(toks[:idx + 1])
        else:
            a = head
        st = 'VIC'
    # suburb embedded after comma: "23/8 the strand, Williamstown"
    if not sub and ',' in a:
        head, tail = a.rsplit(',', 1)
        if 1 <= len(tail.split()) <= 3 and not re.search(r'\d', tail):
            a, sub = head.strip(), tail.strip()
    # postcode sanity
    if not re.fullmatch(r'\d{4}', pc):
        if pc: warn.append(f'postcode field not a postcode ("{pc}")')
        pc = ''
    # state
    if st.lower() in ('vic', 'victoria', 'melbourne', 'vic.', 'vic ', 'v') or re.search(r'melbourne', st, re.I) or not st:
        st = 'VIC'
    elif st.lower() not in ('nsw','qld','sa','wa','tas','nt','act'):
        warn.append(f'state field looked like a suburb/other ("{st}"); set VIC'); st = 'VIC'
    # strip descriptors from address for the norm key
    core = re.sub(r'\(.*?\)', ' ', a)
    core = re.sub(DESCRIPTORS, ' ', core, flags=re.I)
    core = core.lower()
    core = re.sub(r'[^a-z0-9/ ]', ' ', core)
    toks = [ABBR.get(t, t) for t in core.split()]
    norm = ' '.join(toks)
    if sub: norm += ' ' + re.sub(r'[^a-z ]', '', sub.lower()).strip()
    norm = re.sub(r'\s+', ' ', norm).strip()
    if a != s(line1): warn.append('address line was rewritten from a full-address string')
    if not norm: warn.append('empty address')
    return a, sub.title() if sub.isupper() or sub.islower() else sub, st, pc, norm, warn

def clean_name(first, last):
    f = s(first); l = s(last)
    if l.lower() == f.lower(): l = ''
    n = re.sub(r'\s+', ' ', f'{f} {l}').strip()
    n = n.replace("\\'", "'").replace(" '", "'")
    return n

def name_is_junk(n):
    return (not n) or n.lower() in ('xxxx', 'x', 'test', 'noemail', 'unknown') or re.fullmatch(r'[x\W]+', n.lower() or 'x') is not None

def dedupe_key(*parts):
    return 'airtable:' + ':'.join(s(p) for p in parts)

# ------------------------------------------------------- status mappings
EST_STATUS = {
    'won': 'accepted',
    'lost other': 'declined', 'lost - competitor': 'declined',
    'estimate created': 'draft',
    'quote sent - needs follow up': 'sent',
    'hot in negotiation': 'sent', 'hot, but delayed': 'sent',
    'warm, undecided': 'sent', 'warm, delayed': 'sent',
    'cold, no response': 'expired', 'cold, delayed or unlikely': 'expired',
    'kay and burton': 'sent',
}
TEMP = {'hot in negotiation': 'hot', 'hot, but delayed': 'hot', 'warm, undecided': 'warm', 'warm, delayed': 'warm',
        'cold, no response': 'cold', 'cold, delayed or unlikely': 'cold', 'quote sent - needs follow up': 'warm'}
LOST = {'lost other': 'other', 'lost - competitor': 'competitor'}
JOB_STATUS = {'completed': 'completed', 'invoiced': 'completed', 'in progress': 'in_progress', 'job booked': 'scheduled',
              'needs booking': 'accepted_unscheduled', 'cancelled': 'cancelled', 'on hold': 'on_hold'}
FINISH = {'level 2': 2, 'level 3': 3, 'level 4': 4}

TRADE_DOMAINS = {'kayburton.com.au': 'Kay & Burton', 'email.propertyme.com': 'Kay & Burton',
                 'marketreadymakeovers.com.au': 'Market Ready Makeovers', 'csandg.com.au': 'CS&G',
                 'vci.com.au': 'VCI', 'rivervue.com.au': 'Rivervue', 'acmoutdoors.com.au': 'ACM Outdoors',
                 'cowesbay.com': 'Cowes Bay', 'regisbuilt.com.au': 'Regis Built', 'strataequity.com.au': 'Strata Equity',
                 'buypropertyaustralia.com': 'Buy Property Australia'}
STAFF_EMAILS = {'robyn@paintgroup.com.au', 'tjhroman@gmail.com', 'info@paintgroup.com.au', 'tom@paintgroup.com.au'}

def size_band(total_cents):
    if total_cents is None: return ''
    d = total_cents / 100
    return 'under_10k' if d < 10000 else ('10_to_20k' if d < 20000 else 'over_20k')

def token(url):
    m = re.search(r'[?&]u=([a-z0-9]+)', s(url))
    return m.group(1) if m else ''

# ---------------------------------------------------------- note parsing
DATE_FRAG = re.compile(r'(?<![\d/])(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?![\d/])')
def split_notes(text, anchor):
    """Split a free-text follow-up log into dated fragments. anchor = datetime the record was created."""
    text = s(text)
    if not text: return []
    parts = []
    idxs = [(m.start(), m) for m in DATE_FRAG.finditer(text)]
    if not idxs:
        return [(None, text, 'no date in note; anchored to record creation')]
    # text before the first date fragment is undated
    if idxs[0][0] > 3:
        parts.append((None, text[:idxs[0][0]].strip(' -.,\n'), 'undated preamble'))
    for k, (pos, m) in enumerate(idxs):
        end = idxs[k + 1][0] if k + 1 < len(idxs) else len(text)
        body = text[m.end():end].strip(' -.,:\n')
        d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
        if not (1 <= d <= 31 and 1 <= mo <= 12):
            parts.append((None, text[pos:end].strip(), 'unparseable date fragment')); continue
        if y:
            y = int(y); y = y + 2000 if y < 100 else y
            cands = [y]
        else:
            ay = anchor.year if anchor else TODAY.year
            cands = [ay, ay + 1, ay - 1]
        chosen = None; why = ''
        for yy in cands:
            try: cd = dt.datetime(yy, mo, d, 9, 0, tzinfo=dt.timezone.utc)
            except ValueError: continue
            if anchor and cd < anchor - dt.timedelta(days=14): continue
            if cd.date() > TODAY + dt.timedelta(days=1): continue  # a future date in a note is a reminder, not an event
            chosen = cd; break
        if chosen is None:
            why = 'date could not be placed in a plausible year; anchored to record creation'
        parts.append((chosen, body, why))
    return [p for p in parts if p[1]]

# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--estimates', required=True); ap.add_argument('--projects', required=True); ap.add_argument('--out', default='out')
    A = ap.parse_args(); os.makedirs(A.out, exist_ok=True)
    E = load(A.estimates); P = load(A.projects)
    exceptions = []
    def exc(sev, cat, ref, detail, action=''):
        exceptions.append({'severity': sev, 'category': cat, 'airtable_ref': ref, 'detail': detail, 'suggested_action': action})

    # ---- 1. identity resolution -------------------------------------------------
    people = []  # one per source row
    for r in E:
        people.append(dict(src='estimate', id=r['_id'], email=norm_email(r.get('Email')), raw_email=s(r.get('Email')),
                           phone=s(r.get('Phone')), first=r.get('First Name'), last=r.get('Last Name'),
                           created=iso_date(r.get('_created')) or iso_date(r.get('Quote Date')),
                           lead=s(r.get('Lead source (from Short Form Enquiries)')), status=s(r.get('Status')).lower().strip()))
    for r in P:
        people.append(dict(src='project', id=r.get('_id') or ('proj:' + s(r.get('Quote No')) + ':' + s(r.get('Project Name'))),
                           email=norm_email(r.get('Email')), raw_email=s(r.get('Email')), phone=s(r.get('Phone')),
                           first=r.get('First Name'), last=r.get('Last Name'),
                           created=iso_date(r.get('Date Accepted')) or iso_date(r.get('_created')), lead='', status=''))
    for p in people:
        p['e164'], p['phone_warn'] = norm_phone(p['phone'])
        p['name'] = clean_name(p['first'], p['last'])
        if p['raw_email'] and not p['email']:
            exc('warn', 'bad_email', p['id'], f'email "{p["raw_email"]}" is not valid; row keyed on phone/name instead', 'fix in Airtable or accept phone-only account')
        if p['phone'] and not p['e164']:
            exc('warn', 'bad_phone', p['id'], p['phone_warn'], 'phone dropped from import')
        elif p['phone_warn']:
            exc('info', 'phone_assumed', p['id'], f'{p["phone"]} -> {p["e164"]}: {p["phone_warn"]}', 'check')

    # key = email, else phone, else name+first address (weak)
    key_of = {}
    phone_to_email = {}
    for p in people:
        if p['email'] and p['e164']: phone_to_email.setdefault(p['e164'], p['email'])
    for p in people:
        if p['email']: k = 'e:' + p['email']
        elif p['e164']: k = 'e:' + phone_to_email[p['e164']] if p['e164'] in phone_to_email else 'p:' + p['e164']
        elif not name_is_junk(p['name']): k = 'n:' + p['name'].lower()
        else: k = ''
        p['key'] = k; key_of[p['id']] = k

    groups = collections.defaultdict(list)
    for p in people:
        if p['key']: groups[p['key']].append(p)

    accounts = {}; contacts = []
    acct_id_of_key = {}
    for k, ps in groups.items():
        ps.sort(key=lambda x: x['created'] or dt.datetime(2000, 1, 1, tzinfo=dt.timezone.utc))
        email = next((p['email'] for p in ps if p['email']), '')
        phones = collections.Counter(p['e164'] for p in ps if p['e164'])
        phone = phones.most_common(1)[0][0] if phones else ''
        names = collections.Counter(p['name'] for p in ps if not name_is_junk(p['name']))
        # newest sensible name wins, ties by frequency
        name = ''
        for p in reversed(ps):
            if not name_is_junk(p['name']): name = p['name']; break
        domain = email.split('@')[1] if email else ''
        org = TRADE_DOMAINS.get(domain, '')
        acct_type = 'residential'; type_reason = ''
        # Tom, 16 Sep 2026: one account per agent email, sharing a company name so the company view lists them all;
        # history is NOT imported into trade accounts (real-estate work is tagged, not typed).
        if org: type_reason = f'email domain {domain} is a known agency/business — company_name set, account stays residential'
        elif len(names) >= 3: type_reason = f'{len(names)} different names share this email — probably an agent/business (company_name left blank: check)'
        akey = 'acc_' + hashlib.sha1(k.encode()).hexdigest()[:10]
        acct_id_of_key[k] = akey
        first_seen = ps[0]['created'] or next((p['created'] for p in ps if p['created']), None) or dt.datetime(2025, 4, 30, tzinfo=dt.timezone.utc)
        leads = [p['lead'] for p in ps if p['lead']]
        accounts[akey] = dict(account_key=akey, account_type=acct_type, email=email, name=name or (org or ''), phone=phone, phone_e164=phone,
                              company_name=org, account_type_reason=type_reason,
                              other_names='; '.join(n for n in names if n != name), other_phones='; '.join(p for p in phones if p != phone),
                              lead_source=leads[0] if leads else '', first_seen_at=ts(first_seen), airtable_estimate_ids=len([p for p in ps if p['src']=='estimate']),
                              airtable_project_rows=len([p for p in ps if p['src']=='project']),
                              relationship_state='active', lost_reason='', temperature='', tags='', is_staff_test='yes' if email in STAFF_EMAILS else '')
        if not email and not phone:
            exc('warn', 'no_email_no_phone', ps[0]['id'], f'account "{name}" has neither email nor phone (reachability rule) — keyed on name only', 'add contact details in Airtable or import as archived')
        if email in STAFF_EMAILS: exc('info', 'staff_test_row', ps[0]['id'], f'{email} looks like a staff/test account', 'exclude from import (default: excluded)')
        if len(names) > 1:
            exc('info', 'multiple_names', ps[0]['id'], f'{email or phone}: names seen = {", ".join(names)}; using "{name}"', 'confirm account name; others become contacts')
            for n in names:
                if n != name:
                    contacts.append(dict(account_key=akey, name=n, email='', phone='', role='other', is_primary='false', notes='Name seen on an Airtable estimate/project under this email'))
        if len(phones) > 1:
            exc('info', 'multiple_phones', ps[0]['id'], f'{email}: phones = {", ".join(phones)}; using {phone}', 'keep as contact phones')
    for p in people:
        if not p['key']:
            exc('error', 'unidentifiable_row', p['id'], f'{p["src"]} row with no email, phone or usable name (first={s(p["first"])!r} last={s(p["last"])!r})', 'skipped — will not be imported')

    # ---- 2. properties ----------------------------------------------------------
    properties = {}  # (akey, norm) -> row
    def get_property(akey, line1, suburb, state, pc, ref):
        a, sub, st, pcode, norm, warn = parse_address(line1, suburb, state, pc)
        for w in warn: exc('info', 'address', ref, f'{s(line1)!r}: {w}', '')
        if not norm: return ''
        pk = (akey, norm)
        if pk not in properties:
            properties[pk] = dict(property_key='prop_' + hashlib.sha1(f'{akey}|{norm}'.encode()).hexdigest()[:10], account_key=akey,
                                  address=a, suburb=sub, state=st, postcode=pcode, address_norm=norm, type='', airtable_refs=ref)
        else:
            row = properties[pk]
            if not row['suburb'] and sub: row['suburb'] = sub
            if not row['postcode'] and pcode: row['postcode'] = pcode
            row['airtable_refs'] += ' ' + ref
        return properties[pk]['property_key']

    # ---- 3. estimates from the Estimates table ----------------------------------
    estimates = {}; events = []
    def ev(type_, akey, occurred, payload, ekey='', pkey='', dk=''):
        if not occurred:
            occurred = dt.datetime(2025, 4, 30, tzinfo=dt.timezone.utc); payload = dict(payload, date_confidence='low', date_note='no date in Airtable; set to Airtable go-live 30 Apr 2025')
        events.append(dict(event_key=dk, type=type_, account_key=akey, estimate_key=ekey, property_key=pkey,
                           occurred_at=ts(occurred), source='airtable_import', payload=json.dumps(payload, ensure_ascii=False)))
    est_by_token = {}; est_by_acct = collections.defaultdict(list)
    for r in E:
        k = key_of[r['_id']]
        if not k: continue
        akey = acct_id_of_key[k]
        if accounts[akey]['is_staff_test']: continue
        created = iso_date(r.get('_created')); qdate = iso_date(r.get('Quote Date'))
        bulk_loaded = bool(created) and created.date() == dt.date(2025, 4, 30) and not qdate
        st_raw = s(r.get('Status')); st_l = st_raw.lower().strip()
        total = cents(r.get('Quote Amount'))
        if st_l in EST_STATUS: status = EST_STATUS[st_l]
        elif not st_raw: status = 'sent' if total else 'draft'; exc('info', 'no_status', r['_id'], f'no Status; set {status}', '')
        else: status = 'sent'; exc('warn', 'unknown_status', r['_id'], f'Status "{st_raw}" not mapped; set sent', 'tell me the mapping')
        if status == 'accepted' and not total:
            exc('warn', 'won_no_amount', r['_id'], f'Won but no Quote Amount ({accounts[akey]["name"]})', 'importing as accepted with $0 — fix amount or confirm')
        if status == 'draft' and total:
            status = 'sent'; exc('info', 'draft_with_amount', r['_id'], 'Estimate Created but has a Quote Amount; set sent', '')
        if status != 'draft' and total is None: total = 0
        sent_at = qdate or created
        if status == 'expired' and sent_at and (TODAY - sent_at.date()).days < 90:
            status = 'sent'  # too recent to call expired; leave to the lapse rule
        ekey = 'est_' + r['_id']
        pkey = get_property(akey, r.get('Adress Line 1'), r.get('Suburb'), r.get('State'), r.get('Zip/ Post Code'), r['_id'])
        qt = s(r.get('Quote Type ')).strip()
        estimates[ekey] = dict(estimate_key=ekey, account_key=akey, property_key=pkey, status=status, level_of_finish='', size_band=size_band(total),
                               subtotal_cents='' if total is None else int(round(total / 1.1)), total_cents='' if total is None else total,
                               sent_at=ts(sent_at) if status != 'draft' else '', created_at=ts(created), accepted_at='', declined_at='',
                               airtable_id=r['_id'], quote_number='', quote_url=s(r.get('Quote URL')), work_order_url=s(r.get('Work Order URL')),
                               quote_type=qt, estimated_hours=s(r.get('Estimated Hours')), estimated_materials=s(r.get('Estimated Materials')),
                               follow_up_date=s(r.get('Follow Up Date ')), airtable_status=st_raw, lead_source=s(r.get('Lead source (from Short Form Enquiries)')),
                               _line1=s(r.get('Adress Line 1')), project_status='', notes_raw=s(r.get('Notes')), date_confidence='low' if (bulk_loaded or not qdate) else 'high')
        for t in (token(r.get('Quote URL')), token(r.get('Work Order URL'))):
            if t: est_by_token[t] = ekey
        est_by_acct[akey].append(ekey)
        # temperature / lost reason on the account from the newest non-final estimate
        acc = accounts[akey]
        if st_l in TEMP: acc['temperature'] = TEMP[st_l]
        if st_l in LOST: acc['lost_reason_seen'] = LOST[st_l]
        if st_l == 'kay and burton': exc('info', 'status_kay_and_burton', r['_id'], 'Status "Kay and Burton" is a tag not a status; set sent + tag', '')
        # events
        if status != 'draft':
            ev('estimate_sent', akey, sent_at, {'total_cents': total, 'quote_type': qt, 'airtable_status': st_raw}, ekey, pkey, dedupe_key(r['_id'], 'sent'))
        if status == 'declined':
            when = iso_date(r.get('Follow Up Date ')) or sent_at
            ev('estimate_declined', akey, when, {'reason': LOST.get(st_l, ''), 'date_confidence': 'low', 'airtable_status': st_raw}, ekey, pkey, dedupe_key(r['_id'], 'declined'))
            estimates[ekey]['declined_at'] = ts(when)
        if status == 'expired':
            ev('estimate_lapsed', akey, sent_at + dt.timedelta(days=90) if sent_at else None, {'airtable_status': st_raw, 'date_confidence': 'low'}, ekey, pkey, dedupe_key(r['_id'], 'lapsed'))
        for i, (when, body, why) in enumerate(split_notes(r.get('Notes'), created)):
            author = ''
            m = re.match(r'^(TR|R|Tom|Robyn|Debbie|D)\b[\s:.-]*', body, re.I)
            if m: author = {'tr': 'Tom', 'tom': 'Tom', 'r': 'Robyn', 'robyn': 'Robyn', 'd': 'Debbie', 'debbie': 'Debbie'}[m.group(1).lower()]; body = body[m.end():].strip()
            payload = {'text': body, 'author': author, 'origin': 'airtable_estimates_notes'}
            if why: payload['date_note'] = why
            ev('note', akey, when or created, payload, ekey, pkey, dedupe_key(r['_id'], 'note', i))
        fu = iso_date(r.get('Follow Up Date '))
        if fu and fu.date() > TODAY and status in ('sent',):
            exc('info', 'future_follow_up', r['_id'], f'{accounts[akey]["name"]}: follow-up due {fu.date()} still open', 'loader should create a follow-up/snooze so it is not lost')

    # ---- 4. projects -> jobs, level of finish, accepted dates, job events ---------
    jobs = []
    for r in P:
        pid = r.get('_id') or ('proj:' + s(r.get('Quote No')) + ':' + s(r.get('Project Name')))
        k = key_of.get(pid, '')
        if not k:
            continue  # already logged as unidentifiable
        akey = acct_id_of_key[k]
        if accounts[akey]['is_staff_test']: continue
        acc_at = iso_date(r.get('Date Accepted')) or iso_date(r.get('_acc'))
        acc_conf = 'high' if acc_at else 'low'
        if not acc_at: acc_at = iso_date(r.get('Start Date - '))
        inv = cents(r.get('Invoice Amount '))
        # match to an estimate: URL token > exact label (keeps "Exterior"/"stage 2") > property + amount > amount > property > only candidate
        def label(x): return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9/ ]', ' ', s(x).lower())).strip()
        ekey = est_by_token.get(token(r.get('Quote URL'))) or est_by_token.get(token(r.get('Work Order URL')))
        how = 'url'
        if ekey and estimates[ekey]['project_status']:
            exc('warn', 'two_projects_one_estimate', pid, f'Project "{s(r.get("Project Name"))}" shares a PaintScout quote URL with another project already matched to estimate {estimates[ekey]["airtable_id"]}', 'is this a staged job? second project will get its own estimate row'); ekey = ''
        if not ekey:
            _, _, _, _, norm, _ = parse_address(r.get('Address Line 1') or r.get('Project Name'), r.get('Suburb'), r.get('State'), r.get('Zip / Post Code'))
            prop_key = properties.get((akey, norm), {}).get('property_key')
            cands = [estimates[e] for e in est_by_acct.get(akey, []) if estimates[e]['status'] == 'accepted' and estimates[e]['project_status'] == '' and not estimates[e]['estimate_key'].startswith('est_proj_')]
            labels = {label(r.get('Project Name')), label(r.get('Address Line 1'))} - {''}
            by_label = [c for c in cands if label(c['_line1']) in labels]
            by_prop = [c for c in cands if prop_key and c['property_key'] == prop_key]
            def amt_ok(c): return bool(inv and c['total_cents'] and abs(c['total_cents'] - inv) <= max(100, inv * 0.02))
            by_amt = [c for c in cands if amt_ok(c)]
            pick, how = None, ''
            if by_label:
                pick = sorted(by_label, key=lambda c: (0 if amt_ok(c) else 1, abs((c['total_cents'] or 0) - (inv or 0))))[0]; how = 'label'
            elif by_prop and by_amt and [c for c in by_prop if amt_ok(c)]:
                pick = [c for c in by_prop if amt_ok(c)][0]; how = 'property+amount'
            elif by_amt: pick = by_amt[0]; how = 'amount'
            elif by_prop: pick = sorted(by_prop, key=lambda c: abs((c['total_cents'] or 0) - (inv or 0)))[0]; how = 'property'
            elif len(cands) == 1: pick = cands[0]; how = 'only accepted estimate on account'
            if pick: ekey = pick['estimate_key']
        if not ekey:
            # create an estimate row from the project itself
            ekey = 'est_proj_' + hashlib.sha1(pid.encode()).hexdigest()[:10]
            pkey = get_property(akey, r.get('Address Line 1') or r.get('Project Name'), r.get('Suburb'), r.get('State'), r.get('Zip / Post Code'), pid)
            estimates[ekey] = dict(estimate_key=ekey, account_key=akey, property_key=pkey, status='accepted', level_of_finish='', size_band=size_band(inv),
                                   subtotal_cents='' if inv is None else int(round(inv / 1.1)), total_cents=inv if inv is not None else 0,
                                   sent_at=ts(acc_at), created_at=ts(acc_at), accepted_at='', declined_at='', airtable_id=pid, quote_number=s(r.get('Quote No')),
                                   quote_url=s(r.get('Quote URL')), work_order_url=s(r.get('Work Order URL')), quote_type=s(r.get('Job Type ')),
                                   estimated_hours=s(r.get('Estimated Hours')), estimated_materials=s(r.get('Estimated Materials')), follow_up_date='',
                                   airtable_status='(from Projects only)', lead_source='', project_status='', notes_raw='', _line1=s(r.get('Address Line 1') or r.get('Project Name')), date_confidence=acc_conf)
            est_by_acct[akey].append(ekey)
            ev('estimate_sent', akey, acc_at, {'total_cents': inv, 'origin': 'projects_table_only'}, ekey, pkey, dedupe_key(pid, 'sent'))
            exc('info', 'project_without_estimate', pid, f'Project "{s(r.get("Project Name"))}" ({accounts[akey]["name"]}) has no matching Estimates row; created an accepted estimate from the project', 'check')
            how = 'created'
        est = estimates[ekey]
        if est['status'] != 'accepted':
            exc('warn', 'project_vs_estimate_status', pid, f'Project "{s(r.get("Project Name"))}" exists but estimate {est["airtable_id"]} is "{est["airtable_status"]}"; setting accepted', 'confirm')
            est['status'] = 'accepted'
        if inv and not est['total_cents']:
            est['total_cents'] = inv; est['subtotal_cents'] = int(round(inv / 1.1)); est['size_band'] = size_band(inv)
            exc('info', 'total_taken_from_invoice', pid, f'{accounts[akey]["name"]} "{s(r.get("Project Name"))}": estimate had no Quote Amount; total set from invoice ${inv/100:,.2f}', '')
        lof = FINISH.get(s(r.get('Level of Finish ')).lower(), '')
        est['level_of_finish'] = lof; est['quote_number'] = est['quote_number'] or s(r.get('Quote No'))
        est['project_status'] = s(r.get('Status'))
        if acc_at and est['sent_at'] and iso_date(est['sent_at']) > acc_at:
            exc('info', 'quote_date_after_acceptance', pid, f'{s(r.get("Project Name"))}: Airtable quote date {est["sent_at"][:10]} is after the acceptance {ts(acc_at)[:10]} (revised quote?); sent_at set to the acceptance date', '')
            est['sent_at'] = ts(acc_at)
        if not acc_at: acc_at = iso_date(est['sent_at']) or iso_date(est['created_at']) or iso_date(r.get('End Date - ')) or dt.datetime(2025, 4, 30, tzinfo=dt.timezone.utc)
        est['accepted_at'] = ts(acc_at)
        if not est['sent_at']: est['sent_at'] = ts(acc_at)
        if not est['created_at']: est['created_at'] = ts(acc_at)
        if acc_conf == 'low': exc('info', 'accepted_date_assumed', pid, f'{s(r.get("Project Name"))}: no Date Accepted; used start/quote date {ts(acc_at)[:10]}', '')
        if inv and est['total_cents'] and abs(inv - est['total_cents']) > max(100, inv * 0.02):
            exc('info', 'invoice_differs_from_quote', pid, f'{accounts[akey]["name"]} "{s(r.get("Project Name"))}": quote ${est["total_cents"]/100:,.2f} vs invoice ${inv/100:,.2f}', 'normal for variations — invoice amount sits on the job, quote stays on the estimate')
        start = iso_date(r.get('Start Date - ')); end = iso_date(r.get('End Date - '))
        jst = JOB_STATUS.get(s(r.get('Status')).lower(), '')
        if not (s(r.get('Quote URL')) or est['quote_url']):
            exc('warn', 'job_without_quote_url', pid, f'Project "{s(r.get("Project Name"))}" has no PaintScout quote URL on the project or its estimate', 'Tom asked for the estimate link on every job — add the URL in Airtable or accept the gap')
        if s(r.get('Status')) and not jst: exc('warn', 'unknown_job_status', pid, f'Project status "{s(r.get("Status"))}"', '')
        jobs.append(dict(job_key='job_' + hashlib.sha1(pid.encode()).hexdigest()[:10], estimate_key=ekey, account_key=akey, property_key=est['property_key'], quote_url=s(r.get('Quote URL')) or est['quote_url'], work_order_url=s(r.get('Work Order URL')) or est['work_order_url'],
                         matched_by=how, quote_number=s(r.get('Quote No')), project_name=s(r.get('Project Name')), job_type=s(r.get('Job Type ')).strip(),
                         level_of_finish=lof, status=jst, airtable_status=s(r.get('Status')), date_accepted=ts(acc_at), start_date=start.date().isoformat() if start else '',
                         end_date=end.date().isoformat() if end else '', invoice_total_cents=inv if inv is not None else '', gst_cents=cents(r.get('GST')) or '',
                         estimated_hours=s(r.get('Estimated Hours')), actual_hours=s(r.get('Actual Hours')), estimated_materials_cents=cents(r.get('Estimated Materials')) or '',
                         actual_materials_cents=cents(r.get('Total Cost of Materials')) or '', contractor_offer_cents=cents(r.get('Offered Amount')) or '',
                         contractor_invoiced_cents=cents(r.get('Total Amount Contractor has invoiced')) or '', workers=s(r.get('Number of workers ')),
                         notes=(s(r.get('Notes')) + ' ' + s(r.get('Notes 2'))).strip(), airtable_id=pid))
        acc = accounts[akey]
        if (s(r.get('Job Type ')).strip().lower() == 'real estate'): acc['tags'] = 'real-estate'
        if 'commercial' in s(r.get('Job Type ')).lower(): acc['tags'] = 'commercial'
        # events
        if acc_at: ev('estimate_accepted', akey, acc_at, {'total_cents': est['total_cents'], 'quote_number': s(r.get('Quote No')), 'date_confidence': acc_conf}, ekey, est['property_key'], dedupe_key(pid, 'accepted'))
        if start and jst in ('completed', 'in_progress'): ev('job_started', akey, start, {'project_name': s(r.get('Project Name')), 'job_type': s(r.get('Job Type ')).strip()}, ekey, est['property_key'], dedupe_key(pid, 'started'))
        if end and jst == 'completed':
            ev('job_completed', akey, end, {'project_name': s(r.get('Project Name')), 'job_type': s(r.get('Job Type ')).strip(), 'invoice_total_cents': inv, 'level_of_finish': lof}, ekey, est['property_key'], dedupe_key(pid, 'completed'))
            acc['last_job_completed_at'] = max(acc.get('last_job_completed_at', ''), ts(end))
            acc['last_job_completed_type'] = s(r.get('Job Type ')).strip()
        for i, (when, body, why) in enumerate(split_notes((s(r.get('Notes')) + '\n' + s(r.get('Notes 2'))).strip(), acc_at)):
            payload = {'text': body, 'origin': 'airtable_projects_notes'}
            if why: payload['date_note'] = why
            ev('note', akey, when or acc_at, payload, ekey, est['property_key'], dedupe_key(pid, 'pnote', i))

    # accepted estimates without a project: accepted event at quote date
    for e in estimates.values():
        if e['status'] == 'accepted' and not e['accepted_at']:
            when = iso_date(e['sent_at'])
            e['accepted_at'] = e['sent_at']
            ev('estimate_accepted', e['account_key'], when, {'total_cents': e['total_cents'], 'date_confidence': 'low', 'note': 'Won in Airtable but no Projects row'}, e['estimate_key'], e['property_key'], dedupe_key(e['airtable_id'], 'accepted'))
            exc('info', 'won_without_project', e['airtable_id'], f'{accounts[e["account_key"]]["name"]}: Won but no Projects row', 'was the job done? if not, mark declined')
        if e['status'] != 'draft' and not e['level_of_finish']:
            e['level_of_finish'] = 3; e['level_of_finish_assumed'] = 'yes'
        else: e['level_of_finish_assumed'] = ''

    # ---- 5. account-level state -------------------------------------------------
    for akey, acc in accounts.items():
        if acc['is_staff_test']: continue
        ests = [estimates[e] for e in est_by_acct.get(akey, [])]
        if not ests and not acc['is_staff_test']:
            exc('info', 'account_without_estimate', akey, f'{acc["name"]} ({acc["email"] or acc["phone"]}) has no estimate rows', '')
        won = [e for e in ests if e['status'] == 'accepted']
        open_ = [e for e in ests if e['status'] == 'sent']
        if won or open_: acc['temperature'] = acc['temperature'] if open_ else ''
        if ests and all(e['status'] in ('declined', 'expired') for e in ests):
            acc['relationship_state'] = 'lost'; acc['lost_reason'] = acc.get('lost_reason_seen', 'other') if any(e['status']=='declined' for e in ests) else 'no_response'
            acc['temperature'] = 'cold'  # Tom, 16 Sep 2026: mark them lost AND cold
        if ests and all(e['status'] == 'draft' for e in ests): acc['relationship_state'] = 'active'
        tags = set(filter(None, acc['tags'].split(','))); tags.add('airtable-import')
        if acc['company_name']: tags.add('agency')
        if 'kayburton' in acc['email'] or 'propertyme' in acc['email']: tags.add('kay-and-burton')
        acc['tags'] = ','.join(sorted(tags))
        acc['won_cents'] = sum(e['total_cents'] or 0 for e in won)
        acc['estimates_count'] = len(ests)
        ev('account_created', akey, iso_date(acc['first_seen_at']), {'origin': 'airtable_import', 'source': acc['lead_source'], 'account_type': acc['account_type']}, '', '', dedupe_key(akey, 'created'))
        acc.pop('lost_reason_seen', None)

    # ---- 6. write ---------------------------------------------------------------
    def write(name, rows, cols):
        with open(os.path.join(A.out, name), 'w', newline='', encoding='utf-8') as fh:
            w = csv.DictWriter(fh, fieldnames=cols, extrasaction='ignore'); w.writeheader()
            for r in rows: w.writerow({c: ('' if r.get(c) is None else r.get(c)) for c in cols})
    acc_rows = [a for a in accounts.values() if not a['is_staff_test']]
    write('accounts.csv', acc_rows, ['account_key','account_type','name','email','phone_e164','company_name','account_type_reason','relationship_state','lost_reason','temperature','tags','lead_source','first_seen_at','estimates_count','won_cents','last_job_completed_at','last_job_completed_type','other_names','other_phones'])
    write('account_contacts.csv', [c for c in contacts if c['account_key'] in {a['account_key'] for a in acc_rows}], ['account_key','name','email','phone','role','is_primary','notes'])
    write('properties.csv', [p for p in properties.values() if p['account_key'] in {a['account_key'] for a in acc_rows}], ['property_key','account_key','address','suburb','state','postcode','address_norm','type','airtable_refs'])
    write('estimates.csv', sorted(estimates.values(), key=lambda e: e['created_at']), ['estimate_key','account_key','property_key','status','level_of_finish','level_of_finish_assumed','size_band','subtotal_cents','total_cents','created_at','sent_at','accepted_at','declined_at','quote_number','quote_type','estimated_hours','estimated_materials','airtable_status','project_status','date_confidence','follow_up_date','lead_source','quote_url','work_order_url','airtable_id'])
    write('jobs.csv', jobs, ['job_key','estimate_key','account_key','property_key','quote_url','work_order_url','matched_by','quote_number','project_name','job_type','level_of_finish','status','airtable_status','date_accepted','start_date','end_date','invoice_total_cents','gst_cents','estimated_hours','actual_hours','estimated_materials_cents','actual_materials_cents','contractor_offer_cents','contractor_invoiced_cents','workers','notes','airtable_id'])
    events.sort(key=lambda e: e['occurred_at'])
    write('crm_events.csv', events, ['event_key','type','account_key','estimate_key','property_key','occurred_at','source','payload'])
    sev = {'error': 0, 'warn': 1, 'info': 2}
    exceptions.sort(key=lambda x: (sev[x['severity']], x['category']))
    write('exceptions.csv', exceptions, ['severity','category','airtable_ref','detail','suggested_action'])
    summary = dict(accounts=len(acc_rows), agency_accounts=sum(1 for a in acc_rows if a['company_name']), contacts=len(contacts), properties=len(properties), estimates=len(estimates),
                   estimates_by_status=dict(collections.Counter(e['status'] for e in estimates.values())), jobs=len(jobs), events=len(events),
                   events_by_type=dict(collections.Counter(e['type'] for e in events)), exceptions=dict(collections.Counter(x['category'] for x in exceptions)),
                   exceptions_by_severity=dict(collections.Counter(x['severity'] for x in exceptions)),
                   won_total_cents=sum(e['total_cents'] or 0 for e in estimates.values() if e['status']=='accepted'))
    json.dump(summary, open(os.path.join(A.out, 'summary.json'), 'w'), indent=1)
    print(json.dumps(summary, indent=1))

if __name__ == '__main__': main()
