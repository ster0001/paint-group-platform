/**
 * S8 — print the eval numbers for the launch checklist.
 *   npx tsx scripts/agent-evals.ts
 * Determinism, guardrails and parity are asserted by `npm test` (lib/agent/**
 * evals run in CI); this prints the proving-window figures — the corpus
 * correction (needs regression-set/ locally) and the synthetic-set summary.
 */
import { corpusReplay, SYNTHETIC_ENQUIRIES } from "../lib/agent/evals/replay";

const c = corpusReplay();
console.log("Assistant evals — 2 Sep 2026");
console.log(`synthetic enquiries: ${SYNTHETIC_ENQUIRIES.length} (determinism + parity asserted in npm test)`);
if (c) console.log(`corpus replay: ${c.jobs} sent estimates · median co-work correction $${Math.round(c.medianCorrectionCents / 100)} (target < $150 in the proving window) · rooms matched ${c.roomsMatchedPct}%`);
else console.log("corpus replay: regression-set/ absent here — run on Tom's machine");
console.log("guardrail misses: asserted 0 in lib/agent/evals/adversarial.test.ts");
console.log("cost per completed guided estimate: read from /admin/agent once real-model conversations exist (stub runs cost nothing)");
