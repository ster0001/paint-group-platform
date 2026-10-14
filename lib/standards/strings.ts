/**
 * The finish standards as a flat string map, and back (induction brief §5:
 * the six sign-off sections are read in the painter's language).
 *
 * `standardsStrings(standards)` lists every sentence a painter reads on the
 * standards screens under a stable key (`levels.intro`, `surfaces.walls.
 * checks.1.l3`, …). A translation file carries the same keys under
 * `standards.`; `localizeStandards` lays a map over the English model and
 * says which keys it could not find, so the caller can log the fallback
 * (acceptance: a missing string falls back to English and is logged).
 *
 * Pure, shared by server and client code.
 */
import type { Standards } from "./model";
import { LEVELS } from "./model";

export const STANDARDS_PREFIX = "standards.";

export function standardsStrings(s: Standards): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: string | null | undefined) => { if (typeof v === "string" && v.trim()) out[k] = v; };

  put("levels.intro", s.levels.intro);
  s.levels.items.forEach((it) => {
    put(`levels.items.${it.level}.name`, it.name);
    put(`levels.items.${it.level}.look_test_distance`, it.look_test_distance);
    it.summary.forEach((r, i) => { put(`levels.items.${it.level}.summary.${i + 1}.label`, r.label); put(`levels.items.${it.level}.summary.${i + 1}.text`, r.text); });
  });
  s.levels.look_test_steps.forEach((t, i) => put(`levels.look_test_steps.${i + 1}`, t));
  put("levels.look_test_high_areas", s.levels.look_test_high_areas);
  put("levels.closing", s.levels.closing);

  put("rules.intro", s.rules.intro);
  s.rules.items.forEach((r, i) => { put(`rules.items.${i + 1}.rule`, r.rule); put(`rules.items.${i + 1}.meaning`, r.meaning); });
  put("rules.closing", s.rules.closing);

  put("time.intro", s.time.intro);
  s.time.standard_preparation.interior.forEach((t, i) => put(`time.standard_preparation.interior.${i + 1}`, t));
  s.time.standard_preparation.exterior.forEach((t, i) => put(`time.standard_preparation.exterior.${i + 1}`, t));
  put("time.extra_time_intro", s.time.extra_time_intro);
  s.time.extra_time.forEach((x, i) => { put(`time.extra_time.${i + 1}.name`, x.name); put(`time.extra_time.${i + 1}.meaning`, x.meaning); put(`time.extra_time.${i + 1}.examples`, x.examples); });
  put("time.variation_intro", s.time.variation_intro);
  s.time.variation_steps.forEach((t, i) => put(`time.variation_steps.${i + 1}`, t));
  put("time.closing", s.time.closing);

  put("interior.intro", s.interior.intro);
  put("exterior.intro", s.exterior.intro);
  s.exterior.rules.forEach((t, i) => put(`exterior.rules.${i + 1}`, t));

  put("defect.intro", s.defect.intro);
  put("defect.small_job_note", s.defect.small_job_note);
  s.defect.steps.forEach((t, i) => put(`defect.steps.${i + 1}`, t));
  s.defect.why.forEach((t, i) => put(`defect.why.${i + 1}`, t));
  s.defect.defects.forEach((d, i) => { put(`defect.defects.${i + 1}.defect`, d.defect); put(`defect.defects.${i + 1}.examples`, d.examples); });
  put("defect.closing", s.defect.closing);

  put("checklist.intro", s.checklist.intro);
  s.checklist.items.forEach((t, i) => put(`checklist.items.${i + 1}`, t));

  s.words.items.forEach((w, i) => { put(`words.items.${i + 1}.word`, w.word); put(`words.items.${i + 1}.meaning`, w.meaning); });

  for (const sf of s.surfaces) {
    put(`surfaces.${sf.key}.name`, sf.name);
    put(`surfaces.${sf.key}.intro`, sf.intro);
    put(`surfaces.${sf.key}.every_level`, sf.everyLevel);
    put(`surfaces.${sf.key}.note`, sf.note);
    for (const c of sf.checks) {
      put(`surfaces.${sf.key}.checks.${c.sort}.label`, c.label);
      for (const l of LEVELS) put(`surfaces.${sf.key}.checks.${c.sort}.l${l}`, c.text[l]);
    }
  }
  return out;
}

export type Localized = { standards: Standards; missing: string[] };

/**
 * Lay a language's strings over the English model. Every key the English
 * model has and the map lacks is listed in `missing` (English stays), so the
 * caller can log it once. Keys the map has and the model does not are
 * ignored. The model's structure (levels, surface keys, check sorts, codes)
 * is never changed by a translation.
 */
export function localizeStandards(en: Standards, map: Record<string, string>): Localized {
  const missing: string[] = [];
  const t = (k: string, fallback: string): string => {
    const v = map[k];
    if (typeof v === "string" && v.trim()) return v;
    missing.push(k);
    return fallback;
  };
  const tn = (k: string, fallback: string | null): string | null => (fallback == null ? null : t(k, fallback));

  const standards: Standards = {
    version: en.version,
    levels: {
      intro: t("levels.intro", en.levels.intro),
      items: en.levels.items.map((it) => ({
        level: it.level,
        name: t(`levels.items.${it.level}.name`, it.name),
        look_test_distance: t(`levels.items.${it.level}.look_test_distance`, it.look_test_distance),
        summary: it.summary.map((r, i) => ({ label: t(`levels.items.${it.level}.summary.${i + 1}.label`, r.label), text: t(`levels.items.${it.level}.summary.${i + 1}.text`, r.text) })),
      })),
      look_test_steps: en.levels.look_test_steps.map((x, i) => t(`levels.look_test_steps.${i + 1}`, x)),
      look_test_high_areas: t("levels.look_test_high_areas", en.levels.look_test_high_areas),
      closing: t("levels.closing", en.levels.closing),
    },
    rules: {
      intro: t("rules.intro", en.rules.intro),
      items: en.rules.items.map((r, i) => ({ rule: t(`rules.items.${i + 1}.rule`, r.rule), meaning: t(`rules.items.${i + 1}.meaning`, r.meaning) })),
      closing: t("rules.closing", en.rules.closing),
    },
    time: {
      intro: t("time.intro", en.time.intro),
      standard_preparation: {
        interior: en.time.standard_preparation.interior.map((x, i) => t(`time.standard_preparation.interior.${i + 1}`, x)),
        exterior: en.time.standard_preparation.exterior.map((x, i) => t(`time.standard_preparation.exterior.${i + 1}`, x)),
      },
      extra_time_intro: t("time.extra_time_intro", en.time.extra_time_intro),
      extra_time: en.time.extra_time.map((x, i) => ({ name: t(`time.extra_time.${i + 1}.name`, x.name), meaning: t(`time.extra_time.${i + 1}.meaning`, x.meaning), examples: t(`time.extra_time.${i + 1}.examples`, x.examples) })),
      variation_intro: t("time.variation_intro", en.time.variation_intro),
      variation_steps: en.time.variation_steps.map((x, i) => t(`time.variation_steps.${i + 1}`, x)),
      closing: t("time.closing", en.time.closing),
    },
    interior: { intro: t("interior.intro", en.interior.intro) },
    exterior: { intro: t("exterior.intro", en.exterior.intro), rules: en.exterior.rules.map((x, i) => t(`exterior.rules.${i + 1}`, x)) },
    defect: {
      intro: t("defect.intro", en.defect.intro),
      small_job_note: t("defect.small_job_note", en.defect.small_job_note),
      steps: en.defect.steps.map((x, i) => t(`defect.steps.${i + 1}`, x)),
      why: en.defect.why.map((x, i) => t(`defect.why.${i + 1}`, x)),
      defects: en.defect.defects.map((d, i) => ({ defect: t(`defect.defects.${i + 1}.defect`, d.defect), examples: t(`defect.defects.${i + 1}.examples`, d.examples) })),
      closing: t("defect.closing", en.defect.closing),
    },
    checklist: { intro: t("checklist.intro", en.checklist.intro), items: en.checklist.items.map((x, i) => t(`checklist.items.${i + 1}`, x)) },
    words: { items: en.words.items.map((w, i) => ({ word: t(`words.items.${i + 1}.word`, w.word), meaning: t(`words.items.${i + 1}.meaning`, w.meaning) })) },
    surfaces: en.surfaces.map((sf) => ({
      ...sf,
      name: t(`surfaces.${sf.key}.name`, sf.name),
      intro: tn(`surfaces.${sf.key}.intro`, sf.intro),
      everyLevel: t(`surfaces.${sf.key}.every_level`, sf.everyLevel),
      note: tn(`surfaces.${sf.key}.note`, sf.note),
      checks: sf.checks.map((c) => ({
        sort: c.sort,
        label: t(`surfaces.${sf.key}.checks.${c.sort}.label`, c.label),
        text: { 2: t(`surfaces.${sf.key}.checks.${c.sort}.l2`, c.text[2]), 3: t(`surfaces.${sf.key}.checks.${c.sort}.l3`, c.text[3]), 4: t(`surfaces.${sf.key}.checks.${c.sort}.l4`, c.text[4]) },
      })),
    })),
  };
  return { standards, missing };
}

/** Strip the `standards.` prefix off a translation file's keys. */
export function standardsMapFrom(strings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(strings)) if (k.startsWith(STANDARDS_PREFIX)) out[k.slice(STANDARDS_PREFIX.length)] = v;
  return out;
}
