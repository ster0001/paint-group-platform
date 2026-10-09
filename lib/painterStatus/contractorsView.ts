import type { Colour, Measures } from "./evaluate";
import { trendOf } from "./evaluate";

/**
 * The Contractors view (brief Step 8): ONE model behind PC Command →
 * Contractors and the home dashboard's Contractor section. The strip counts
 * and the rows are derived here from the same inputs, so the two can never
 * disagree. Pure — `lib/painterStatus/contractorsLoad.ts` fetches the inputs.
 */

export type ViewPainter = { id: string; name: string; employmentType: "contractor" | "employee"; active: boolean };
export type ViewStatus = { painterId: string; colour: Colour; line: string; streak: number; bestStreak: number; bonusCounter: number; measures: Partial<Measures>; offersClearedAt: string | null; computedAt: string };
export type ViewChange = { painterId: string; at: string; to: Colour };
export type ViewBonus = { id: string; painterId: string; status: string; amountCents: number | null; decidedAt: string | null; triggeredAt: string };
export type ViewCallback = { id: string; painterId: string; workOrderId: string; status: string; woRef: string | null };
export type ViewStandards = { painterId: string; status: string };
export type ViewResult = { painterId: string; workOrderId: string; result: "clean" | "not_clean"; reasons: string[]; hours: number; signedOn: string | null; title: string };
export type ViewJob = { painterId: string; workOrderId: string; woRef: string; title: string; stage: string };

export type ContractorsInputs = {
  painters: ViewPainter[]; statuses: ViewStatus[]; changes: ViewChange[]; bonuses: ViewBonus[];
  callbacks: ViewCallback[]; standards: ViewStandards[]; results: ViewResult[]; jobs: ViewJob[];
};

export type Tag = { text: string; tone: "" | "info" | "bad" | "wait" };
export type ContractorRow = {
  id: string; name: string; employmentType: "contractor" | "employee";
  colour: Colour | null; line: string; streak: number; bestStreak: number; bonusCounter: number;
  checks: string; app: string; callbacks: number; trend: "better" | "worse" | "same";
  offersBlocked: boolean; tags: Tag[];
  lastTen: { workOrderId: string; title: string; result: "clean" | "not_clean"; reasons: string[]; hours: number }[];
  /** Approved / paid bonuses — amounts, for the staff-only sheet (⚑13). */
  bonusHistory: { id: string; amountCents: number; decidedAt: string | null; status: string }[];
  /** Jobs a spot check can go on, and finished jobs a call back can be logged against. */
  underWay: { workOrderId: string; woRef: string; title: string }[];
  finished: { workOrderId: string; woRef: string; title: string }[];
};
export type StripCounts = { green: number; yellow: number; orange: number; red: number; new: number; openCallbacks: number; bonusDue: number; notSigned: number };
export type ContractorsView = { rows: ContractorRow[]; counts: StripCounts };

const ORDER: Record<Colour, number> = { red: 0, orange: 1, yellow: 2, new: 3, green: 4 };
const UNDER_WAY = new Set(["pre_start", "in_progress", "qa", "walkthrough", "completion_prep"]);
const OPEN_CB = new Set(["open", "booked", "fixed"]);

export function buildContractorsView(inp: ContractorsInputs, now: Date): ContractorsView {
  const statusOf = new Map(inp.statuses.map((s) => [s.painterId, s]));
  const standardsOf = new Map(inp.standards.map((s) => [s.painterId, s.status]));
  const rows: ContractorRow[] = inp.painters.filter((p) => p.active).map((p) => {
    const s = statusOf.get(p.id) ?? null;
    const m = s?.measures ?? {};
    const openCbs = inp.callbacks.filter((c) => c.painterId === p.id && OPEN_CB.has(c.status));
    const bonuses = inp.bonuses.filter((b) => b.painterId === p.id);
    const std = standardsOf.get(p.id) ?? "not_required";
    const results = inp.results.filter((r) => r.painterId === p.id).sort((a, b) => (a.signedOn ?? "").localeCompare(b.signedOn ?? "")).slice(-10);
    const tags: Tag[] = [];
    if (p.employmentType === "employee") tags.push({ text: s ? "Lead painter, employed" : "Employed", tone: "" });
    if (openCbs.length) tags.push({ text: openCbs.length === 1 ? "Open call back" : `${openCbs.length} open call backs`, tone: "bad" });
    if (bonuses.some((b) => b.status === "due" || b.status === "with_owner")) tags.push({ text: "Bonus due", tone: "info" });
    if (s?.colour === "orange" || s?.colour === "red") tags.push({ text: "Check every job", tone: "wait" });
    if (std === "blocked" || std === "grace" || std === "not_invited" || std === "employee_unsigned") tags.push({ text: "Standards not signed", tone: "wait" });
    if (s?.colour === "new" && s.streak > 0) tags.push({ text: `Job ${s.streak} of 4`, tone: "" });
    const none = results.length === 0;
    return {
      id: p.id, name: p.name, employmentType: p.employmentType,
      colour: s?.colour ?? null, line: s?.line ?? (p.employmentType === "employee" ? "Scored on the jobs they lead." : "Not evaluated yet."),
      streak: s?.streak ?? 0, bestStreak: s?.bestStreak ?? 0, bonusCounter: s?.bonusCounter ?? 0,
      checks: none || !m.checks || m.checks.done === 0 ? "–" : `${m.checks.passedFirstTime}/${m.checks.done}`,
      app: none || !m.reminders || m.reminders.scored === 0 ? (none ? "No jobs yet" : "–") : `${m.reminders.answered}/${m.reminders.scored}`,
      callbacks: m.callbacks?.scored ?? 0,
      trend: trendOf(inp.changes.filter((c) => c.painterId === p.id).map((c) => ({ at: c.at, to: c.to })), now),
      offersBlocked: s?.colour === "red" && !s.offersClearedAt,
      tags,
      lastTen: results.map((r) => ({ workOrderId: r.workOrderId, title: r.title, result: r.result, reasons: r.reasons, hours: r.hours })),
      bonusHistory: bonuses.filter((b) => b.status === "approved" || b.status === "paid").map((b) => ({ id: b.id, amountCents: b.amountCents ?? 0, decidedAt: b.decidedAt, status: b.status })),
      underWay: inp.jobs.filter((j) => j.painterId === p.id && UNDER_WAY.has(j.stage)).map((j) => ({ workOrderId: j.workOrderId, woRef: j.woRef, title: j.title })),
      finished: inp.jobs.filter((j) => j.painterId === p.id && j.stage === "closed").map((j) => ({ workOrderId: j.workOrderId, woRef: j.woRef, title: j.title })),
    };
  }).sort((a, b) => (a.colour ? ORDER[a.colour] : 3) - (b.colour ? ORDER[b.colour] : 3) || a.name.localeCompare(b.name));

  // The strip: the same rows, counted — never a second query.
  const counts: StripCounts = { green: 0, yellow: 0, orange: 0, red: 0, new: 0, openCallbacks: 0, bonusDue: 0, notSigned: 0 };
  for (const r of rows) {
    if (r.colour) counts[r.colour] += 1;
    if (r.tags.some((t) => t.text === "Standards not signed")) counts.notSigned += 1;
  }
  counts.openCallbacks = inp.callbacks.filter((c) => OPEN_CB.has(c.status) && rows.some((r) => r.id === c.painterId)).length;
  counts.bonusDue = inp.bonuses.filter((b) => (b.status === "due" || b.status === "with_owner") && rows.some((r) => r.id === b.painterId)).length;
  return { rows, counts };
}
