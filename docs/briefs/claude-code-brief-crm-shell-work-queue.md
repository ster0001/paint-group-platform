# Build brief — CRM Shell & Work Queue

**Module:** the navigation shell, and the single work queue that feeds it
**Repo:** `paint-group-platform` · Next.js 16 App Router + TS + Tailwind + Supabase
**Status:** DRAFT — 11 flagged decisions in §7. §7.1 (follow-up rules) blocks session 3.
**Sequencing:** **Phase 2A**, immediately after the CRM event spine and before the directory, inbox and campaign work. It defines the shape every later module plugs into, so building it late means retrofitting all of them.

**This brief amends five others.** See §2 before building anything from them.

---

## 0. Read first

**Reference files — `docs/briefs/`**
| File | Why |
|---|---|
| `claude-code-brief-crm-shell-work-queue.md` | this brief |
| `claude-code-brief-crm-retargeting.md` (rev 2) | master plan and event spine |
| `claude-code-brief-customer-directory-inbox.md` | directory and inbox — **amended by §2.2 and §2.3** |
| `claude-code-brief-campaign-studio-referrals.md` (rev 2) | campaigns — **amended by §2.4** |
| `claude-code-brief-visit-booking.md` | diary, callbacks, no-shows — **amended by §2.5** |
| `claude-code-brief-invoicing-payments.md` | `lib/invoicing/attention.ts` — the existing queue this generalises |
| `CLAUDE.md` | engineering standards, STOP-and-report rule |

**Design reference — `design/reference/`**
| File | Why |
|---|---|
| `crm-workflow-simplified-mockup.html` | **the target.** Four tabs, Today as the hub, campaigns split, sorting on customers |
| `customer-record-mockup.html` | the record every work item opens into |
| `customer-directory-inbox-mockup.html` | directory rows and conversation view, now nested under Customers and Today |
| `crm-board-mockup.html` | board — now a view mode inside Customers, not a tab |

**STOP-and-report applies.**

---

## 1. The ruling

**Four tabs. Everything else is a view of one of them.**

| Tab | Holds | Replaces |
|---|---|---|
| **Today** | Everything needing a human, from any source | the inbox tab, the attention queue, the board's amber cards, the campaign approval queue |
| **Customers** | All 418, as a list or a board | the separate directory and board tabs |
| **Campaigns** | Setting things up and seeing if they worked | the old campaigns tab, minus approvals |
| **Diary** | Visits and jobs scheduled | the visit calendar |

**The durable rule, binding on every module built from here:**

> A module that needs to tell a person something emits a **work item**. It does not build its own list, badge, inbox or queue.

That rule is what stops the app growing a seventh place to check. It applies to modules that don't exist yet.

**On a normal morning, only Today should need opening.** If something regularly reaches a person through another tab first, that's a routing defect, not a preference.

---

## 2. Amendments to existing briefs

Apply these before building from the briefs concerned. Where a brief and this document disagree, this one wins.

### 2.1 Master plan (`crm-retargeting.md` rev 2)
Add Phase 2A between 2.1 (event spine) and 2.2 (timeline). The board described in §3 becomes a **view mode inside Customers**, not a top-level destination.

### 2.2 Directory (`customer-directory-inbox.md` §2)
The directory becomes the **Customers** tab. Add sort control per §4.3. Add the List / Board toggle. Groups stay as specified, except **"Waiting on you" is removed** — those customers appear in Today instead. The directory shows everyone; Today shows what's outstanding. One fact, one home.

### 2.3 Inbox (`customer-directory-inbox.md` §3)
The inbox is **not a tab**. Its thread list becomes the *Messages* filter of Today. The conversation view stays exactly as specified and is reached from Today, from the customer record, and from search. Everything in §3 about providers, threading, matching, deliverability and message classes is unchanged and still binding.

### 2.4 Campaigns (`campaign-studio-referrals.md` rev 2)
Split the tab in two:
- **Always on** — automations, each with a toggle and live results (enrolled, sent, replied, converted, value)
- **Broadcasts** — one-off sends, each with a status and, once sent, a results strip

**The approval queue moves out of Campaigns and into Today** as a work item type. Everything about drafting, guards, the claim validator, photo slots and send modes is unchanged. Only its location changes.

### 2.5 Visit booking (`visit-booking.md`)
The estimator day view becomes the **Diary** tab. Callback requests, no-shows needing a rebook, and thin-day warnings emit work items rather than living in their own list.

---

## 3. The work queue

### 3.1 Derived, never stored

Same principle as stage. A work item is not a row someone creates and ticks off — it is a **fact about the world, computed**. Sarah's question is outstanding because no reply has been sent, not because a task exists.

`lib/crm/work-queue.ts` — one evaluator, called by Today, by the badge count, and by anything else that needs to know what's outstanding. This generalises `lib/invoicing/attention.ts`; that file is folded in, not duplicated. **Two implementations of "what needs attention" is a single-source violation.**

### 3.2 Item shape

```ts
type WorkItem = {
  key: string            // deterministic, stable across recomputes — §3.4
  kind: WorkItemKind     // §3.3
  accountId: string
  subjectRef: {...}      // message, estimate, invoice, work order, visit, campaign message
  title: string          // "Sarah Mitchell asked a question"
  detail: string         // one line of context, drawn from the record
  since: Date            // when it became outstanding
  dueAt: Date | null     // when it goes overdue
  bucket: 'overdue' | 'today' | 'waiting'
  priority: number       // §3.6
  action: { label: string; href: string }   // exactly one
}
```

**Exactly one action per item.** An item offering three choices is an item nobody has decided the shape of.

### 3.3 Kinds, and their sources

| Kind | Outstanding when |
|---|---|
| `message_unanswered` | Inbound email, SMS or chat with no outbound reply since |
| `message_unmatched` | Inbound mail that couldn't be matched to an account |
| `followup_due` | A follow-up rule has fired (§3.5) |
| `snooze_expired` | A staff-set snooze date has passed |
| `callback_requested` | A callback form submitted, not yet called |
| `approval_pending` | A campaign message drafted and awaiting approval |
| `invoice_action` | Deposit unpaid, invoice overdue, chase due |
| `visit_rebook` | No-show or cancellation needing rescheduling |
| `variation_pending` | A variation awaiting pricing or a decision |
| `signoff_due` | A walkthrough waiting on sign-off, including the deemed ladder |
| `broadcast_incomplete` | A broadcast with unfilled photo slots or unconfirmed claims |
| `consent_missing` | A completed job with no photo consent recorded |

Each kind is a small, separately testable source function returning candidate items. Adding a kind is one function plus a registry entry — never a change to the queue itself.

### 3.4 Item keys

Deterministic and stable: `kind:subjectType:subjectId:discriminator`, e.g. `message_unanswered:thread:8f2a...`. The same underlying fact must produce the same key on every recompute, or dismissals and read-state break.

### 3.5 Follow-up rules

The rules that turn silence into work. All thresholds in Settings, none in code. ⚑7.1.

| Rule | Fires |
|---|---|
| Quote sent, not opened | after *N* days |
| Quote opened, no reply | after *N* days from first open |
| Opened repeatedly, no reply | *N* opens with no reply — a strong buying signal being ignored |
| Visit done, no decision | *N* days after the visit |
| Revision sent, no reply | after *N* days |
| Lead with no contact attempt | *N* hours after the enquiry |
| Past customer untouched | *N* months with no contact and no open work |

A rule stops firing the moment the underlying fact changes. Reply to Sarah and the item disappears — nothing to tick.

### 3.6 Priority

One pure function, `priority(item)`. Inputs: overdue amount, value at stake, temperature, lead source, whether a promise was made to the customer, and kind weight. ⚑7.2 for the weighting.

Two rules that shouldn't be negotiable:
- **A promise made to a customer outranks value.** Telling Denise she'd have the breakdown by the 10th beats a larger job with no commitment attached.
- **Anything customer-visible outranks anything internal.** An unanswered question beats an internal approval.

### 3.7 Dismissal and snooze

Derived items can't be "completed" — but some legitimately need to go away: you rang and they said call back next month; the callback request was a duplicate; a rule fired on something that doesn't apply.

```sql
work_item_dismissals (
  id, item_key text not null, account_id uuid,
  dismissed_by uuid, dismissed_at timestamptz,
  until timestamptz null,       -- null = permanent for this instance
  reason text not null,         -- required, never optional
  created_at timestamptz
)
```

- A dismissal suppresses that key until `until`, or permanently for that instance.
- **Reason is required.** Repeated dismissals of the same kind are evidence your thresholds are wrong, and you can only see that if the reasons are recorded.
- A dismissal writes a `crm_events` row, so it shows on the timeline.
- If the underlying fact changes and re-fires with a new discriminator, it reappears. Dismissing "quote gone quiet at 4 days" doesn't suppress "quote gone quiet at 10 days".

### 3.8 Performance

The queue is loaded constantly, so it can't be a full table scan.

- Each source function is an indexed, bounded query. No source may return more than a configured cap.
- Queue computation is per user and cached for a short window, invalidated on any `crm_events` write touching a relevant account.
- The badge count is a cheap count query, not a full queue build.
- Target: under 800ms cold at 25,000 accounts and 100,000 events; under 200ms warm.
- Paginated. A hundred outstanding items is a real state on a bad week and must not break the page.

### 3.9 Scoping and empty state

Items are scoped by role. An estimator sees their own customers or everyone, per ⚑7.3. Contractors never see this queue at all — they have their own job flow.

The empty state matters more than it sounds, because it's the reward. When nothing is outstanding, say so plainly and show what's coming rather than a blank screen.

---

## 4. The shell

### 4.1 Structure

App-level layout with four tabs, persistent across navigation. Today carries a live badge; the others don't. Tab state survives a refresh.

Every work item, search result and board card opens the **same customer record**. One record, many routes in. No module gets its own variant of a customer page.

### 4.2 Today

Three buckets — overdue, due today, waiting on them — with filter chips for kind (§3.3 grouped into All / Messages / Follow-ups / Approvals / Money). Filters are chips over the same evaluator, never separate queries.

### 4.3 Customers

- **List / Board toggle.** Same customers, same filters, two shapes. Filter state carries across the toggle.
- **Sort:** quote date newest, quote date oldest, last activity, value, longest untouched. ⚑7.4 for the default.
- Groups, search, filters and saved views exactly as the directory brief specifies, minus "Waiting on you".
- Sorting is browsing. **Chasing is the queue's job** — this must be said in the UI copy, or people will treat the sorted list as their follow-up system and miss things.

### 4.4 Campaigns

Two sections per §2.4. Every automation shows results, because an automation with no visible outcome is one nobody will ever tune or switch off.

### 4.5 Diary

Tomorrow's route with stops in order, jobs currently running, and the night-before sequencing action. Detail per the visit booking brief.

---

## 5. Sessions — Phase 2A

| # | Session | Depends on | Output |
|---|---|---|---|
| **2A.0** | Rulings + mockup confirmation | 7.1, 7.2 | file list confirmed back |
| **2A.1** | Shell | CRM 2.1 | four-tab layout, routing, badge, persisted tab state, one shared customer record route |
| **2A.2** | Work queue core | 2A.1 | `lib/crm/work-queue.ts`, item shape, key generation, registry, priority function, `lib/invoicing/attention.ts` folded in |
| **2A.3** | First three sources | 2A.2 | `invoice_action` (migrated from the existing queue), `snooze_expired`, `callback_requested` — proves the registry with real data |
| **2A.4** | Follow-up rules | 2A.3, 7.1 | rule engine, thresholds in Settings, `followup_due` source |
| **2A.5** | Dismissal + snooze | 2A.4 | dismissal table, required reasons, re-fire on new discriminator, events on the timeline |
| **2A.6** | Today UI | 2A.5 | buckets, filter chips, item cards, single action each, empty state, pagination |
| **2A.7** | Customers shell | 2A.1, CRM 2.5 | list/board toggle with shared filter state, sort control, groups |
| **2A.8** | Campaigns restructure | campaign 3.1 | always-on vs broadcasts split, results per automation, approvals removed from this tab |
| **2A.9** | Remaining sources | as each module lands | message, approval, visit, variation, sign-off, consent sources — each a function plus a registry entry |
| **2A.10** | Performance + gate | all | caching, invalidation, volume test, e2e per role |

2A.9 is deliberately open-ended: each later module adds its source in its own session rather than all at once here.

---

## 6. Acceptance criteria

**Single source**
- [ ] Exactly one implementation of "what needs attention" exists. `lib/invoicing/attention.ts` is gone or re-exports from `lib/crm/work-queue.ts`. Grep-verified in CI.
- [ ] No module renders its own outstanding-work list, badge or inbox. Reviewer-verified against the module list.
- [ ] Today, the badge, and any filtered view all call the same evaluator.

**Derivation**
- [ ] No `work_items` table exists. Items are computed. A test that inserts one fails at review.
- [ ] Replying to a message removes its item without any explicit completion action.
- [ ] The same fact produces the same key across recomputes. Property test over a fixture set.
- [ ] Dismissing at one threshold does not suppress a later, more urgent instance of the same rule.
- [ ] Every dismissal has a reason and writes a timeline event.

**Behaviour**
- [ ] Every item has exactly one action, and it opens the shared customer record or conversation — never a module-specific page.
- [ ] A promise recorded to a customer outranks a higher-value item without one. Explicit test.
- [ ] Customer-visible items outrank internal ones at equal urgency.
- [ ] Contractors receive no work items. Negative test per role.
- [ ] Empty state renders meaningfully, not blank.

**Shell**
- [ ] Four tabs. No fifth top-level destination exists.
- [ ] The board is reachable only as a view mode within Customers.
- [ ] Filter state persists across the list/board toggle.
- [ ] Sorting by quote date works in both directions and is clearly distinguished in copy from the follow-up queue.
- [ ] Campaign approvals appear in Today and not in Campaigns.
- [ ] Every automation displays outcome figures, not just enrolment counts.

**Performance**
- [ ] Queue under 800ms cold, 200ms warm, at 25,000 accounts and 100,000 events.
- [ ] Badge count is a count query, not a queue build.
- [ ] No source function is unbounded.
- [ ] 100+ outstanding items paginates without degrading.

---

## 7. ⚑ Decisions for Tom

| # | Decision | Notes |
|---|---|---|
| **7.1** | **Follow-up rule thresholds** (§3.5) — the days for each rule | **blocks session 2A.4.** Start conservative; too many items is worse than too few, because a queue people can't clear gets ignored entirely |
| 7.2 | Priority weighting — how much value counts against age, and kind weights | |
| 7.3 | Scoping — does an estimator see their own customers only, or everyone? | affects RLS |
| 7.4 | Default sort on Customers | quote date newest is the suggestion |
| 7.5 | Which kinds may be dismissed permanently, and which only snoozed | |
| 7.6 | Snooze presets — tomorrow, 3 days, next week, next month, pick a date | |
| 7.7 | Does Today have a daily digest by email or push, or is it pull-only? | pull-only to start; a notification you learn to ignore is worse than none |
| 7.8 | Overdue threshold per kind — a message overdue at 4 hours, an invoice at 7 days | |
| 7.9 | Is there a shared "unassigned" pool as the team grows, or does everything have an owner? | matters more once an estimator is hired |
| 7.10 | Does the estimator's mobile view differ from the desktop Today, or is it the same list? | |
| 7.11 | Are broadcast results visible to all staff, or Tom only? | |

---

## 8. Risks

1. **The queue will be too noisy at first.** Every threshold is a guess until real data lands. If a person can't clear Today by lunchtime, they stop trusting it and go back to their own memory — at which point the whole design has failed. Start with conservative thresholds and loosen. Track dismissal reasons: a kind that's dismissed repeatedly has the wrong rule behind it.
2. **Folding in the existing attention queue is a real migration**, not a rename. Invoicing already depends on it. Do it in 2A.2/2A.3 with its tests carried over, and verify no invoice behaviour changes.
3. **Derived items are harder to build than a task table** and worth it anyway. The moment items are stored, they drift from reality — a ticked-off task whose underlying problem is still live is worse than no task at all. Hold the line on this.
4. **Sorting will get mistaken for a follow-up system.** People will sort by quote date, work down the list, and believe they're covered. The copy has to be explicit, and Today has to be genuinely better than the sorted list, or the habit won't shift.
5. **The single-surface rule needs enforcing on every future module**, including ones not yet designed. Put it in `CLAUDE.md` as a standing rule so it survives this brief being forgotten.
