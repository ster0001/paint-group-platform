/**
 * The sign-off (brief Step 2, rulings S4–S8, ⚑1, ⚑2, ⚑17, ⚑18): who has
 * confirmed the standards, who still must, and what that means for job offers.
 *
 * Pure. The one rule — `standardsStatusOf` — mirrors `standards_status_of` in
 * migration 20270225 word for word, so the gate in SQL and the words on every
 * screen cannot disagree; acks.test.ts pins the cases. Shared by server and
 * client code.
 */
import { melbourneInstant } from "@/lib/time/businessHours";
import { SIGN_OFF_SECTIONS, type SectionKey } from "./model";

export type StandardsStatus =
  | "not_required"      // nothing published yet: nothing to sign
  | "confirmed"         // all six sections on a version at or above the required one
  | "employee_unsigned" // an employed painter who has not confirmed — reminders and a PC card, never a block (⚑2)
  | "not_invited"       // a contractor the office has not invited yet (launch is Tom's call)
  | "grace"             // invited, inside the grace period: offers still allowed
  | "blocked";          // grace over, not confirmed: no new offers (ruling S6)

export type StandardsStatusInput = {
  employmentType: "contractor" | "employee";
  /** The newest published material version — null when none is published. */
  requiredNo: number | null;
  /** The newest version this painter has all six sections on — null when none. */
  confirmedNo: number | null;
  graceUntil: string | null;
};

export function standardsStatusOf(i: StandardsStatusInput, now: Date): StandardsStatus {
  if (i.requiredNo == null) return "not_required";
  if (i.confirmedNo != null && i.confirmedNo >= i.requiredNo) return "confirmed";
  if (i.employmentType === "employee") return "employee_unsigned";
  if (!i.graceUntil) return "not_invited";
  if (now.getTime() < new Date(i.graceUntil).getTime()) return "grace";
  return "blocked";
}

/** Does this status stop a NEW offer? Only "blocked" ever does (ruling S6; employees are never offered). */
export const blocksOffers = (s: StandardsStatus): boolean => s === "blocked";

/** Must this painter still sign? (Everything that is not confirmed or not required.) */
export const needsSignoff = (s: StandardsStatus): boolean => s !== "confirmed" && s !== "not_required";

export type SignSectionKey = (typeof SIGN_OFF_SECTIONS)[number];

/**
 * The six sign-off sections (ruling S4), in the mockup's order and words.
 * `body` names the rule-page blocks each one shows; interior and exterior show
 * their surfaces at every level.
 */
export const SIGN_SECTIONS: { key: SignSectionKey; title: string; body: SectionKey[] }[] = [
  { key: "levels", title: "The three levels and the look test", body: ["levels"] },
  { key: "rules", title: "Rules for every job", body: ["rules"] },
  { key: "time", title: "Your time, extra time and variations", body: ["time"] },
  { key: "interior", title: "Interior surfaces", body: ["interior"] },
  { key: "exterior", title: "Exterior surfaces", body: ["exterior"] },
  { key: "defect", title: "The defect rule and final checklist", body: ["defect", "checklist"] },
];

export function isSignSection(v: unknown): v is SignSectionKey {
  return typeof v === "string" && (SIGN_OFF_SECTIONS as readonly string[]).includes(v);
}

/** The first section not yet ticked, in order — null once all six are. */
export function nextSignSection(acked: ReadonlySet<string>): SignSectionKey | null {
  return SIGN_SECTIONS.find((s) => !acked.has(s.key))?.key ?? null;
}

/** 0..6 */
export function ackedCount(acked: ReadonlySet<string>): number {
  return SIGN_SECTIONS.filter((s) => acked.has(s.key)).length;
}

// ---- the numbers (settings.standards_rules) ---------------------------------

export type StandardsRules = {
  /** ⚑1: days after the office's invite before new offers stop. */
  graceDays: number;
  /** ⚑17: texts on these days after the invite (2, 4, 6)… */
  reminderDays: number[];
  /** …at this Melbourne hour (9). */
  reminderHour: number;
  /** ⚑17: the PC card appears on this day after the invite (7). */
  pcCardDay: number;
};

export const DEFAULT_STANDARDS_RULES: StandardsRules = { graceDays: 7, reminderDays: [2, 4, 6], reminderHour: 9, pcCardDay: 7 };

/** Tolerant read of the settings row: anything malformed falls back to the default for that field. */
export function mergeStandardsRules(raw: unknown): StandardsRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown, d: number, min = 0, max = 365) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : d;
  const days = Array.isArray(r.reminderDays)
    ? [...new Set(r.reminderDays.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 60))].sort((a, b) => a - b)
    : DEFAULT_STANDARDS_RULES.reminderDays;
  return {
    graceDays: int(r.graceDays, DEFAULT_STANDARDS_RULES.graceDays, 0),
    reminderDays: days.length ? days : DEFAULT_STANDARDS_RULES.reminderDays,
    reminderHour: int(r.reminderHour, DEFAULT_STANDARDS_RULES.reminderHour, 0, 23),
    pcCardDay: int(r.pcCardDay, DEFAULT_STANDARDS_RULES.pcCardDay, 1),
  };
}

const MELB_YMD = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * The reminder ladder for one invite (⚑17): rung `dayN` at reminderHour
 * Melbourne on day N after the invite day. Anchor = that hour on the invite
 * day itself, so the rungs are whole days after it and never shift with the
 * clock change (the Melbourne date, never toISOString's UTC one).
 */
export function standardsReminderLadder(invitedAt: Date, rules: StandardsRules): { anchor: Date; rungs: { id: string; afterHours: number }[] } {
  const [y, m, d] = MELB_YMD.format(invitedAt).split("-").map(Number);
  const anchor = melbourneInstant(y, m, d, rules.reminderHour);
  return { anchor, rungs: rules.reminderDays.map((n) => ({ id: `day${n}`, afterHours: n * 24 })) };
}

/** The PC card is due from reminderHour on day pcCardDay after the invite. */
export function standardsCardDueAt(invitedAt: Date, rules: StandardsRules): Date {
  const [y, m, d] = MELB_YMD.format(invitedAt).split("-").map(Number);
  return new Date(melbourneInstant(y, m, d, rules.reminderHour).getTime() + rules.pcCardDay * 86_400_000);
}

// ---- words -----------------------------------------------------------------

const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Melbourne" });

/** One line for the painter's own screens. */
export function painterStatusLine(s: StandardsStatus, x: { confirmedAt?: string | null; confirmedNo?: number | null; graceUntil?: string | null }): string {
  switch (s) {
    case "confirmed": return `You confirmed these on ${x.confirmedAt ? dmy(x.confirmedAt) : "record"}${x.confirmedNo ? ` · Version ${x.confirmedNo}` : ""}`;
    case "blocked": return "No job offers until you confirm the finish standards.";
    case "grace": return `Please confirm the finish standards${x.graceUntil ? ` by ${dmy(x.graceUntil)}` : ""} to keep getting job offers.`;
    case "employee_unsigned": return "Please read and confirm the finish standards.";
    case "not_invited": return "Please read and confirm the finish standards.";
    case "not_required": return "";
  }
}

/** One line for the office's screens. */
export function staffStatusLine(s: StandardsStatus, x: { confirmedAt?: string | null; confirmedNo?: number | null; graceUntil?: string | null; invitedAt?: string | null; now: Date }): string {
  const ago = x.invitedAt ? Math.floor((x.now.getTime() - new Date(x.invitedAt).getTime()) / 86_400_000) : null;
  switch (s) {
    case "confirmed": return `Confirmed${x.confirmedNo ? ` v${x.confirmedNo}` : ""}${x.confirmedAt ? ` · ${dmy(x.confirmedAt)}` : ""}`;
    case "blocked": return `Not signed — invited ${ago ?? "?"}d ago, grace ended · no job offers`;
    case "grace": return `Not signed — invited ${ago ?? "?"}d ago, offers stop ${x.graceUntil ? dmy(x.graceUntil) : "soon"}`;
    case "employee_unsigned": return x.invitedAt ? `Not signed — invited ${ago}d ago (employee, no block)` : "Not signed — not invited yet (employee)";
    case "not_invited": return "Not invited yet";
    case "not_required": return "No standards published";
  }
}
