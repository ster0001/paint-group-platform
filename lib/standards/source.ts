/**
 * The approved finish standards, as data (brief §5, ruling S2).
 *
 * `docs/standards/finish-standards-v1.json` is the ONLY source of the words.
 * This module reads that file's shape and turns it into the rows the
 * `standards_*` tables hold — one `standards_checks` row per surface, per
 * level, per check — and into the in-app `Standards` model, so the loader,
 * the tests and the screens all derive from one derivation. Nothing here
 * invents or shortens a line; a seed that does not equal the file is a bug the
 * loader reports (scripts/seed-standards.ts re-reads and diffs).
 *
 * Shared by server and client code: no fs, no Supabase. The file itself is
 * read by the loader script and the tests, never bundled into a page.
 */
import type {
  DefectBlock, Level, LevelsBlock, RulesBlock, SectionKey, Side, StandardSurface, Standards, TimeBlock,
} from "./model";
import { LEVELS, SIGN_OFF_SECTIONS } from "./model";

/** The JSON file, as approved on 6 Oct 2026. Field names are the file's own. */
export type StandardsFile = {
  title: string;
  version: number;
  approved_on: string;
  language: string;
  small_job_hours: number;
  sign_off_sections: string[];
  levels: {
    intro: string;
    items: { level: number; name: string; look_test_distance: string; summary: { label: string; text: string }[] }[];
    look_test_steps: string[];
    look_test_high_areas: string;
    closing: string;
  };
  rules: { intro: string; items: { rule: string; meaning: string }[]; closing: string };
  time: {
    intro: string;
    standard_preparation: { interior: string[]; exterior: string[] };
    extra_time_intro: string;
    extra_time: { name: string; meaning: string; examples: string }[];
    variation_intro: string;
    variation_steps: string[];
    closing: string;
  };
  interior_intro: string;
  exterior_intro: string;
  exterior_rules: string[];
  surfaces: {
    side: string;
    key: string;
    substrate_code: string | null;
    sort: number;
    name: string;
    intro: string | null;
    every_level: string;
    checks: { sort: number; label: string; level_2: string; level_3: string; level_4: string }[];
    note: string | null;
  }[];
  defect_rule: {
    intro: string;
    small_job_note: string;
    steps: string[];
    why: string[];
    defects: { defect: string; examples: string }[];
    closing: string;
  };
  final_checklist: { intro: string; items: string[] };
  words: { word: string; meaning: string }[];
};

/** `standards_versions` — one row per published version. */
export type VersionRow = {
  version_no: number;
  title: string;
  published_at: string;
  is_material: boolean;
  change_note: string;
  source_file: string;
  small_job_hours: number;
};

/** `standards_blocks` — the rule pages, one jsonb body per section. */
export type BlockRow = { section_key: SectionKey; sort: number; body: unknown };

/** `standards_surfaces` with its `standards_checks` nested, ready to insert. */
export type SurfaceRow = {
  key: string;
  side: Side;
  sort: number;
  name: string;
  intro: string | null;
  every_level: string;
  note: string | null;
  checks: { sort: number; level: Level; label: string; text: string }[];
};

export type StandardsRows = { version: VersionRow; blocks: BlockRow[]; surfaces: SurfaceRow[] };

/** The section order the rule pages are listed in (the mockup's "The rules" list). */
export const BLOCK_ORDER: SectionKey[] = ["levels", "rules", "time", "interior", "exterior", "defect", "checklist", "words"];

function sideOf(value: string, key: string): Side {
  if (value === "interior" || value === "exterior") return value;
  throw new Error(`standards: surface "${key}" has side "${value}", expected interior or exterior`);
}

/**
 * File → table rows. Pure and total: a malformed file throws with the field
 * named, so the loader stops rather than seeding half a version.
 */
export function standardsRows(file: StandardsFile, sourceFile: string): StandardsRows {
  if (!Number.isInteger(file.version) || file.version < 1) throw new Error("standards: version must be a positive integer");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(file.approved_on)) throw new Error("standards: approved_on must be YYYY-MM-DD");
  const expectedSections = [...SIGN_OFF_SECTIONS] as string[];
  if (JSON.stringify(file.sign_off_sections) !== JSON.stringify(expectedSections)) {
    throw new Error(`standards: sign_off_sections must be ${expectedSections.join(", ")}`);
  }
  const version: VersionRow = {
    version_no: file.version,
    title: file.title,
    // The approval date, as a calendar day. The column is a date, never a
    // timestamp, so no offset is ever written down (CLAUDE.md dates rule).
    published_at: file.approved_on,
    is_material: true,
    change_note: "",
    source_file: sourceFile,
    small_job_hours: file.small_job_hours,
  };

  const bodies: Record<SectionKey, unknown> = {
    levels: file.levels,
    rules: file.rules,
    time: file.time,
    interior: { intro: file.interior_intro },
    exterior: { intro: file.exterior_intro, rules: file.exterior_rules },
    defect: file.defect_rule,
    checklist: file.final_checklist,
    words: { items: file.words },
  };
  const blocks: BlockRow[] = BLOCK_ORDER.map((section_key, sort) => ({ section_key, sort, body: bodies[section_key] }));

  const seen = new Set<string>();
  const surfaces: SurfaceRow[] = file.surfaces.map((s) => {
    if (seen.has(s.key)) throw new Error(`standards: surface key "${s.key}" appears twice`);
    seen.add(s.key);
    const checks: SurfaceRow["checks"] = [];
    for (const c of s.checks) {
      for (const level of LEVELS) {
        const text = c[`level_${level}` as const];
        if (typeof text !== "string" || !text.trim()) throw new Error(`standards: ${s.key} / ${c.label} has no level ${level} text`);
        checks.push({ sort: c.sort, level, label: c.label, text });
      }
    }
    return {
      key: s.key, side: sideOf(s.side, s.key), sort: s.sort, name: s.name,
      intro: s.intro, every_level: s.every_level, note: s.note, checks,
    };
  });

  return { version, blocks, surfaces };
}

/**
 * File → the in-app model, with no database in between. The loader builds the
 * same shape from the tables (lib/standards/load.ts); the seed script compares
 * the two to prove the seed equals the file.
 */
export function standardsFromFile(file: StandardsFile, codes: Record<string, { side: Side; codes: string[] }> = {}): Standards {
  const rows = standardsRows(file, "");
  return standardsFromRows(rows, codes);
}

/** Rows (from the file or read back from the tables) → the in-app model. */
export function standardsFromRows(rows: StandardsRows, codes: Record<string, { side: Side; codes: string[] }>): Standards {
  const body = <T,>(key: SectionKey): T => {
    const b = rows.blocks.find((x) => x.section_key === key);
    if (!b) throw new Error(`standards: block "${key}" is missing`);
    return b.body as T;
  };
  const surfaces: StandardSurface[] = [...rows.surfaces]
    .sort((a, b) => (a.side === b.side ? a.sort - b.sort : a.side === "interior" ? -1 : 1))
    .map((s) => {
      const bySort = new Map<number, { sort: number; label: string; text: Record<Level, string> }>();
      for (const c of [...s.checks].sort((a, b) => a.sort - b.sort || a.level - b.level)) {
        const row = bySort.get(c.sort) ?? { sort: c.sort, label: c.label, text: { 2: "", 3: "", 4: "" } };
        row.text[c.level] = c.text;
        bySort.set(c.sort, row);
      }
      return {
        key: s.key, side: s.side, sort: s.sort, name: s.name, intro: s.intro,
        everyLevel: s.every_level, note: s.note,
        checks: [...bySort.values()],
        // Sorted, so the file and the tables (which hold no order) compare equal.
        codes: [...(codes[s.key]?.codes ?? [])].sort(),
      };
    });
  return {
    version: {
      no: rows.version.version_no,
      title: rows.version.title,
      publishedOn: rows.version.published_at.slice(0, 10),
      smallJobHours: rows.version.small_job_hours,
    },
    levels: body<LevelsBlock>("levels"),
    rules: body<RulesBlock>("rules"),
    time: body<TimeBlock>("time"),
    interior: body<{ intro: string }>("interior"),
    exterior: body<{ intro: string; rules: string[] }>("exterior"),
    defect: body<DefectBlock>("defect"),
    checklist: body<{ intro: string; items: string[] }>("checklist"),
    words: body<{ items: { word: string; meaning: string }[] }>("words"),
    surfaces,
  };
}
