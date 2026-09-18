-- The tenant photo text gets its reassurance back (Tom, 18 Sep 2026).
--
-- A tenant receives an unexpected SMS from a painting company asking them to
-- photograph their home. The wording that makes that land — who we are, who
-- asked, and that it is NOTHING TO DO WITH THEIR BOND OR THEIR LEASE — was
-- written in lib/portal/tenant-link.ts and unit-tested there, and then stopped
-- being sent: the automations control screen (16 Sep) made the message a
-- Settings field, the send path uses that field whenever it is non-blank, and
-- the shipped default was a terser line. The code default is fixed in the same
-- PR as this file; this migration is for the projects where the old default is
-- already SAVED in settings.messaging, which is every project where anyone has
-- pressed Save on that screen — so the code fix alone changes nothing there.
--
-- Only the OLD DEFAULT is replaced. A message somebody deliberately wrote is
-- left exactly as it is: this matches on the full old string, not on a prefix.

update public.settings
   set value = jsonb_set(
         value,
         '{tenantLinkSms}',
         to_jsonb(
           'Hi — this is {{company_name}}, painters. {{who_asked}} to quote some painting at {{address}}. '
           'Could you take a few photos on your phone so we can plan it without a visit? '
           'It''s nothing to do with your bond or your lease. '
           'Photos go here: {{link}}'::text)
       )
 where key = 'messaging'
   and value ->> 'tenantLinkSms'
     = '{{company_name}}{{agency_line}}: photos and a quick look at the painting planned for {{address}} are here: {{link}}';

-- Read this back: `bond_line` must be true wherever a messaging row exists.
-- (No row at all is fine — that project falls through to the code default,
-- which now carries the same words.)
select key,
       (value ->> 'tenantLinkSms') like '%bond or your lease%' as bond_line,
       (value ->> 'tenantLinkSms') like '%{{who_asked}}%'      as has_who_asked
  from public.settings
 where key = 'messaging';

insert into public._prod_migrations(name) values ('20270173000000_tenant_sms_bond_line.sql') on conflict (name) do nothing;
