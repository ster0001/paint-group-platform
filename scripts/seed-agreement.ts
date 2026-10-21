/**
 * Subcontractor agreement → agreement_versions (contractor-agreement brief, Step 1).
 *
 *   npx tsx scripts/seed-agreement.ts            # TEST project (.env.test.local)
 *   SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-agreement.ts --prod
 *
 * Reads docs/agreements/subcontractor-agreement-v<N>.md for every N on disk —
 * the only source of the words — parses each (a malformed file stops the run
 * before anything is written), upserts one agreement_versions row per version
 * on the natural key, and READS BACK, refusing to exit 0 unless the body on
 * the table equals the file byte for byte and the hash matches. A version a
 * contractor has signed is never rewritten: the row keeps the wording whose
 * hash the signed row names, so a changed body under the same version number
 * is refused here too.
 * Target rule: seed-scripts-target. Migration 20270284 must be applied first.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseAgreement } from "../lib/agreements/source";
import { agreementBodyHash } from "../lib/agreements/hash";
import { loadTestEnv, refuseProduction, parseEnvFile } from "./c1/env.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DIR = "docs/agreements";
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

function die(step: string, error: { message: string; code?: string } | null): never {
  console.error(`${step} failed: ${error?.message ?? "unknown"}${error?.code === "42P01" ? " — is migration 20270284 applied?" : ""}`);
  process.exit(1);
}

// 0. the files, parsed before anything is written
const files = readdirSync(resolve(ROOT, DIR)).filter((n) => /^subcontractor-agreement-v\d+\.md$/.test(n)).sort();
if (!files.length) { console.error(`no ${DIR}/subcontractor-agreement-v<N>.md`); process.exit(1); }
const versions = files.map((name) => {
  const md = readFileSync(resolve(ROOT, DIR, name), "utf8");
  const file = parseAgreement(md);
  const n = Number(/v(\d+)\.md$/.exec(name)?.[1]);
  if (n !== file.version) { console.error(`${name} says Version: ${file.version}`); process.exit(1); }
  return { name, md, file, hash: agreementBodyHash(md) };
});
console.log(versions.map((v) => `v${v.file.version} (${v.file.approvedOn}, ${v.file.blocks.length} blocks, sha256 ${v.hash.slice(0, 12)}…)`).join(" · "));

async function main() {
  const db = createClient(url as string, key as string, { auth: { autoRefreshToken: false, persistSession: false } });

  for (const v of versions) {
    // A signed version keeps its words: refuse to change a body under a hash a signed row names.
    const { data: existing, error: exErr } = await db.from("agreement_versions").select("id, body_sha256").eq("version", v.file.version).maybeSingle();
    if (exErr) die(`read v${v.file.version}`, exErr);
    const ex = existing as { id: string; body_sha256: string } | null;
    if (ex && ex.body_sha256 !== v.hash) {
      const { count, error: cErr } = await db.from("contractor_agreements").select("id", { count: "exact", head: true }).eq("version", v.file.version).eq("status", "signed");
      if (cErr && cErr.code !== "42P01") die(`signed count v${v.file.version}`, cErr);
      if ((count ?? 0) > 0) { console.error(`REFUSED: v${v.file.version} has ${count} signed row(s) and the file's wording differs (table ${ex.body_sha256.slice(0, 12)}…, file ${v.hash.slice(0, 12)}…). A changed word is a new version.`); process.exit(1); }
    }
    const up = await db.from("agreement_versions").upsert({
      version: v.file.version, title: v.file.title, effective_from: v.file.approvedOn, body_md: v.md, schedules: v.file.schedules, body_sha256: v.hash, source_file: v.file.sourceFile,
    }, { onConflict: "version" });
    if (up.error) die(`upsert v${v.file.version}`, up.error);
  }

  // read back: the body on the table equals the file
  const { data: rows, error } = await db.from("agreement_versions").select("version, body_md, body_sha256, schedules").order("version");
  if (error) die("read-back", error);
  const back = (rows ?? []) as { version: number; body_md: string; body_sha256: string; schedules: unknown }[];
  for (const v of versions) {
    const r = back.find((x) => x.version === v.file.version);
    if (!r) { console.error(`read-back: v${v.file.version} missing`); process.exit(1); }
    if (r.body_md !== v.md) { console.error(`read-back: v${v.file.version} body DIFFERS from the file`); process.exit(1); }
    if (r.body_sha256 !== v.hash || agreementBodyHash(r.body_md) !== v.hash) { console.error(`read-back: v${v.file.version} hash DIFFERS`); process.exit(1); }
    if (JSON.stringify(r.schedules) !== JSON.stringify(v.file.schedules)) { console.error(`read-back: v${v.file.version} schedules DIFFER`); process.exit(1); }
  }
  const { data: cur, error: curErr } = await db.rpc("agreement_current_version");
  if (curErr) die("agreement_current_version", curErr);
  console.log(`${versions.length} version(s) on the table · current version ${String(cur)} · read-back equals the files ✓`);
}

main().catch((e) => { console.error(e); process.exit(1); });
