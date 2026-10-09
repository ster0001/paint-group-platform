/**
 * The finish standards as the app reads them (brief §5, rulings S2–S4, S9).
 *
 * Pure types and helpers shared by the painter portal, PC Command and the
 * quality-check screen, so the painter and the PC are always shown THE SAME
 * record for a surface at a level (ruling S12). No fetching here; the server
 * loader (load.ts) and the file derivation (source.ts) both produce
 * `Standards`.
 */

export const LEVELS = [2, 3, 4] as const;
export type Level = (typeof LEVELS)[number];
export type Side = "interior" | "exterior";

/** The rule pages, in the order the Standards screen lists them. */
export const SECTION_KEYS = ["levels", "rules", "time", "interior", "exterior", "defect", "checklist", "words"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** The six sign-off sections (ruling S4) — the file's `sign_off_sections`, pinned. */
export const SIGN_OFF_SECTIONS = ["levels", "rules", "time", "interior", "exterior", "defect"] as const;

/** Titles for the rule pages a painter can open — the mockup's words. */
export const RULE_PAGES: { key: Exclude<SectionKey, "interior" | "exterior">; title: string }[] = [
  { key: "levels", title: "The three levels" },
  { key: "rules", title: "Rules for every job" },
  { key: "time", title: "Your time and variations" },
  { key: "defect", title: "The defect rule" },
  { key: "checklist", title: "Final checklist" },
  { key: "words", title: "Words we use" },
];

export type LevelsBlock = {
  intro: string;
  items: { level: number; name: string; look_test_distance: string; summary: { label: string; text: string }[] }[];
  look_test_steps: string[];
  look_test_high_areas: string;
  closing: string;
};
export type RulesBlock = { intro: string; items: { rule: string; meaning: string }[]; closing: string };
export type TimeBlock = {
  intro: string;
  standard_preparation: { interior: string[]; exterior: string[] };
  extra_time_intro: string;
  extra_time: { name: string; meaning: string; examples: string }[];
  variation_intro: string;
  variation_steps: string[];
  closing: string;
};
export type DefectBlock = {
  intro: string;
  small_job_note: string;
  steps: string[];
  why: string[];
  defects: { defect: string; examples: string }[];
  closing: string;
};

/** One check on a surface, with its wording at each level (the mockup's row). */
export type StandardCheck = { sort: number; label: string; text: Record<Level, string> };

export type StandardSurface = {
  key: string;
  side: Side;
  sort: number;
  name: string;
  intro: string | null;
  everyLevel: string;
  note: string | null;
  checks: StandardCheck[];
  /** Rate-card codes that mean this surface (standards_surface_codes). */
  codes: string[];
};

export type Standards = {
  version: { no: number; title: string; publishedOn: string; smallJobHours: number };
  levels: LevelsBlock;
  rules: RulesBlock;
  time: TimeBlock;
  interior: { intro: string };
  exterior: { intro: string; rules: string[] };
  defect: DefectBlock;
  checklist: { intro: string; items: string[] };
  words: { items: { word: string; meaning: string }[] };
  surfaces: StandardSurface[];
};

export function isLevel(n: unknown): n is Level {
  return n === 2 || n === 3 || n === 4;
}

/** "PG-3" → 3. Null for FIN-1 jobs (no PG level), blanks and anything else. */
export function levelOf(finishCode: string | null | undefined): Level | null {
  const m = /^PG-([234])$/i.exec((finishCode ?? "").trim());
  return m ? (Number(m[1]) as Level) : null;
}

/** The level a query string asked for, or the fallback. */
export function levelFromParam(value: string | undefined, fallback: Level = 3): Level {
  const n = Number(value);
  return isLevel(n) ? n : fallback;
}

export function surfaceByKey(standards: Standards, key: string): StandardSurface | null {
  return standards.surfaces.find((s) => s.key === key) ?? null;
}

export function surfacesOn(standards: Standards, side: Side): StandardSurface[] {
  return standards.surfaces.filter((s) => s.side === side);
}

export function levelName(standards: Standards, level: Level): { name: string; lookTest: string } {
  const item = standards.levels.items.find((i) => i.level === level);
  return { name: item?.name ?? `Level ${level}`, lookTest: item?.look_test_distance ?? "" };
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Which standards surface a work-order line is about, or null when none is.
 *
 * Step 0 found that a work-order line carries no rate-card code of its own
 * (`label = clientLabel || code`), so this looks in order at:
 *   1. the line's `code` (new snapshots carry it);
 *   2. the label as a rate-card code (the common case on issued jobs with no
 *      client label — "Walls", "Skirting Boards");
 *   3. the label as the standards surface's own name ("Skirting boards").
 * Three window codes and "Doors" exist on BOTH sides. The area's side decides;
 * with no side on the record, the other lines in the same area tell it (a room
 * with Walls and Ceilings is inside); failing that, interior. A line that
 * matches nothing gets NO link — never a guess (ruling S3, Step 1 acceptance).
 */
export function resolveSurface(
  standards: Standards,
  line: { code?: string | null; label: string },
  area: { side?: Side | null; lines?: { code?: string | null; label: string }[] } = {},
): StandardSurface | null {
  const candidates = candidatesFor(standards, line);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const side = area.side ?? inferSide(standards, area.lines ?? [], line) ?? "interior";
  return candidates.find((c) => c.side === side) ?? candidates[0];
}

function candidatesFor(standards: Standards, line: { code?: string | null; label: string }): StandardSurface[] {
  const code = norm(line.code);
  if (code) {
    const byCode = standards.surfaces.filter((s) => s.codes.some((c) => norm(c) === code));
    if (byCode.length) return byCode;
  }
  const label = norm(line.label);
  if (!label) return [];
  const byLabelCode = standards.surfaces.filter((s) => s.codes.some((c) => norm(c) === label));
  if (byLabelCode.length) return byLabelCode;
  return standards.surfaces.filter((s) => norm(s.name) === label);
}

/** The side the OTHER lines in an area point to, when they agree. */
function inferSide(standards: Standards, lines: { code?: string | null; label: string }[], self: { label: string }): Side | null {
  const votes = new Set<Side>();
  for (const l of lines) {
    if (l === self || norm(l.label) === norm(self.label)) continue;
    const found = candidatesFor(standards, l);
    if (found.length === 1) votes.add(found[0].side);
  }
  return votes.size === 1 ? [...votes][0] : null;
}

/**
 * Ruling S9: the tape defect step is not required on jobs under
 * `small_job_hours` (Settings, default 16). Hours are the job's estimated
 * hours (lib/workorder/hours.ts) — the figure on the job sheet.
 */
export function tapeCheckRequired(estimatedHours: number, smallJobHours: number): boolean {
  return estimatedHours >= smallJobHours;
}

export const DEFAULT_SMALL_JOB_HOURS = 16;

/** Where a surface standard lives, for each shell. */
export function surfaceHref(
  base: "portal" | "pc",
  key: string,
  opts: { level?: Level | null; job?: string | null } = {},
): string {
  const root = base === "portal" ? "/portal/help/standards" : "/pc/standards";
  const q = new URLSearchParams();
  if (opts.level) q.set("level", String(opts.level));
  if (opts.job) q.set("job", opts.job);
  const qs = q.toString();
  return `${root}/${key}${qs ? `?${qs}` : ""}`;
}

export function sectionHref(base: "portal" | "pc", key: SectionKey): string {
  return base === "portal" ? `/portal/help/standards/s/${key}` : `/pc/standards/s/${key}`;
}

/**
 * The "What we expect" links for a job sheet: document surface key → href,
 * each locked to that AREA's level (an area can override the job's level).
 * A surface with no mapped standard, or an area with no PG level, is absent.
 */
export function standardsLinksFor(
  standards: Standards,
  doc: { areas: { side?: Side | null; finishCode: string | null; surfaces: { key: string; label: string; code?: string | null }[] }[] },
  base: "portal" | "pc",
  job: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const area of doc.areas) {
    const level = levelOf(area.finishCode);
    if (!level) continue;
    for (const s of area.surfaces) {
      const hit = resolveSurface(standards, s, { side: area.side ?? null, lines: area.surfaces });
      if (hit) out[s.key] = surfaceHref(base, hit.key, { level, job });
    }
  }
  return out;
}

/**
 * Tom, 9 Oct 2026: "What we expect" in ONE place at the top of the work order
 * — every scope line with its standard at that area's level — instead of a
 * link scattered under each line. One entry per surface line that maps to a
 * standard (ruling S3: a line that matches nothing is simply not listed).
 */
export type Expectation = {
  /** The document surface key (area:line). */
  key: string;
  area: string;
  label: string;
  surfaceKey: string;
  surfaceName: string;
  side: Side;
  level: Level;
  levelName: string;
  lookTest: string;
  everyLevel: string;
  checks: { label: string; text: string }[];
  href: string;
};

export function expectationsFor(
  standards: Standards,
  doc: { areas: { title: string; side?: Side | null; finishCode: string | null; surfaces: { key: string; label: string; code?: string | null }[] }[] },
  base: "portal" | "pc",
  job: string,
): Expectation[] {
  const out: Expectation[] = [];
  for (const area of doc.areas) {
    const level = levelOf(area.finishCode);
    if (!level) continue;
    for (const s of area.surfaces) {
      const hit = resolveSurface(standards, s, { side: area.side ?? null, lines: area.surfaces });
      if (!hit) continue;
      const ln = levelName(standards, level);
      out.push({
        key: s.key, area: area.title, label: s.label, surfaceKey: hit.key, surfaceName: hit.name, side: hit.side, level,
        levelName: ln.name, lookTest: ln.lookTest, everyLevel: hit.everyLevel,
        checks: hit.checks.map((c) => ({ label: c.label, text: c.text[level] })),
        href: surfaceHref(base, hit.key, { level, job }),
      });
    }
  }
  return out;
}

/**
 * The same expectations as ONE document (Tom, 9 Oct 2026: "1 drop down
 * document … to save scrolling"): each standard once per level, with the scope
 * lines it covers, in the order the scope first reaches it. Walls in six rooms
 * is one Walls section listing six rooms, not six copies of the same checks.
 */
export type ExpectationSection = Omit<Expectation, "key" | "area" | "label"> & {
  key: string;
  lines: { key: string; area: string; label: string }[];
};

export function groupExpectations(items: Expectation[]): ExpectationSection[] {
  const byKey = new Map<string, ExpectationSection>();
  for (const it of items) {
    const key = `${it.surfaceKey}-${it.level}`;
    const line = { key: it.key, area: it.area, label: it.label };
    const hit = byKey.get(key);
    if (hit) { hit.lines.push(line); continue; }
    byKey.set(key, {
      key, surfaceKey: it.surfaceKey, surfaceName: it.surfaceName, side: it.side, level: it.level,
      levelName: it.levelName, lookTest: it.lookTest, everyLevel: it.everyLevel, checks: it.checks,
      href: it.href, lines: [line],
    });
  }
  return [...byKey.values()];
}
