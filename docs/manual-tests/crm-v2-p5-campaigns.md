# Manual test · CRM v2 Phase 5 — campaigns with real rules

Branch `feat/crm-v2-p5-campaigns`. Source: `docs/briefs/crm-v2-deep-dive.md` §4.3 (decisions 8.1 two classes, 8.9 cron
cadence). Automated: `e2e/crm-p5-campaigns.spec.ts` (C1), `lib/crm/segments.test.ts`, `lib/crm/facts.test.ts`,
`lib/campaigns/guard.test.ts`, `sweep.test.ts`, `personalise.test.ts`, `links.test.ts`.

## Migration to paste (one file, idempotent, read-back at the end)

`20270126000000_crm_campaigns_v2.sql` — new audience columns on `crm_account_facts` (last_sent_at, last_estimate_status,
last_accepted_at, last_declined_at, decline_reason, job_types, quoted_cents, dwell_seconds, invoice_state,
invoice_due_on, campaigns_received, last_inbound_at, last_inbound_call_at, last_staff_contact_at); the SQL audience
compiler `crm_audience_where` and its callers `crm_audience_count / _sample / _ids / _match`; `crm_segments.rules`
(the three starters rewritten); `campaigns.class / entry / trigger_event / exit_rules / conversion_days /
events_since / last_swept_at` and the steps converted to `afterDays`; enrolments anchored (`anchor_at`,
`anchor_key`, unique per campaign + account + anchor); `campaign_messages.campaign_id / condition / clicks`;
`crm_campaign_mark_conversions`, `crm_campaign_stats`; every facts row marked stale.

Expect ONE row: `facts_columns` true, `functions_ok` true, `segments_with_rules` 3 (or more), `steps_converted` true,
`enrolments_anchored` true, `messages_without_campaign` 0, and `compiler_smoke` = `((f.won_cents > 0))`.

**Then, once:** `curl -H "Authorization: Bearer $CRON_SECRET" "https://<site>/api/cron/crm-sweep?rebuild=1"` so the new
columns are filled today rather than over the next few daily sweeps. Until they are, a rule on "estimate sent" or
"job type" reads empty for rows the refresher has not reached.

**vercel.json:** the campaign sweep runs every 30 minutes (Vercel Pro, decision 6.9 — Tom upgraded 7 Sep). The
guard enforces the C11 window on every send, so a night-time sweep only enrols, judges exits and queues; hour-level
steps (`afterHours`) now land within the half hour.

## Walk

1. **Campaigns → Audiences → New list.** Group 1 "all of these": Latest quote · is any of · Sent, no answer.
   "+ Another group": "any of these": Suburb is Kew; Tags has any of VIP. Flip a rule to NOT with the is/not
   chip. **Who matches right now?** counts in the database (27k accounts, well under a second) and shows twenty
   names. Save → the list appears with its count. Lists built before today show "check & re-save": open one,
   the translated rules are there, save once.
2. **Campaigns → Start a campaign.** Name it, kind **Quote follow-up**, "Starts when something happens" ·
   an estimate is sent. On the builder: the four exits that are always on for a follow-up wear "always";
   step 1 = text, 3 days after, "Only if they haven't opened the estimate"; step 2 = email, 7 days after,
   "Only if they opened it and went quiet". Pick an approved text and email. Save. **Who would get this?**
   scans real `estimate_sent` events since the campaign was created (none yet → the note says so).
   Status → live.
3. **Send an estimate** to a test customer (or backdate `campaigns.events_since`), then Campaigns → Queue →
   **Sweep now**. Nothing queues until the step is due (3 days from the send) — the reason is in the sweep
   message. When it is due: the card reads "…step 1 · text · follow-up", "only if unopened".
4. **The guard at approval.** Open that customer's estimate as them (an open), then Approve & send → "Not
   sent — They opened it — this step isn't needed." The row is stopped, the enrolment continues to step 2.
   Reply to them as the customer (or insert an inbound message) → the next approval reads "They replied.
   They're out of the campaign." and the enrolment is finished with that reason.
5. **Marketing to a list.** New campaign, kind Marketing, "Goes to everyone on a list", the list from step 1,
   one email step after 0 days. Live → Sweep now → every match is queued (a declined email permission or
   do-not-contact is finished at the sweep, not queued). Queue: **Select all → Approve & send N** — each one
   still walks the chain; the summary says how many sent / held for the window / refused. Approve one at
   7pm: "Approved — held: Outside sending hours. It goes out on its own when it can." — the morning sweep sends it.
6. **Auto-send.** On the builder, tick Auto-send (the message says exactly what that means). The next sweep
   delivers due messages inside the window without a person. Off by default; a follow-up still exits on any answer.
7. **Tokens.** In an email or text, `{{first_name}} {{suburb}} {{estimate_total}} {{last_job_date}} {{estimator}}`
   fill per recipient (chips in the text studio; the email studio lists them). A test send shows them unfilled by
   design; a real send fills them.
8. **Analytics.** The builder's "How it's going": enrolled / sent / delivered / opened / clicked / replied /
   unsubscribed / converted / revenue. Opens come from the Resend webhook (P3), clicks from the tracked links
   (`/t/<token>` — every http link in a campaign email, never the unsubscribe link), replies from the messages
   spine, conversions from an `estimate_accepted` event inside the window after a send.
9. **The record.** The timeline shows "Campaign message sent" and "Clicked a campaign link"; Today shows the
   approvals item as before.

## Traps found building it

- `auth.role()` is what lets the service role through the audience functions; the C1 `postgres` role is
  neither staff nor service_role and is refused — that is the guard working.
- Waits count from the anchor, so a campaign created today only sees events from today (`events_since`).
  To run a sequence against an estimate sent last week, backdate `events_since`.
- `crm_events` is append-only: the e2e cannot backdate an event's `occurred_at`; it backdates `anchor_at`
  on the enrolment instead.
- An event campaign's candidates are the NEW events since `events_since` PLUS every unfinished enrolment
  (`ongoing()` in runSweep) — without the second half, step 2 of a sequence never came due once the event
  scan had moved past the event that started it.
- A hundred accounts can carry four hundred estimates; an `in` list that long is a 15 KB URL the request
  layer refuses ("fetch failed"). Estimate-keyed loads in `factsInput.ts` now go in slices of 120 ids —
  this also explains a rebuild that stopped part-way.
- A step skipped by its condition still consumes its send key (a stopped row) so the enrolment moves on;
  otherwise the sweep would re-queue the same step every morning.
- On C1 there is no marketing Resend key and Twilio refuses, so a delivery that passes every guard ends
  `failed` with the reason on the row — the guard verdicts before it are what the e2e asserts.
