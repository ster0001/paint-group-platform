// READ ONLY (30 Sep): where did the WINDOW lines on an estimate come from?
// Usage: node scripts/diag/estimate-windows.mjs "<part of the title/address>"
// Prints the wizard's surface ticks, the windows-painted answer, and every
// window line with its provenance (ai_derived = plan reader/merge,
// customer_stated = rooms loop, starter = scaffold), count and coats.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const needle = (process.argv[2] ?? "").trim();
const q = db.from("estimates").select("id, number, title, status, source, created_at, updated_at, builder_state").order("updated_at", { ascending: false });
const { data, error } = needle && needle !== "STREET NAME HERE" ? await q.ilike("title", `%${needle}%`).limit(3) : await q.limit(5);
if (error) throw error;
if (!data.length) console.log("no estimate matched", JSON.stringify(needle));
const isWin = (code) => /window|sash|casement|colonial/i.test(String(code ?? ""));
for (const e of data) {
  const bs = e.builder_state ?? {};
  const w = bs.wizard ?? {};
  const st = w.state ?? w;
  console.log("==", e.number, e.title, "|", e.status, e.source, e.created_at);
  console.log("  ticks (state.surfaces):", JSON.stringify(st.surfaces ?? null));
  console.log("  details.windowsPainted:", st.details?.windowsPainted ?? null, "| windowStyle:", st.details?.windowStyle ?? null, "| jobType:", st.jobType ?? null);
  console.log("  interiorLoop:", JSON.stringify(bs.interiorLoop ?? null)?.slice(0, 200));
  console.log("  quickLook:", JSON.stringify(st.quickLook ? { scope: st.quickLook.scope, excluded: st.quickLook.excluded, changing: st.quickLook.changing, rooms: st.quickLook.rooms } : null));
  console.log("  entry:", st.entry ?? st.entrySource ?? null, "| planRunIds:", JSON.stringify(st.planRunIds ?? null), "| noPlan:", st.noPlan ?? null, "| assistant:", st.assistant ? "yes" : "no");
  for (const b of bs.blocks ?? []) {
    for (const s of b.surfaces ?? []) {
      if (!isWin(s.code)) continue;
      console.log(`  ${b.name} [${b.type}] :: ${s.code} | label=${s.internalLabel ?? s.clientLabel ?? ""} | count=${s.count} coats=${s.coats} | source=${s.source ?? s.provenance ?? "?"} conf=${s.confidence ?? ""} assumed=${JSON.stringify(s.assumedFields ?? [])} hidden=${!!s.hidden} opt=${!!s.isOption}`);
    }
  }
  console.log("  aiDeferred windows:", JSON.stringify((bs.aiDeferred ?? []).filter((d) => /window/i.test(d.what))));
}
