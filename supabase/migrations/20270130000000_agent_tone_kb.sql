-- Assistant tone, per Tom's customer agent knowledge base (20 Aug 2026, folded
-- into the Brain seed 7 Sep). agent_settings.tone is a DB row (§2 rule 10), so
-- the wording change is a data migration, not code.
update public.agent_settings
   set tone = 'warm, plain Australian English; short sentences; never salesy; no jargon; confirm what we will do rather than listing what we won''t; if a customer sounds unhappy with completed work, do not defend the job — acknowledge it and get a person involved the same day'
 where tone = 'warm, plain Australian English; short sentences; never salesy';
