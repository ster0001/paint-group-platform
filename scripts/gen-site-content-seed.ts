/**
 * Generates the site_content seed rows for supabase/migrations from the copy
 * sets in lib/marketing/copy (session 8 §3: both seeds are migrations so
 * environments match). Idempotent SQL: insert … on conflict do nothing.
 *
 *   npx tsx scripts/gen-site-content-seed.ts > /tmp/seed.sql
 */
import { CONTENT_FIELDS } from "../lib/marketing/copy/schema";
import { DEFAULT_COPY } from "../lib/marketing/copy";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const lines: string[] = [];
for (const audience of ["home", "business"] as const) {
  const copy = DEFAULT_COPY[audience];
  for (const f of CONTENT_FIELDS) {
    const v = copy[f.section][f.key] ?? "";
    if (!v) continue;
    lines.push(`  (${q(audience)}, ${q(f.section)}, ${q(f.key)}, ${q(v)})`);
  }
}
process.stdout.write(`insert into public.site_content (audience, section, key, value) values\n${lines.join(",\n")}\non conflict (tenant_id, audience, section, key, sort) do nothing;\n`);
