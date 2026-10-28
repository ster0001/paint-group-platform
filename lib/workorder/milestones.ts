/**
 * Customer updates from the ticks (work order UX brief §4.3, 24 Oct 2026) — PURE.
 *
 * Two messages are written from the painter's ticks, both landing on the
 * Customer updates queue (`wo_updates`) for the coordinator:
 *
 *  · Trigger A, a SURFACE MILESTONE: after any tick, single or bulk, a surface
 *    group (all the walls, all the ceilings…) is 100% prepped or 100% painted
 *    across the job. Ticks landing within the bundle window collapse into one
 *    draft; a group announced once is never announced again; a dropped draft
 *    is never regenerated for the same milestone.
 *  · Trigger D, the END-OF-DAY summary: the existing daily update, rolled up by
 *    surface group — a sentence per group that moved today, then a "tomorrow"
 *    sentence from the groups still open.
 *
 * Wording lives in the messaging settings (editable on Settings → Automations,
 * registry key customer_updates_queue); this module only fills it in. Nothing
 * here decides which group a row is in — that is `wo_surfaces.group_code`
 * (20270300). Human, not corporate (R9): short sentences, contractions.
 */
import { renderTemplate } from "@/lib/messaging/config";
import { SURFACE_GROUPS, isSurfaceGroupCode, type SurfaceGroupCode } from "./surfaceGroups";
import type { SurfaceState } from "./surfaces";

export type GroupRowInput = {
  id: string;
  heading: string;
  state: SurfaceState;
  group: string | null;
  removed?: boolean;
  rectification?: boolean;
};

export type GroupStanding = {
  code: SurfaceGroupCode;
  wording: string;
  total: number;
  /** Rows at prepped or done. */
  atLeastPrepped: number;
  done: number;
  preppedAll: boolean;
  paintedAll: boolean;
  /** Anything moved off todo. */
  started: boolean;
  rooms: { id: string; heading: string; state: SurfaceState }[];
};

/** Where every group on the job stands, in the brief's order. Struck rows are out; ungrouped rows are not here. */
export function groupStandings(rows: readonly GroupRowInput[]): GroupStanding[] {
  const out: GroupStanding[] = [];
  for (const g of SURFACE_GROUPS) {
    const rooms = rows.filter((r) => !r.removed && r.group === g.code).map((r) => ({ id: r.id, heading: r.heading, state: r.state }));
    if (rooms.length === 0) continue;
    const atLeastPrepped = rooms.filter((r) => r.state !== "todo").length;
    const done = rooms.filter((r) => r.state === "done").length;
    out.push({
      code: g.code, wording: g.wording, total: rooms.length, atLeastPrepped, done,
      preppedAll: atLeastPrepped === rooms.length, paintedAll: done === rooms.length, started: atLeastPrepped > 0, rooms,
    });
  }
  return out;
}

export type Milestone = { group: SurfaceGroupCode; state: "prepped" | "done" };

/** Every line a group has crossed as things stand now. */
export function milestonesNow(standings: readonly GroupStanding[]): Milestone[] {
  const out: Milestone[] = [];
  for (const s of standings) {
    if (s.preppedAll) out.push({ group: s.code, state: "prepped" });
    if (s.paintedAll) out.push({ group: s.code, state: "done" });
  }
  return out;
}

export const milestoneKey = (m: Milestone) => `${m.group}:${m.state}`;

/** The lines crossed now that nobody has been told about (drafted, sent OR dropped). */
export function newMilestones(now: readonly Milestone[], announced: readonly Milestone[]): Milestone[] {
  const seen = new Set(announced.map(milestoneKey));
  return now.filter((m) => !seen.has(milestoneKey(m)));
}

/** Parse what a row or a dismissal event recorded; anything malformed is ignored. */
export function parseMilestones(raw: unknown): Milestone[] {
  if (!Array.isArray(raw)) return [];
  const out: Milestone[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const g = (x as { group?: unknown }).group;
    const s = (x as { state?: unknown }).state;
    if (isSurfaceGroupCode(g) && (s === "prepped" || s === "done")) out.push({ group: g, state: s });
  }
  return out;
}

export function unionMilestones(a: readonly Milestone[], b: readonly Milestone[]): Milestone[] {
  const seen = new Set<string>();
  const out: Milestone[] = [];
  for (const m of [...a, ...b]) {
    const k = milestoneKey(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

/** "walls", "walls and ceilings", "walls, ceilings and windows". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const wordingOf = (code: SurfaceGroupCode) => SURFACE_GROUPS.find((g) => g.code === code)?.wording ?? code;

/** "Hi Amanda, all the walls…" → "All the walls…" for a second sentence in one message. */
export function dropGreeting(text: string): string {
  const t = text.replace(/^\s*(hi|hello|hey)\b[^,]*,\s*/i, "");
  return t === text ? text : cap(t);
}

export type MilestoneTemplates = {
  customerMilestonePrepped: string;
  customerMilestoneTwoPrepped: string;
  customerMilestonePainted: string;
  customerMilestoneNext: string;
  customerMilestonePlaceHome: string;
  customerMilestonePlaceCommercial: string;
};

export type ComposeMilestoneInput = {
  firstName: string;
  milestones: readonly Milestone[];
  standings: readonly GroupStanding[];
  templates: MilestoneTemplates;
  commercial?: boolean;
};

/**
 * One message for every line crossed in this bundle. A group both prepped and
 * painted in the window is said once, as painted. Painted groups first, then
 * prepped ones; the "{next} are up next" sentence names the first group still
 * open, in the brief's order, when a painted milestone is announced.
 */
export function composeMilestone({ firstName, milestones, standings, templates, commercial = false }: ComposeMilestoneInput): string | null {
  const painted = [...new Set(milestones.filter((m) => m.state === "done").map((m) => m.group))];
  const prepped = [...new Set(milestones.filter((m) => m.state === "prepped").map((m) => m.group))].filter((g) => !painted.includes(g));
  if (painted.length === 0 && prepped.length === 0) return null;

  const first = firstName.trim() || "there";
  const sentences: string[] = [];

  if (painted.length > 0) {
    // The first open group this message is not already about.
    const open = standings.find((s) => !s.paintedAll && !painted.includes(s.code) && !prepped.includes(s.code));
    const nextSentence = open ? renderTemplate(templates.customerMilestoneNext, { next_group: cap(open.wording) }) : "";
    sentences.push(renderTemplate(templates.customerMilestonePainted, {
      first_name: first,
      group: listWords(painted.map(wordingOf)),
      place: commercial ? templates.customerMilestonePlaceCommercial : templates.customerMilestonePlaceHome,
      next_sentence: nextSentence,
    }));
  }
  if (prepped.length === 2) {
    sentences.push(renderTemplate(templates.customerMilestoneTwoPrepped, {
      first_name: first, group_a: wordingOf(prepped[0]), group_b: wordingOf(prepped[1]),
    }));
  } else if (prepped.length > 0) {
    sentences.push(renderTemplate(templates.customerMilestonePrepped, {
      first_name: first, group: listWords(prepped.map(wordingOf)),
    }));
  }
  return sentences.map((s, i) => (i === 0 ? s : dropGreeting(s))).join(" ").replace(/\s{2,}/g, " ").trim();
}

export type EndOfDayInput = {
  firstName: string;
  standings: readonly GroupStanding[];
  /** Surface row ids that moved today. */
  changedToday: ReadonlySet<string>;
  template: string;
  photoCount?: number;
};

/**
 * Trigger D. A sentence per group with a change today — "Ceilings are all done"
 * or "Walls: Bed 1 painted and Bed 2 and Bed 3 prepped ready to go" — then
 * "Tomorrow it's the rest of the walls then onto the doors, frames and skirting
 * boards." from the groups still open. Null when nothing grouped moved today;
 * the caller then falls back to the ungrouped daily composer.
 */
export function composeEndOfDay({ firstName, standings, changedToday, template, photoCount = 0 }: EndOfDayInput): string | null {
  const moved = standings.filter((s) => s.rooms.some((r) => changedToday.has(r.id)));
  if (moved.length === 0) return null;

  const progress = moved.map((s) => {
    if (s.paintedAll) return `${cap(s.wording)} are all done.`;
    const doneRooms = s.rooms.filter((r) => r.state === "done").map((r) => r.heading);
    const preppedRooms = s.rooms.filter((r) => r.state === "prepped").map((r) => r.heading);
    const bits: string[] = [];
    if (doneRooms.length) bits.push(`${listWords(doneRooms)} painted`);
    if (preppedRooms.length) bits.push(`${listWords(preppedRooms)} prepped ready to go`);
    return `${cap(s.wording)}: ${bits.join(" and ")}.`;
  }).join(" ");

  const open = standings.filter((s) => !s.paintedAll);
  const parts: string[] = [];
  const partly = open.find((s) => s.started);
  if (partly) parts.push(`the rest of the ${partly.wording}`);
  const fresh = open.find((s) => !s.started && s !== partly);
  if (fresh) parts.push(`onto the ${fresh.wording}`);
  const tomorrow = parts.length ? ` Tomorrow it’s ${parts.join(" then ")}.` : "";

  const photos = photoCount > 0 ? ` ${photoCount === 1 ? "1 new photo is" : `${photoCount} new photos are`} on your job page.` : "";

  return renderTemplate(template, { first_name: firstName.trim() || "there", progress, tomorrow, photos })
    .replace(/\s{2,}/g, " ").trim();
}

/** The queue card's trigger label. */
export const UPDATE_KIND_LABEL: Record<string, string> = {
  end_of_day: "End of day summary",
  surface_milestone: "Surface milestone",
  checkin_40: "40% check-in",
  defect_day: "Defect day",
  manual: "Sent from the job page",
};
