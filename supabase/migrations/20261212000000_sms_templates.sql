-- =============================================================================
-- Campaigns · text messages as first-class templates
--
-- The engine has carried channel email|sms since 20261209 — steps, queued
-- messages and the guard all know it. What was missing is CONTENT: a template
-- was always an email. A text template is the same row wearing kind='sms',
-- with its words in sms_body — which means approval (approved_at), the picker
-- and the queue all work on texts with no new machinery, and the send guard's
-- "nobody has read this yet" check covers both channels for free.
-- =============================================================================

alter table public.campaign_templates
  add column if not exists kind text not null default 'email'
    constraint campaign_templates_kind_check check (kind in ('email', 'sms')),
  add column if not exists sms_body text not null default '';

comment on column public.campaign_templates.kind is
  'email = subject/preheader/blocks; sms = sms_body. Same approval flow either way.';
comment on column public.campaign_templates.sms_body is
  'The text message, before rendering: tokens {{estimate}}/{{account}} allowed; sender name and Reply STOP are appended at send time, never typed.';

-- ---- Verification -----------------------------------------------------------
-- select kind, count(*) from campaign_templates group by kind;   -> existing rows all 'email'
