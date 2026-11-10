# Automations in Campaigns — session 0 diagnostic
**Read-only. 6 Nov 2026, against `main` 7809bd94.** Repo only: no database, env vars, or Resend/Twilio dashboards were read, so anything about what is live is marked unverified. Brief: `claude-code-brief-automations-campaigns.md`. Companion: `estimates-tab-session-0.md`.

**The main finding:** the brief assumes no automation engine exists. One does, with 102 keys. Its `automations` and scheduled `automation_runs` tables would be a **third engine** beside the registry and Campaigns. The recommendation is to extend what is there. §9 lists the rulings needed before session 1.

---

## 1. §2 of the brief, with real states

| Need | Brief's guess | Real state | Action |
|---|---|---|---|
| Automations screen | missing | **Exists at Settings → Automations**, not in Campaigns. Switch, channel, mode, timing, wording, preview, test send | Decide placement. No second switch screen |
| Stage + wait trigger | missing | Date and age sweeps exist; no stage trigger | Add a stage-sourced sweep |
| Per-automation on/off | missing | **Exists, default ON** | New keys must ship disabled (§3) |
| Chat channel | partial | Sent estimates only; branded card email; replies do not reach the thread | §4 |
| Brand senders | partial | Text partly; `from` at two call sites; SMS none | Extend the dispatcher |
| Staff alerts by hours | missing | Per-person SMS and email exist; no hours routing; dock has no general alert feed | Add routing and a dock source |
| Quiet hours | unknown | **Exists with different values**, all channels | Change values, make SMS-only |
| Stats | partial | Campaigns yes; automations none, though `messages.meta.automation` is stored | Report from `messages` |

---

## 2. The existing engine

- **`lib/automations/registry.ts`:** 102 keys (84 automatic, 16 manual, 2 planned).
- **`decide.ts` / `dispatch.ts`:** `sendAutomation` resolves to off, nobody, pending, hold or send.
- **Approval:** `automation_holds` feeds `/crm/messages/queue`, surfaced as a derived `message_approval` work item. Eight keys default to approve, including `deposit_reminder` and `customer_updates_queue`.
- **Re-check at release:** `stillNeeded.ts`, so a held message is not sent once it is no longer true.
- **Idempotency:** `automation_claims` primary key, `staff_notifications` claim, or row stamps.
- **Scheduling:** no schedule field. Most keys fire at the event's send site; sweeps run at 18:00, */30 and hourly. `gcal-sweep` already runs */5, so a 5-minute sweep is viable.

Campaigns is a second system: event or audience entry, 7 triggers, step sequences (`afterDays`/`afterHours`, email or SMS, condition), exit rules, `{{double}}` tokens (the brief uses `{single}`), `campaign_messages`, `crm_campaign_stats`, guarded idempotency. It has no chat channel and no brand field, and its sender is hard-coded Paint Group on a separate Resend account (`lib/campaigns/send.ts:22`).

`docs/briefs/claude-code-brief-campaign-studio-referrals.md` does not exist; the code is the only record. **Tom to waive or supply.**

---

## 3. Two traps that would send to real customers

1. **New keys go live on deploy.** `automationOn` treats "absent from `disabled`" as on (`lib/messaging/config.ts:683`), and stored settings replace the default. "All shipped off" cannot be done by adding keys. It needs a default-off flag on the key, built and tested **before** the first new key lands.
2. **STOP does not reach automations.** The STOP handler writes `marketing_unsubscribed_at` and `permit_sms = declined` (`app/api/sms/inbound/route.ts:71-77`). `sendAutomation` reads only `notify_prefs` (`lib/messaging/send.ts`), so only the campaign guard honours STOP. Harmless-ish for service messages; L1, L5 and L7 are promotional texts and **must not ship until this is fixed**. R5's "Reply STOP and I won't message again" would be untrue.

---

## 4. R1, the chat rule, cannot be built on today's chat

- **There is no thread object.** `estimate_messages` is one list per estimate. `sendChat({threadId})` has nothing to bind to. Pre-range chat is `agent_conversations`; job updates are `wo_updates`.
- **Sent estimates work.** A never-logged-in customer can read `/e/[token]#chat`.
- **Wizard-only leads have no page.** `share_token` is null until their first message, `/e` requires `sent_at` (M:20270204:75), the portal lists sent estimates only, and `postStaffChatReply` skips notifying when there is no token. **L2, L3, L4, L6 and L10's customer chat cannot work as specified**, and those are the core of the lead sequence.
- **Notification email is not plain.** It is a branded card with a Respond button (`send.ts:310`) from `EMAIL_FROM`, never the estimator's name.
- **Customer replies miss the thread.** `/api/inbound/messages` stores a `messages` row and relays to the office. Nothing under `app/api/inbound` or `app/api/sms` writes `estimate_messages`. The mockup's "reply by email → thread" does not exist.
- **Replies are inert until configured.** Needs `REPLY_DOMAIN` and `MESSAGES_INBOUND_SECRET`; not checked.
- **Reply to an SMS** needs `TWILIO_FROM` to be a number. An alphanumeric "PaintHome" sender ID cannot take replies, which conflicts with L11's "Reply to this message". Not checked which is in use.
- **"The only customer emails":** 30 of 38 customer keys include email (invoices, sign-in links, PDFs). R1 can only apply to the new keys unless that scope is widened.
- **Unverified:** `app/api/inbound/messages/route.ts:74` selects `messages.kind`, which no migration creating that column was found for, while `e2e/crm-p3-messages.spec.ts:115` asserts the path. Check on the database.

---

## 5. Master-plan keys against what sends today

| Key | Today |
|---|---|
| L1–L4, L7 | None. `wizard_abandoned` (email, 45 min idle) is the only nudge |
| L5–L6 | Same, partial |
| L8 | None |
| L9 | `wizard_help` work item, `customer_message` email, handoff SMS. No hours routing |
| L10, L13 | `visit_request` work item; customer acks. No staff alert |
| L11 | `visit_reminder` −1 day at 18:00 only. No −2 h |
| L12 | `visit_rebook` work item. No SMS |
| E1 | No alert. Stage `visit_done_no_reply` exists |
| E2–E7 | No key. `office_followups_digest` emails Tom at +3 days |
| E8 | `office_estimate_chat` + dock |
| E9, E12 | None |
| E10 | `office_estimate_expired`, staff only |
| E11 | Reason taken at Decline. No chips |
| W1 | `customer_accepted_welcome` |
| W2 | `deposit_reminder`: two rungs, approve default. R6 replaces it |
| W3, W4 | None as SMS |
| W5 | `customer_updates_queue`, must stay there |
| W6 | `invoice_reminder` |
| R1 | **Nothing sends.** `review_request` is `planned` with no channels. The plan's "built in WO loop" is wrong |
| R2 | None; no referral tables, so `{referral_link}` and `{reward_text}` have no source |
| R3–R5 | None (`warranties` table exists; segments could carry R5) |

`docs/briefs/messaging-automations-inventory.md` is stale: 32 registry keys missing, and §3 contradicts itself. The acceptance "inventory diff" needs it refreshed first.

---

## 6. Brand, consent, trade, settings

- **Brand:** `sendEmail` accepts `from`, but `AutomationSend.email` has no such field (`dispatch.ts`), so no automation can brand its sender. `sendSms` uses one `TWILIO_FROM`. `brand.ts:44` marks the Paint Home domain unverified; current state not checked.
- **Paint Home mark leaks today:** `chatReply.ts:44`, `moneySignoff.ts:229` use the raw company, and STOP/HELP replies say Paint Group. Against R3 now, before any of this.
- **Estimator as sender:** never. `company.estimatorName` is one global value. "Sarah from Paint Home" needs a per-estimator address for each brand.
- **Consent:** `consent_marketing` does not exist. Real fields are `accounts.permit_email/sms`, `consents`, `marketing_unsubscribed_at`, `notify_prefs`. The gate tick is optional.
- **Trade:** `accounts.account_type = 'trade'`. No cadence concept.
- **Settings:** `settings(key, value jsonb)`. `brands` row keyed `paintgroup`/`painthome`, and `companyForBrand` reads defaults, not that row. `profiles.phone`, `profiles.staff_notify`. No admin or sales role traced in this path.
- **Hours:** see the Estimates report §9; three different hardcoded definitions, none matching.

---

## 7. `CLAUDE.md` conflicts

| Rule | Conflict | Resolution |
|---|---|---|
| One customer-updates queue | W5 falls under it; so does "no approval queue" vs its approve switch | W5 stays `wo_updates`. W1–W4, W6, R1 sit outside its in-progress gate |
| One work queue | L8, E3-task, E6 stored in `automation_runs` | Derive them in a `work-queue.ts` source from stage + age |
| Event types | `message.sent`, `staff.alerted`, `message.replied` fail the CHECK | Underscore names |
| Tenancy | Proposed tables have no `tenant_id` | Add, if tables are added |
| Evaluate "on every insert" | Cannot be an app hook; 7 migrations write events in SQL | The sweep derives what is due |
| Idempotency index | `(key, estimate_id, wizard_session_id)` has no `step` and null estimate for leads, yet L11, E3, E9, W1 send several | Use `automation_claims` keyed with step |
| Help path | `docs/help/automations.md` | `docs/help/automations/<role>.md` |

---

## 8. Plan-level contradictions for Tom

- **Placement:** R10 says CRM → Automations, the briefs say Campaigns › Automations, the live screen is Settings → Automations, and `CrmTabs` treats a fifth top-level tab as a defect.
- **"No approval queue" vs today:** `deposit_reminder` defaults to approve; W2 replaces it. Are the eight approve-mode keys unaffected?
- **Master is v2:** R11–R16 are known only through the briefs.
- **Order:** the plan's §7 puts Estimates tab before engine, and says 5–6 wait for the v5 wizard; that build has since merged.

---

## 9. Proposed rulings before session 1

| # | Decision | Proposal |
|---|---|---|
| A‑A | Engine | ✅ **RULED 11 Nov (Tom): extend registry + dispatcher + claims. No `automations` table, no scheduled runs.** Sweeps derive what is due, so exit-on-stage-change comes free |
| A‑B | What is genuinely new | Per-brand wording table; send stats read from `messages`; a thin run log only if "next due" needs one |
| A‑C | Screen | One screen. Move or link the existing one so Campaigns › Automations shows the funnel keys, Settings keeps the rest. Tom chooses |
| A‑D | Default off | Add default-off to the registry first, tested, before any key |
| A‑E | STOP | **Fix now, as its own PR**: `sendAutomation` honours `permit_sms`/`marketing_unsubscribed_at` for non-service keys |
| A‑F | Lead chat | Give leads a token page showing their range and chat, opening `/e` to a new "lead" state. **Largest new piece; touches the "customers see snapshots" rule**, which needs a snapshot of the range |
| A‑G | Replies | Route inbound email and SMS into `estimate_messages`; confirm `REPLY_DOMAIN` and whether `TWILIO_FROM` is a number |
| A‑H | Senders | Per-estimator, per-brand addresses. **Needs the Paint Home domain verified in Resend and a sender decision for SMS** |
| A‑I | R1 scope | Applies to the new keys only |
| A‑J | Consent list | Map `consent_marketing` → `permit_*` |
| A‑K | Review request | R1 is new, not a migration. Confirm wording and review link |
| A‑L | R2 referral | Out of scope until referral tables exist |
| A‑M | Campaign studio brief | Waive; code is the record |
| A‑N | Quiet hours | 20:00–08:00 replaces current values for SMS; email and chat exempt. Check this suits the existing keys, since the change affects all |

**Suggested order:** Estimates sessions 1–2 (events, stage), then STOP fix + default-off + hours in one place, then lead page + replies, then keys. Wizard-lead automations cannot go on until A‑F and A‑G are done.
