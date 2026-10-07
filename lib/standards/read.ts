import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { standardsFromRows, type BlockRow, type SurfaceRow } from "./source";
import { DEFAULT_SMALL_JOB_HOURS, type Level, type Side, type Standards } from "./model";

/**
 * The current finish standards, read from the tables through whichever client
 * is handed in — a session (RLS: staff and painters read, customers get
 * nothing) in the app, the service client in the seed script's read-back.
 *
 * Four reads, each one's `error` kept: a rejected read is reported and the
 * result says `standards: null` with the reason, so a screen says "the
 * standards could not be loaded", never "there are no standards" (CLAUDE.md,
 * the dropped-error rule). No `server-only` here on purpose: the seed script
 * runs this to prove the seed equals the file.
 */
export type StandardsLoad = { standards: Standards; error: null } | { standards: null; error: string };

type VersionRowDb = { id: string; version_no: number; title: string; published_at: string; small_job_hours: number };

export async function readStandards(supabase: SupabaseClient): Promise<StandardsLoad> {
  const versionRes = await supabase
    .from("standards_versions")
    .select("id, version_no, title, published_at, small_job_hours")
    .not("published_at", "is", null)
    .order("version_no", { ascending: false })
    .limit(1);
  if (versionRes.error) return failed("standards.version", versionRes.error);
  const version = ((versionRes.data ?? []) as VersionRowDb[])[0];
  if (!version) return { standards: null, error: "The finish standards have not been loaded yet (run scripts/seed-standards.ts)." };

  const [blocksRes, surfacesRes, codesRes] = await Promise.all([
    supabase.from("standards_blocks").select("section_key, sort, body").eq("version_id", version.id).order("sort"),
    supabase.from("standards_surfaces")
      .select("id, key, side, sort, name, intro, every_level, note, standards_checks(sort, level, label, text)")
      .eq("version_id", version.id).order("sort"),
    supabase.from("standards_surface_codes").select("surface_id, substrate_code").order("substrate_code"),
  ]);
  if (blocksRes.error) return failed("standards.blocks", blocksRes.error);
  if (surfacesRes.error) return failed("standards.surfaces", surfacesRes.error);
  if (codesRes.error) return failed("standards.codes", codesRes.error);

  const surfaceRows = (surfacesRes.data ?? []) as unknown as (Omit<SurfaceRow, "checks"> & {
    id: string; standards_checks: { sort: number; level: number; label: string; text: string }[] | null;
  })[];
  const codes: Record<string, { side: Side; codes: string[] }> = {};
  for (const s of surfaceRows) codes[s.key] = { side: s.side, codes: [] };
  for (const c of (codesRes.data ?? []) as { surface_id: string; substrate_code: string }[]) {
    const s = surfaceRows.find((x) => x.id === c.surface_id);
    if (s) codes[s.key].codes.push(c.substrate_code);
  }

  try {
    const standards = standardsFromRows({
      version: {
        version_no: version.version_no, title: version.title, published_at: version.published_at,
        is_material: true, change_note: "", source_file: "",
        small_job_hours: version.small_job_hours ?? DEFAULT_SMALL_JOB_HOURS,
      },
      blocks: (blocksRes.data ?? []) as BlockRow[],
      surfaces: surfaceRows.map((s) => ({
        key: s.key, side: s.side, sort: s.sort, name: s.name, intro: s.intro, every_level: s.every_level, note: s.note,
        checks: (s.standards_checks ?? []).map((c) => ({ sort: c.sort, level: c.level as Level, label: c.label, text: c.text })),
      })),
    }, codes);
    return { standards, error: null };
  } catch (e) {
    reportError(e, { where: "standards.shape" });
    return { standards: null, error: "The finish standards on record are incomplete." };
  }
}

function failed(where: string, error: { message: string; code?: string }): StandardsLoad {
  reportError(error, { where });
  // 42P01 = the tables are not there yet: the migration has not been pasted.
  const hint = error.code === "42P01" ? " (migration 20270224 not applied)" : "";
  return { standards: null, error: `The finish standards could not be loaded${hint}.` };
}
