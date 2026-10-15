/**
 * 12 Demo Street's room photos → the wo-photos bucket (Tom, 15 Oct 2026).
 *
 *   npx tsx scripts/seed-demo-photos.ts            # TEST project (.env.test.local)
 *   SEED_ALLOW_PRODUCTION=1 npx tsx scripts/seed-demo-photos.ts --prod
 *
 * Uploads docs/demo/photos/<room>.jpg to demo/reference/<room>.jpg — the five
 * shared files every practice job's wo_photos rows point at (migration
 * 20270275: demo_property_seed writes one reference row per room; the
 * wo_photos_demo_select storage policy lets any signed-in painter sign a
 * demo/ path). Idempotent: upsert, so a replaced photo lands under the same
 * path and every existing practice job shows the new one. Reads back the
 * bucket listing and refuses to exit 0 unless all five are there.
 * Target rule: seed-scripts-target.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadTestEnv, refuseProduction, parseEnvFile } from "./c1/env.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const SOURCE_DIR = resolve(ROOT, "docs/demo/photos");
const PREFIX = "demo/reference";
const EXPECTED = ["bedroom-1.jpg", "bedroom-2.jpg", "lounge.jpg", "kitchen.jpg", "hallway.jpg"];
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

async function main() {
  const db = createClient(url as string, key as string, { auth: { autoRefreshToken: false, persistSession: false } });
  const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".jpg")).sort();
  const missing = EXPECTED.filter((f) => !files.includes(f));
  if (missing.length) { console.error(`docs/demo/photos is missing: ${missing.join(", ")}`); process.exit(1); }

  for (const f of files) {
    const body = readFileSync(resolve(SOURCE_DIR, f));
    if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8) { console.error(`${f} is not a JPEG`); process.exit(1); }
    const { error } = await db.storage.from("wo-photos").upload(`${PREFIX}/${f}`, body, { contentType: "image/jpeg", upsert: true });
    if (error) { console.error(`upload ${f} failed: ${error.message}`); process.exit(1); }
    console.log(`  ${PREFIX}/${f}  ${(body.length / 1024).toFixed(0)} KB`);
  }

  // Read back through the bucket, not through what we just sent.
  const { data: listed, error: listErr } = await db.storage.from("wo-photos").list(PREFIX, { limit: 100 });
  if (listErr) { console.error(`list failed: ${listErr.message}`); process.exit(1); }
  const names = new Set((listed ?? []).map((o) => o.name));
  const absent = EXPECTED.filter((f) => !names.has(f));
  if (absent.length) { console.error(`read-back: not in the bucket: ${absent.join(", ")}`); process.exit(1); }
  console.log(`ok: ${EXPECTED.length} demo photos at ${PREFIX}/ (read back)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
