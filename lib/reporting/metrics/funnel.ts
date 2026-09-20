/**
 * Session 3 — Where estimates go. Wizard started → email captured → saved →
 * sent → viewed → accepted, from wizard_drafts and the estimates they became,
 * as a cohort of sessions STARTED in the range. The steps are what is
 * captured today: started_at, an email on the draft (no timestamp of its own
 * yet — B2's per-step stamps come with the wizard-progress brief), an
 * estimate id, and the estimate's sent / viewed / accepted moments. Self-serve
 * acceptance (`outcome_tier`, B2 "with wizard R5") is not captured yet and is
 * said so, not guessed.
 */
import { inRange, melbourneDay, type MetricDef, type MetricInput, type Range } from "../core";

export type FunnelRow = {
  started_on: string; email_captured: boolean; saved: boolean; sent: boolean; viewed: boolean; accepted: boolean;
  furthest: string; lead_source: string; days_sent_to_accepted: number;
};

const STEPS = ["started", "email", "saved", "sent", "viewed", "accepted"] as const;
export type FunnelStepKey = (typeof STEPS)[number];
export const STEP_LABEL: Record<FunnelStepKey, string> = { started: "Wizard started", email: "Email captured", saved: "Estimate saved", sent: "Sent", viewed: "Viewed", accepted: "Accepted" };

export function funnelRows(input: MetricInput, range: Range): FunnelRow[] {
  const f = input.funnel; if (!f) return [];
  const est = new Map(f.estimates.map((e) => [e.id, e]));
  return f.drafts
    .filter((d) => inRange(d.started_at, range))
    .map((d) => {
      const e = d.estimate_id ? est.get(d.estimate_id) : undefined;
      const email = Boolean(d.email);
      const saved = Boolean(d.estimate_id);
      const sent = Boolean(e?.sent_at);
      const viewed = Boolean(e?.viewed_at);
      const accepted = e?.status === "accepted";
      const furthest = accepted ? "accepted" : viewed ? "viewed" : sent ? "sent" : saved ? "saved" : email ? "email" : "started";
      return {
        started_on: melbourneDay(d.started_at), email_captured: email, saved, sent, viewed, accepted, furthest,
        lead_source: e?.lead_source ?? d.lead_source ?? "unknown",
        days_sent_to_accepted: accepted && e?.sent_at && e.accepted_at ? Math.round((Date.parse(e.accepted_at) - Date.parse(e.sent_at)) / 86_400_000 * 10) / 10 : 0,
      };
    });
}

export type FunnelStep = { key: FunnelStepKey; label: string; count: number; pct_of_start: number; dropped: number; drop_note: string };
export type FunnelData = { steps: FunnelStep[]; started: number; median_days_sent_to_accepted: number | null; self_serve_note: string };

export function buildFunnel(input: MetricInput, range: Range): FunnelData {
  const rows = funnelRows(input, range);
  const count = (k: FunnelStepKey) => rows.filter((r) => k === "started" || (k === "email" ? r.email_captured : k === "saved" ? r.saved : k === "sent" ? r.sent : k === "viewed" ? r.viewed : r.accepted)).length;
  const counts = Object.fromEntries(STEPS.map((k) => [k, count(k)])) as Record<FunnelStepKey, number>;
  const started = counts.started;
  const drops: Record<FunnelStepKey, string> = {
    started: "",
    email: "before leaving an email — nothing to chase",
    saved: "with an email — warm leads in the CRM",
    sent: "saved but never sent",
    viewed: "never opened — chase ladder running",
    accepted: "viewed, not accepted (yet)",
  };
  const steps: FunnelStep[] = STEPS.map((k, i) => {
    const prev = i === 0 ? counts[k] : counts[STEPS[i - 1]];
    const dropped = i === 0 ? 0 : Math.max(0, prev - counts[k]);
    return { key: k, label: STEP_LABEL[k], count: counts[k], pct_of_start: started ? Math.round((counts[k] / started) * 100) : 0, dropped, drop_note: dropped && drops[k] ? `${dropped} ${k === "viewed" ? "never opened" : "dropped"} ${drops[k].replace(/^never opened /, "")}` : "" };
  });
  const days = rows.filter((r) => r.accepted && r.days_sent_to_accepted > 0).map((r) => r.days_sent_to_accepted).sort((a, b) => a - b);
  const median = days.length ? (days.length % 2 ? days[Math.floor(days.length / 2)] : Math.round(((days[days.length / 2 - 1] + days[days.length / 2]) / 2) * 10) / 10) : null;
  return { steps, started, median_days_sent_to_accepted: median, self_serve_note: "Self-serve acceptances (no visit) switch on when the wizard stores the outcome tier on the estimate." };
}

/** The exportable list behind the funnel: one row per wizard session started in the range, with its furthest step. */
export const wizardSessions: MetricDef<FunnelRow> = {
  key: "funnel.wizard_sessions",
  kind: "period",
  section: "funnel",
  title: "Wizard sessions",
  definition: "Wizard sessions started on a day in the range (wizard_drafts.started_at), each with how far it got: email captured, estimate saved, sent, viewed, accepted. The funnel card is these rows counted per step.",
  unit: "count",
  gst: null,
  roles: ["owner", "admin", "sales"],
  aggregate: "count",
  columns: [
    { key: "started_on", label: "Started" }, { key: "furthest", label: "Got to" }, { key: "email_captured", label: "Email" }, { key: "saved", label: "Saved" },
    { key: "sent", label: "Sent" }, { key: "viewed", label: "Viewed" }, { key: "accepted", label: "Accepted" }, { key: "lead_source", label: "Lead source" }, { key: "days_sent_to_accepted", label: "Days sent → accepted" },
  ],
  href: "/estimates",
  select: funnelRows,
  note: (rows) => rows.length ? `${rows.filter((r) => r.accepted).length} accepted · ${rows.filter((r) => r.furthest === "email" || r.furthest === "saved").length} warm, not sent` : "no wizard sessions in this range",
};
