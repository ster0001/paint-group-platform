/**
 * The induction sign-off as the screens read it (brief §5, Step 5): the
 * modules of a kind, the one gate rule, and the words. Pure. `inductionGateOf`
 * mirrors `induction_gate_of` in migration 20270270 word for word, so the
 * gate in SQL and the line on every screen cannot disagree; status.test.ts
 * pins the cases. Shared by server and client code.
 */

export type InductionKind = "full" | "refresher" | "worker";

/** The refresher (ruling I13): the what-is-changing block, then 3, 7, 8, 9 and 6, plus the standards (Module 5). */
export const REFRESHER_MODULES: readonly string[] = ["m00", "m03", "m05", "m06", "m07", "m08", "m09"];

/** The facilitator's practical check (⚑5, ⚑17): five tasks for a contractor, three for a worker, none for the refresher. */
export const CHECK_TASKS: Record<InductionKind, readonly { key: string; label: string }[]> = {
  full: [
    { key: "accept_job", label: "Accept a job" },
    { key: "before_photo", label: "Add a before photo" },
    { key: "prepped", label: "Move a surface to prepped" },
    { key: "variation", label: "Raise a variation" },
    { key: "invoice", label: "Submit an invoice" },
  ],
  worker: [
    { key: "open_job", label: "Open the job" },
    { key: "before_photo", label: "Add a before photo" },
    { key: "prepped", label: "Move a surface to prepped" },
  ],
  refresher: [],
};

export type GateInput = {
  kind: InductionKind;
  /** settings.induction_rules.offerGate — false turns the gate off entirely. */
  offerGate: boolean;
  /** A published full version exists. */
  versionPublished: boolean;
  completedAt: string | null;
  checkPassed: boolean;
  graceUntil: string | null;
  reTickMonths: number;
  expiryBlocks: boolean;
};

export type Gate = "ok" | "induction_incomplete" | "check_not_passed";

export function inductionGateOf(i: GateInput, now: Date): Gate {
  if (i.kind === "worker") return "ok";            // a worker is never offered work; the share gate is inducted_at
  if (!i.offerGate) return "ok";
  if (!i.versionPublished) return "ok";
  let done = i.completedAt;
  if (done && i.expiryBlocks) {
    const limit = new Date(now); limit.setMonth(limit.getMonth() - i.reTickMonths);
    if (new Date(done).getTime() < limit.getTime()) done = null;
  }
  if (i.kind === "refresher") {
    if (!i.graceUntil) return "ok";
    if (now.getTime() < new Date(i.graceUntil).getTime()) return "ok";
    return done ? "ok" : "induction_incomplete";
  }
  if (!done) return "induction_incomplete";
  if (!i.checkPassed) return "check_not_passed";
  return "ok";
}

export const DEFAULT_INDUCTION_RULES = { offerGate: true, reTickMonths: 12, expiryBlocks: false } as const;

export type InductionRules = { offerGate: boolean; reTickMonths: number; expiryBlocks: boolean };

export function mergeInductionRules(raw: unknown): InductionRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    offerGate: typeof r.offerGate === "boolean" ? r.offerGate : DEFAULT_INDUCTION_RULES.offerGate,
    reTickMonths: Number.isInteger(r.reTickMonths) && (r.reTickMonths as number) >= 1 ? (r.reTickMonths as number) : DEFAULT_INDUCTION_RULES.reTickMonths,
    expiryBlocks: typeof r.expiryBlocks === "boolean" ? r.expiryBlocks : DEFAULT_INDUCTION_RULES.expiryBlocks,
  };
}

// ---- the status a screen reads (induction_status / induction_statuses) -----------------

export type InductionModuleState = { key: string; ticked: boolean; sections: string[]; changeNote: string };
export type InductionTaskState = { task: string; result: "pass" | "not_yet" | null; note: string; checkedAt: string | null };

export type InductionStatus = {
  kind: InductionKind;
  versionNo: number | null;
  language: string | null;
  modules: InductionModuleState[];
  ticked: number;
  total: number;
  complete: boolean;
  completedAt: string | null;
  tasks: InductionTaskState[];
  checkPassed: boolean;
  /** null for a worker login (no offers). */
  gate: Gate | null;
  invitedAt: string | null;
  graceUntil: string | null;
  inductedAt: string | null;
};

const kindOf = (v: unknown): InductionKind => (v === "refresher" || v === "worker" ? v : "full");
const gateOf = (v: unknown): Gate | null => (v === "ok" || v === "induction_incomplete" || v === "check_not_passed" ? v : null);

/** The jsonb the RPC returns, shaped. Null in, null out. */
export function parseInductionStatus(raw: unknown): InductionStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const modules = Array.isArray(r.modules) ? (r.modules as Record<string, unknown>[]).map((m) => ({
    key: String(m.key ?? ""), ticked: m.ticked === true,
    sections: Array.isArray(m.sections) ? (m.sections as unknown[]).map(String) : [],
    changeNote: typeof m.change_note === "string" ? m.change_note : "",
  })) : [];
  const tasks: InductionTaskState[] = Array.isArray(r.tasks) ? (r.tasks as Record<string, unknown>[]).map((t) => ({
    task: String(t.task ?? ""), result: t.result === "pass" ? "pass" as const : t.result === "not_yet" ? "not_yet" as const : null,
    note: typeof t.note === "string" ? t.note : "", checkedAt: typeof t.checked_at === "string" ? t.checked_at : null,
  })) : [];
  return {
    kind: kindOf(r.kind), versionNo: typeof r.version_no === "number" ? r.version_no : null,
    language: typeof r.language === "string" ? r.language : null,
    modules, ticked: Number(r.ticked ?? 0), total: Number(r.total ?? modules.length),
    complete: r.complete === true, completedAt: typeof r.completed_at === "string" ? r.completed_at : null,
    tasks, checkPassed: r.check_passed === true, gate: gateOf(r.gate),
    invitedAt: typeof r.invited_at === "string" ? r.invited_at : null,
    graceUntil: typeof r.grace_until === "string" ? r.grace_until : null,
    inductedAt: typeof r.inducted_at === "string" ? r.inducted_at : null,
  };
}

/** The first module not yet ticked, in order — null once all are. */
export function nextModule(s: InductionStatus): string | null {
  return s.modules.find((m) => !m.ticked)?.key ?? null;
}

// ---- words ---------------------------------------------------------------------------------

const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Melbourne" });

/** One line for the painter's own screens. */
export function painterInductionLine(s: InductionStatus): string {
  if (s.complete) {
    const check = s.kind === "refresher" ? "" : s.checkPassed ? " · practical check passed" : " · practical check with your facilitator next";
    return `Completed ${s.completedAt ? dmy(s.completedAt) : ""}${check}`.trim();
  }
  const left = s.total - s.ticked;
  if (s.kind === "refresher" && s.graceUntil && !s.complete) return `${left} module${left === 1 ? "" : "s"} to tick by ${dmy(s.graceUntil)} to keep getting job offers.`;
  return `${s.ticked} of ${s.total} modules ticked.`;
}

/** One line for the office's screens. */
export function staffInductionLine(s: Pick<InductionStatus, "kind" | "ticked" | "total" | "complete" | "completedAt" | "checkPassed" | "gate" | "invitedAt" | "graceUntil">, now: Date): string {
  const kind = s.kind === "refresher" ? "Refresher" : s.kind === "worker" ? "Worker induction" : "Induction";
  if (s.complete) {
    const check = s.kind === "refresher" ? "" : s.checkPassed ? " · check passed" : " · check not passed";
    return `${kind} complete${s.completedAt ? ` · ${dmy(s.completedAt)}` : ""}${check}${s.gate && s.gate !== "ok" ? " · no offers" : ""}`;
  }
  const ago = s.invitedAt ? Math.floor((now.getTime() - new Date(s.invitedAt).getTime()) / 86_400_000) : null;
  if (s.kind === "refresher") {
    if (!s.invitedAt) return `${kind} not started · not invited yet`;
    if (s.graceUntil && now.getTime() < new Date(s.graceUntil).getTime()) return `${kind} ${s.ticked} of ${s.total} · invited ${ago}d ago, offers stop ${dmy(s.graceUntil)}`;
    return `${kind} ${s.ticked} of ${s.total} · invited ${ago}d ago, grace ended · no job offers`;
  }
  return `${kind} ${s.ticked} of ${s.total}${s.gate === "induction_incomplete" ? " · no job offers until complete" : ""}`;
}

/** What a gate word means on the office's screens. */
export function gateWord(g: Gate | null): string {
  return g === "induction_incomplete" ? "Induction not complete" : g === "check_not_passed" ? "Practical check not passed" : g === "ok" ? "Induction OK" : "";
}
