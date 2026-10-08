/**
 * Finish standards → the standards_* tables (brief Step 1; ruling S2).
 *
 *   npx tsx scripts/seed-standards.ts            # TEST project (.env.test.local)
 *   SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-standards.ts --prod
 *
 * Reads docs/standards/finish-standards-v1.json — the approved guide, checked
 * word for word against the source document, never typed from memory — and
 * loads it as Version <file.version>: the version row, eight rule blocks, 17
 * surfaces, one standards_checks row per surface, per level, per check (159),
 * and the rate-card code map from lib/standards/codes.ts. Idempotent: rows are
 * upserted on their natural keys and anything of this version that the file
 * no longer carries is removed. It then READS BACK through the same code the
 * app uses and refuses to exit 0 unless the tables equal the file exactly.
 * Target rule: seed-scripts-target. Migration 20270224 must be applied first.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { standardsFromFile, standardsRows, type StandardsFile } from "../lib/standards/source";
import { SURFACE_CODES } from "../lib/standards/codes";
import { readStandards } from "../lib/standards/read";
import { loadTestEnv, refuseProduction, parseEnvFile } from "./c1/env.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const SOURCE = "docs/standards/finish-standards-v1.json";
const PROD = process.argv.includes("--prod");
let url: string | undefined, key: string | undefined;
if (PROD) {
  if (process.env.SEED_ALLOW_PRODUCTION !== "1") { console.error("REFUSED: --prod needs SEED_ALLOW_PRODUCTION=1 — Tom runs this himself."); process.exit(1); }
  const env = parseEnvFile(resolve(ROOT, ".env.local")) as Record<string, string>;
  url = env.NEXT_PUBLIC_SUPABASE_URL; key = env.SUPABASE_SERVICE_ROLE_KEY;
} else {
  loadTestEnv();
  url = process.env.NEXT_PUBLIC_SUPABASE_URL; key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  refuseProduction(url ?? "");
}
if (!url || !key) { console.error("Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for the target."); process.exit(1); }
console.log(`target: ${url.match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? url} (${PROD ? "PRODUCTION" : "test"})`);

const file = JSON.parse(readFileSync(resolve(ROOT, SOURCE), "utf8")) as StandardsFile;
const rows = standardsRows(file, SOURCE);

function die(step: string, error: { message: string; code?: string } | null): never {
  console.error(`${step} failed: ${error?.message ?? "unknown"}${error?.code === "42P01" ? " — is migration 20270224 applied?" : ""}`);
  process.exit(1);
}

async function main() {
  const db = createClient(url as string, key as string, { auth: { autoRefreshToken: false, persistSession: false } });

  // 1. the version
  const v = await db.from("standards_versions")
    .upsert({ ...rows.version }, { onConflict: "version_no" })
    .select("id").single();
  if (v.error) die("version", v.error);
  const versionId = (v.data as { id: string }).id;

  // 2. the rule blocks
  const b = await db.from("standards_blocks")
    .upsert(rows.blocks.map((x) => ({ ...x, version_id: versionId })), { onConflict: "version_id,section_key" });
  if (b.error) die("blocks", b.error);
  const staleBlocks = await db.from("standards_blocks").delete().eq("version_id", versionId)
    .not("section_key", "in", `(${rows.blocks.map((x) => x.section_key).join(",")})`);
  if (staleBlocks.error) die("blocks (stale)", staleBlocks.error);

  // 3. the surfaces
  const s = await db.from("standards_surfaces")
    .upsert(rows.surfaces.map((x) => ({
      key: x.key, side: x.side, sort: x.sort, name: x.name, intro: x.intro, every_level: x.every_level, note: x.note,
      version_id: versionId,
    })), { onConflict: "version_id,key" })
    .select("id, key");
  if (s.error) die("surfaces", s.error);
  const idByKey = new Map(((s.data ?? []) as { id: string; key: string }[]).map((x) => [x.key, x.id]));
  const staleSurfaces = await db.from("standards_surfaces").delete().eq("version_id", versionId)
    .not("key", "in", `(${rows.surfaces.map((x) => x.key).join(",")})`);
  if (staleSurfaces.error) die("surfaces (stale)", staleSurfaces.error);

  // 4. the checks — one row per surface, per level, per check
  const checkRows = rows.surfaces.flatMap((sf) => sf.checks.map((c) => ({ ...c, surface_id: idByKey.get(sf.key)! })));
  const c = await db.from("standards_checks").upsert(checkRows, { onConflict: "surface_id,sort,level" });
  if (c.error) die("checks", c.error);
  for (const sf of rows.surfaces) {
    const keep = sf.checks.map((x) => x.sort);
    const stale = await db.from("standards_checks").delete().eq("surface_id", idByKey.get(sf.key)!)
      .not("sort", "in", `(${keep.join(",")})`);
    if (stale.error) die(`checks (stale, ${sf.key})`, stale.error);
  }

  // 5. the rate-card code map — replaced whole, it is small and has no history
  const surfaceIds = [...idByKey.values()];
  const clear = await db.from("standards_surface_codes").delete().in("surface_id", surfaceIds);
  if (clear.error) die("codes (clear)", clear.error);
  const codeRows = Object.entries(SURFACE_CODES).flatMap(([k, m]) => {
    const surfaceId = idByKey.get(k);
    if (!surfaceId) throw new Error(`codes: surface "${k}" is in lib/standards/codes.ts but not in the file`);
    return m.codes.map((substrate_code) => ({ surface_id: surfaceId, substrate_code }));
  });
  if (codeRows.length) {
    const ins = await db.from("standards_surface_codes").insert(codeRows);
    if (ins.error) die("codes", ins.error);
  }

  // 6. read back through the app's own reader and diff against the file
  const back = await readStandards(db);
  if (!back.standards) die("read-back", { message: back.error });
  // jsonb does not keep object key order, so compare with keys sorted.
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
    : v;
  const expected = standardsFromFile(file, SURFACE_CODES);
  const a = JSON.stringify(canon(expected)), bb = JSON.stringify(canon(back.standards));
  if (a !== bb) {
    let i = 0; while (i < a.length && a[i] === bb[i]) i++;
    console.error("read-back DIFFERS from the file at offset", i);
    console.error("  file : …" + a.slice(Math.max(0, i - 60), i + 120));
    console.error("  table: …" + bb.slice(Math.max(0, i - 60), i + 120));
    process.exit(1);
  }

  const checks = checkRows.length;
  console.log(`Version ${rows.version.version_no} · "${rows.version.title}" · approved ${rows.version.published_at}`);
  console.log(`${rows.surfaces.length} surfaces (${rows.surfaces.filter((x) => x.side === "interior").length} interior, ${rows.surfaces.filter((x) => x.side === "exterior").length} exterior) · ${checks / 3} checks · ${checks} level rows · ${codeRows.length} rate codes mapped`);
  console.log("read-back equals the file ✓");
}

main().catch((e) => { console.error(e); process.exit(1); });
