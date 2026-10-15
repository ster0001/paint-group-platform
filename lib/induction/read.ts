import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { DEFAULT_LANGUAGE, languageOf, type Dir, type LanguageCode } from "./languages";

/**
 * The induction, read from the tables in ONE language with English behind it
 * (induction brief §5: a missing translation falls back to English, never to
 * a blank). Whichever client is handed in — a painter session (RLS: staff,
 * contractors and workers read) in the app, the service client in the seed
 * script's read-back. No `server-only` on purpose, for the seed.
 *
 * Every read keeps its error: a rejected read says `induction: null` with the
 * reason, so a screen says "the induction could not be loaded", never "there
 * is no induction" (the dropped-error rule).
 */

export type InductionLine = {
  /** title | s1… | tick | w1… */
  lineKey: string;
  kind: "title" | "statement" | "tick" | "worker_extra";
  audiences: ("contractor" | "worker")[];
  text: string;
  /** False when the English text stands in for a missing translation. */
  translated: boolean;
};

export type InductionModuleView = {
  key: string;
  no: number;
  /** In the language, or English when missing. */
  title: string;
  minutes: number;
  standardsSections: string[];
  statements: InductionLine[];
  workerExtra: InductionLine[];
  tick: InductionLine;
};

export type Induction = {
  version: { id: string; no: number; kind: string; title: string; publishedOn: string | null };
  language: LanguageCode;
  dir: Dir;
  modules: InductionModuleView[];
  /** `m03.s2`-style keys the language had no row for (English was shown). */
  missing: string[];
};

export type InductionLoad = { induction: Induction; error: null } | { induction: null; error: string };

type ModuleRow = { id: string; module_key: string; sort: number; title: string; minutes: number; standards_sections: string[] | null };
type BlockRow = { module_id: string; line_key: string; kind: InductionLine["kind"]; sort: number; audiences: string[] | null; language: string; text: string };

export async function readInduction(supabase: SupabaseClient, language: LanguageCode, kind: "full" | "refresher" | "worker" = "full"): Promise<InductionLoad> {
  const versionRes = await supabase.from("induction_versions")
    .select("id, version_no, version_kind, title, published_at")
    .eq("version_kind", kind).not("published_at", "is", null)
    .order("version_no", { ascending: false }).limit(1);
  if (versionRes.error) return failed("induction.version", versionRes.error);
  const version = ((versionRes.data ?? []) as { id: string; version_no: number; version_kind: string; title: string; published_at: string | null }[])[0];
  if (!version) return { induction: null, error: "The induction has not been loaded yet (run scripts/seed-induction.ts)." };

  const modulesRes = await supabase.from("induction_modules")
    .select("id, module_key, sort, title, minutes, standards_sections").eq("version_id", version.id).order("sort");
  if (modulesRes.error) return failed("induction.modules", modulesRes.error);
  const modules = (modulesRes.data ?? []) as ModuleRow[];
  const ids = modules.map((m) => m.id);
  const langs = language === DEFAULT_LANGUAGE ? [DEFAULT_LANGUAGE] : [DEFAULT_LANGUAGE, language];
  const blocksRes = ids.length
    ? await supabase.from("induction_blocks").select("module_id, line_key, kind, sort, audiences, language, text").in("module_id", ids).in("language", langs).order("sort")
    : { data: [] as BlockRow[], error: null };
  if (blocksRes.error) return failed("induction.blocks", blocksRes.error);
  const blocks = (blocksRes.data ?? []) as BlockRow[];

  const missing: string[] = [];
  const out: InductionModuleView[] = [];
  for (const m of modules) {
    const en = blocks.filter((b) => b.module_id === m.id && b.language === DEFAULT_LANGUAGE);
    const mine = new Map(blocks.filter((b) => b.module_id === m.id && b.language === language).map((b) => [b.line_key, b]));
    const line = (b: BlockRow): InductionLine => {
      const t = language === DEFAULT_LANGUAGE ? b : mine.get(b.line_key);
      if (!t) missing.push(`${m.module_key}.${b.line_key}`);
      return {
        lineKey: b.line_key, kind: b.kind,
        audiences: (b.audiences ?? ["contractor"]).filter((a): a is "contractor" | "worker" => a === "contractor" || a === "worker"),
        text: (t ?? b).text, translated: Boolean(t),
      };
    };
    const title = en.find((b) => b.kind === "title");
    const tick = en.find((b) => b.kind === "tick");
    if (!title || !tick) return { induction: null, error: `The induction on record is incomplete (${m.module_key} has no ${!title ? "title" : "tick"}).` };
    out.push({
      key: m.module_key, no: Number(m.module_key.slice(1)), title: line(title).text, minutes: m.minutes,
      standardsSections: m.standards_sections ?? [],
      statements: en.filter((b) => b.kind === "statement").map(line),
      workerExtra: en.filter((b) => b.kind === "worker_extra").map(line),
      tick: line(tick),
    });
  }
  return {
    induction: {
      version: { id: version.id, no: version.version_no, kind: version.version_kind, title: version.title, publishedOn: version.published_at },
      language, dir: languageOf(language).dir, modules: out, missing,
    },
    error: null,
  };
}

/** The lines a WORKER reads of a module (ruling ⚑17), in reading order. Empty when the module is not theirs. */
export function workerLines(m: InductionModuleView): InductionLine[] {
  const mine = m.statements.filter((s) => s.audiences.includes("worker"));
  return [...mine, ...m.workerExtra];
}

/** Is this module in the worker induction at all? */
export function moduleForWorker(m: InductionModuleView): boolean {
  return workerLines(m).length > 0;
}

function failed(where: string, error: { message: string; code?: string }): InductionLoad {
  reportError(error, { where });
  const hint = error.code === "42P01" ? " (migration 20270267 not applied)" : "";
  return { induction: null, error: `The induction could not be loaded${hint}.` };
}
