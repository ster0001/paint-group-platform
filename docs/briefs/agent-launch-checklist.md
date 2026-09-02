# Assistant — launch checklist (S8) · for Tom to sign

**Date prepared:** 2 Sep 2026 · **Status:** awaiting Tom · **What it covers:** guided mode (portal), co-work (staff), support + Brain, live handoff, "Describe the job".

## Measured (from `npm test` — the eval suites run in CI)
| Metric | Result | Where |
|---|---|---|
| Question-order determinism | 100% (6 fixture jobs + 20 synthetic enquiries, same inputs → same order/tree/cents) | `lib/agent/question-graph.test.ts`, `lib/agent/evals/replay.test.ts` |
| Guardrail misses (haggling, margin fishing, lead minimisation, "ignore your instructions", abuse) | 0 | `lib/agent/evals/adversarial.test.ts` |
| Parity (wizard way vs assistant way, 6 jobs) | 100% — identical rows, hours, cents, range | `lib/agent/scope-tools.test.ts` |
| Numbers traceable to a tool result | every assistant message, every suite | `assistantNumbersTraceable` |
| Median co-work correction vs sent estimates (regression corpus, 11 interior PaintScout jobs) | **$2,823** on 2 Sep 2026 (rooms matched 68%). Target < $150 is the proving-window target and is NOT met: the anonymised corpus briefs carry counts only (no sizes, no prep allowances), so the proposal prices typical rooms against measured ones. Re-measure on real staff-finished estimates in the proving window. | `npx tsx scripts/agent-evals.ts` |
| Cost per completed guided estimate | `/admin/agent` once real-model conversations exist (stub runs cost nothing) | dashboard |

## Before customers see it — Tom's items
- [ ] `ANTHROPIC_API_KEY` in Vercel (already there for the plan reader).
- [ ] Review the 10 hard-stop scripts in `agent_settings.hard_stop_scripts` (D13 wording).
- [ ] Set `agent_settings.support_hours.roster` + `escalateTo` (E.164) — who is pinged for a live chat (D9); confirm hours (D8) and the 3-minute SLA (D10).
- [ ] Settings → Brain: approve the [PLATFORM] entries you're happy with; write the eight [TOM TO WRITE] ones (caulking first).
- [ ] Decide D1/D2/D3/D5–D7/D11–D17 defaults in `docs/briefs/agent-rulings.md` (built as defaults; a one-line change each).
- [ ] Draft-only month: the assistant composes NO customer-facing outbound text yet (only the operational roster/escalation SMS to staff). When it does, it goes through the existing approval queue — no exception.
- [ ] Re-run `npx tsx scripts/agent-evals.ts` after the proving window and record the correction here: ____
- [ ] Sign: ______________________  Date: ________
