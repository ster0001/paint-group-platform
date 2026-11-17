/**
 * The funnel messages, in the order a customer meets them (ruling A‑C, 11 Nov
 * 2026; built 17 Nov): Campaigns › Automations shows these, Settings →
 * Automations keeps everything else. Client-safe. Each row is a registry key
 * with the master plan's code; a step that is a card on Today rather than a
 * message is listed with no key, so the plan reads whole.
 */
export type FunnelRow = { code: string; key: string | null; note?: string };
export type FunnelStage = { id: "lead" | "estimate" | "won" | "after"; title: string; rows: FunnelRow[] };

export const FUNNEL_STAGES: readonly FunnelStage[] = [
  { id: "lead", title: "Lead — they have their range", rows: [
    { code: "L1", key: "lead_range_reminder" },
    { code: "L2", key: "lead_range_nudge" },
    { code: "L3", key: "lead_range_human" },
    { code: "L4", key: "lead_range_last" },
    { code: "L5", key: "lead_tighten_resume" },
    { code: "L6", key: "lead_tighten_help" },
    { code: "L7", key: "lead_tightened_close" },
    { code: "L8", key: null, note: "A call card on Today when a lead tightens and books nothing — always on, sends nothing." },
    { code: "L9", key: "office_lead_help" },
    { code: "L10", key: "office_visit_request" },
    { code: "L10", key: "lead_visit_request_ack" },
    { code: "L11", key: "visit_reminder" },
    { code: "L11", key: "visit_reminder_2h" },
    { code: "L12", key: "visit_no_show" },
    { code: "L13", key: "office_call_request" },
  ] },
  { id: "estimate", title: "Estimate — the quote is out", rows: [
    { code: "E1", key: "office_estimate_overdue" },
    { code: "E2", key: "estimate_unopened" },
    { code: "E3", key: "estimate_unopened_again" },
    { code: "E4", key: "estimate_viewed_any_q" },
    { code: "E5", key: "estimate_viewed_worth" },
    { code: "E6", key: null, note: "The call at 7 days is the Follow up card on Today (Settings → CRM chase days), as is E3's call." },
    { code: "E7", key: "estimate_viewed_held" },
    { code: "E8", key: "office_estimate_chat" },
    { code: "E9", key: "estimate_expiry_warning" },
    { code: "E10", key: "estimate_expired_chat" },
    { code: "E11", key: "estimate_declined_reason" },
    { code: "E12", key: "estimate_declined_timing" },
  ] },
  { id: "won", title: "Won — before the job starts", rows: [
    { code: "W1", key: "customer_accepted_welcome" },
    { code: "W2", key: "deposit_due" },
    { code: "W3", key: "colours_tbc" },
    { code: "W4", key: "start_reminder" },
  ] },
  { id: "after", title: "After the job", rows: [
    { code: "R1", key: "review_request" },
    { code: "R2", key: null, note: "Referrals wait for referral tables (ruling A‑L)." },
    { code: "R3", key: "anniversary_12" },
    { code: "R4", key: "anniversary_24" },
    { code: "R5", key: "cold_nurture" },
  ] },
];

export const FUNNEL_KEYS: ReadonlySet<string> = new Set(FUNNEL_STAGES.flatMap((s) => s.rows.map((r) => r.key).filter((k): k is string => k != null)));
export const codeOf = (key: string): string | null => FUNNEL_STAGES.flatMap((s) => s.rows).find((r) => r.key === key)?.code ?? null;

export type FunnelStat = { sent: number; last: string | null };
export type FunnelStats = Record<string, FunnelStat>;
