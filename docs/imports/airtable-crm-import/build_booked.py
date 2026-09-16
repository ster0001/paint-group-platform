import json,csv,hashlib,re,collections,os
W=json.load(open('wo/workorders.json'))
B=json.load(open('wo/view_booked.json'))+json.load(open('wo/view_needs.json'))
recs={r['id']:r['fields'] for r in B}
def cents(x): return int(round((x or 0)*100))
def norm_email(e): return (e or '').strip().lower()
def akey(email): return 'acc_'+hashlib.sha1(('e:'+email).encode()).hexdigest()[:10]
jobs=[]; est_rows=[]; area_rows=[]; line_rows=[]; sched_rows=[]; issues=[]
for w in W:
    f=recs[w['airtable_id']]; q=w['quote']
    email=norm_email(f.get('Email')); phone=str(f.get('Phone') or '')
    total_inc=q['total_inc']; sub_ex=round(q['subtotal_ex']+(q['options_accepted'] or 0)+(q['discount'] or 0),2)
    note=w.get('note','')
    if abs(total_inc-(w['invoice_inc_gst'] or 0))>0.05:
        if w['quote_no']=='3108':
            total_inc=w['invoice_inc_gst']; sub_ex=round(total_inc/1.1,2); note=(note+' ').strip()+' Kitchen door option ($724.50 ex GST, 7.5h) was accepted after the quote — using the invoice figure $10,087.21 and 92h.'
            q['areas'].append(['Kitchen',724.5])
        else:
            note=(note+' ').strip()+f' Airtable Invoice Amount {w["invoice_inc_gst"]} does not match the PaintScout total {total_inc} — PaintScout figure used (Airtable looks like a typo or an ex-GST figure).'
        issues.append((w['quote_no'],w['project'],note.strip()))
    lof={'Level 2':2,'Level 3':3,'Level 4':4}.get(f.get('Level of Finish ') or '',3)
    jtype=(f.get('Job Type ') or '').strip(); alltext=' '.join(a[0] for a in w['A']).lower()
    jt='interior' if 'interior' in jtype.lower() else 'exterior' if 'exterior' in jtype.lower() else ('exterior' if any(k in alltext for k in ('weatherboard','render','fascia','soffit','eaves','deck','exterior')) else 'interior')
    job=dict(quote_no=w['quote_no'],view=w['view'],airtable_status=f.get('Status'),project_name=w['project'],customer_name=f"{f.get('First Name','')} {f.get('Last Name','')}".strip(),
             email=email,phone=phone,account_key=akey(email) if email else '',address=f.get('Address Line 1'),suburb=f.get('Suburb'),postcode=f.get('Zip / Post Code'),paintscout_address=w.get('addr',''),
             job_type=jtype,job_type_norm=jt,level_of_finish=lof,level_of_finish_assumed=('' if f.get('Level of Finish ') else 'yes'),
             quote_url=w['quote_url'],work_order_url=w['wo_url'],subtotal_ex_gst_cents=cents(sub_ex),gst_cents=cents(total_inc)-cents(sub_ex),total_inc_gst_cents=cents(total_inc),
             discount_ex_gst_cents=cents(q.get('discount') or 0),discount_label=q.get('discount_label',''),options_accepted_ex_gst_cents=cents(q.get('options_accepted') or 0),
             total_hours=w['sum_hours'],airtable_estimated_hours=w['airtable_hours'],estimated_materials_cents=cents(f.get('Estimated Materials')),contractor_offer_cents=cents(f.get('Offered Amount')),
             start_date=w['start'] or '',end_date=w['end'] or '',number_of_workers=f.get('Number of workers ') or 0,assigned_painter=', '.join(f.get('Worker Assigned') or []),assigned_painter_email=', '.join(f.get('Worker Assigned Email') or []),
             painter_accepted=', '.join(f.get('Accept Decline Status Rollup (from Acceptance Log)') or []),date_accepted_ms=f.get('Date Accepted'),
             deposit_recorded='yes' if f.get('Payments 4') else 'no',notes=(f.get('Notes') or '').strip(),import_note=note.strip(),
             dims=w['dims'],areas=[],unaccepted_options=q['unaccepted_options'])
    price_pool=collections.defaultdict(list)
    for n,v in q['areas']: price_pool[n.strip().lower()].append(v)
    for a in w['A']:
        name,dim,prep,paint,tot,items=a
        pl=price_pool.get(name.strip().lower()); price=pl.pop(0) if pl else None
        L=Wd=H=None
        if dim:
            try:
                nums=[float(p) for p in dim.split('x') if p]
                if len(nums)==3: L,Wd,H=nums
                elif len(nums)==2: L,Wd=nums
                elif len(nums)==1: L=nums[0]
            except: pass
        job['areas'].append(dict(name=name,price_ex_gst_cents=cents(price) if price is not None else None,hours_prep=prep,hours_paint=paint,hours_total=tot,length_m=L,width_m=Wd,height_m=H,
                                 items=[dict(item=i[0],qty=i[1],unit={'n':'count','m2':'m2','m':'m'}[i[2]],hours=i[3],coats=i[4]) for i in items]))
    unpriced=[(n,v) for n,vs in price_pool.items() for v in vs]
    if unpriced:
        for n,v in unpriced: job['areas'].append(dict(name=n.title(),price_ex_gst_cents=cents(v),hours_prep=None,hours_paint=None,hours_total=None,length_m=None,width_m=None,height_m=None,items=[],note='priced on the quote but not shown as an area on the work order'))
    jobs.append(job)
    est_rows.append({k:v for k,v in job.items() if k not in ('areas','dims','unaccepted_options','notes')})
    for i,a in enumerate(job['areas']):
        area_rows.append(dict(quote_no=job['quote_no'],area_order=i+1,area=a['name'],price_ex_gst_cents=a['price_ex_gst_cents'],hours_prep=a['hours_prep'],hours_paint=a['hours_paint'],hours_total=a['hours_total'],length_m=a['length_m'],width_m=a['width_m'],height_m=a['height_m'],note=a.get('note','')))
        for j,it in enumerate(a['items']):
            line_rows.append(dict(quote_no=job['quote_no'],area_order=i+1,area=a['name'],line_order=j+1,item=it['item'],qty=it['qty'],unit=it['unit'],coats=it['coats'],hours=it['hours']))
    sched_rows.append(dict(quote_no=job['quote_no'],project_name=job['project_name'],view=job['view'],airtable_status=job['airtable_status'],start_date=job['start_date'],end_date=job['end_date'],total_hours=job['total_hours'],number_of_workers=job['number_of_workers'],assigned_painter=job['assigned_painter'],assigned_painter_email=job['assigned_painter_email'],painter_accepted=job['painter_accepted'],contractor_offer_cents=job['contractor_offer_cents'],deposit_recorded=job['deposit_recorded'],notes=job['notes']))
os.makedirs('out/booked',exist_ok=True)
json.dump(jobs,open('out/booked/booked_jobs.json','w'),indent=1)
def w(name,rows):
    cols=list(rows[0].keys())
    with open('out/booked/'+name,'w',newline='',encoding='utf-8') as fh:
        wr=csv.DictWriter(fh,fieldnames=cols); wr.writeheader(); [wr.writerow(r) for r in rows]
w('booked_estimates.csv',est_rows); w('booked_estimate_areas.csv',area_rows); w('booked_work_order_lines.csv',line_rows); w('booked_schedule.csv',sched_rows)
summary=dict(jobs=len(jobs),booked=sum(1 for j in jobs if j['view']=='booked'),needs_booking=sum(1 for j in jobs if j['view']=='needs'),areas=len(area_rows),lines=len(line_rows),
             total_inc_gst=sum(j['total_inc_gst_cents'] for j in jobs)/100,total_hours=round(sum(j['total_hours'] for j in jobs),2),contractor_offers=sum(j['contractor_offer_cents'] for j in jobs)/100,
             areas_without_price=sum(1 for a in area_rows if a['price_ex_gst_cents'] is None),issues=issues)
json.dump(summary,open('out/booked/summary.json','w'),indent=1); print(json.dumps(summary,indent=1))
for j in jobs:
    s=sum(a['price_ex_gst_cents'] or 0 for a in j['areas']); exp=j['subtotal_ex_gst_cents']-j['discount_ex_gst_cents']
    if abs(s-exp)>2: print('price-sum check',j['quote_no'],s,exp)
