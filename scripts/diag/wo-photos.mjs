// READ ONLY (1 Oct): what does a job have on record? Usage:
//   node scripts/diag/wo-photos.mjs "Cootamundra"
// Prints the job's stage, its surfaces and states, every photo (kind, area,
// when), and the last events — so "he can't go to the next step" has data.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const needle = (process.argv[2] ?? "").trim();
if (!needle) { console.error("give part of the job address"); process.exit(1); }
// By address (estimate title) — and by painter (company or login name): "Saulius".
const { data: ests, error } = await db.from("estimates").select("id, number, title").ilike("title", `%${needle}%`).limit(5);
if (error) throw error;
let wos = [];
for (const e of ests) {
  const { data, error: wErr } = await db.from("work_orders").select("id, wo_ref, stage, contractor_id, estimate_id, created_at, stage_entered_at").eq("estimate_id", e.id);
  if (wErr) console.log("work_orders read failed:", wErr.message);
  for (const w of data ?? []) wos.push({ ...w, est: e });
}
const { data: painters } = await db.from("contractors").select("id, company_name, profiles(name)").or(`company_name.ilike.%${needle}%`);
const { data: byName } = await db.from("profiles").select("id, name").ilike("name", `%${needle}%`);
const painterIds = new Set([...(painters ?? []).map((c) => c.id)]);
for (const pr of byName ?? []) { const { data: c } = await db.from("contractors").select("id").eq("profile_id", pr.id); for (const r of c ?? []) painterIds.add(r.id); }
for (const cid of painterIds) {
  const { data } = await db.from("work_orders").select("id, wo_ref, stage, contractor_id, estimate_id, created_at, stage_entered_at").eq("contractor_id", cid).in("stage", ["in_progress", "scheduled", "offered", "qa", "completion_prep", "walkthrough"]).order("stage_entered_at", { ascending: false }).limit(6);
  for (const w of data ?? []) if (!wos.some((x) => x.id === w.id)) {
    const { data: e } = await db.from("estimates").select("id, number, title").eq("id", w.estimate_id).maybeSingle();
    wos.push({ ...w, est: e ?? { number: "?", title: "?" } });
  }
}
if (wos.length === 0) {
  // Nothing by address or name: list every job under way, with its painter, so the right one can be named.
  console.log("no job matched", JSON.stringify(needle), "— every job under way:");
  const { data: live, error: liveErr } = await db.from("work_orders").select("id, wo_ref, stage, contractor_id, estimate_id, stage_entered_at").in("stage", ["in_progress", "qa", "completion_prep", "walkthrough"]).order("stage_entered_at", { ascending: false }).limit(25);
  if (liveErr) console.log("read failed:", liveErr.message);
  for (const w of live ?? []) {
    const { data: e } = await db.from("estimates").select("number, title").eq("id", w.estimate_id).maybeSingle();
    const { data: c } = await db.from("contractors").select("company_name, profiles(name)").eq("id", w.contractor_id).maybeSingle();
    const { count } = await db.from("wo_photos").select("id", { count: "exact", head: true }).eq("work_order_id", w.id);
    console.log(`   #${e?.number ?? "?"} ${e?.title ?? "?"} | ${w.wo_ref} | ${w.stage} | ${c?.company_name ?? "?"} / ${c?.profiles?.name ?? "?"} | photos=${count ?? 0} | updated ${w.stage_entered_at.slice(0, 16)}`);
  }
}
{
  for (const w of wos) {
    const e = w.est;
    const { data: c } = await db.from("contractors").select("company_name, employment_type").eq("id", w.contractor_id).maybeSingle();
    console.log(`== #${e.number} ${e.title} | WO ${w.wo_ref} | stage=${w.stage} | ${c?.company_name ?? "?"} (${c?.employment_type ?? "?"}) | updated ${w.stage_entered_at}`);
    const { data: snapRow } = await db.from("work_orders").select("wo_snapshot, issued_at").eq("id", w.id).maybeSingle();
    const snap = snapRow?.wo_snapshot ?? null;
    const snapAreas = Array.isArray(snap?.areas) ? snap.areas : [];
    console.log(`   wo_snapshot: ${snap ? `${snapAreas.length} areas (${snapAreas.map((a) => `${a.title}:${(a.surfaces ?? []).length}`).join(", ")}), ${(snap.materials ?? []).length} materials` : "NONE"} | issued ${snapRow?.issued_at ?? "never"}`);
    const { data: estRow } = await db.from("estimates").select("builder_state, accepted_at, status").eq("id", w.estimate_id).maybeSingle();
    const bs = estRow?.builder_state ?? {};
    const blocks = Array.isArray(bs.blocks) ? bs.blocks : [];
    const woDoc = bs.woDoc ?? null;
    console.log(`   estimate: ${estRow?.status} accepted ${estRow?.accepted_at ?? "-"} | builder blocks: ${blocks.length} (${blocks.filter((b) => b.kind === "area").map((b) => `${b.name}:${(b.surfaces ?? []).length}${b.isOption ? "(opt)" : ""}`).join(", ")}) | builder woDoc areas: ${woDoc ? (woDoc.areas ?? []).length : "none"}`);
    const { data: s, error: sErr } = await db.from("wo_surfaces").select("heading, label, state, photos_optional, removed_from_scope").eq("work_order_id", w.id).order("sort");
    if (sErr) console.log("   wo_surfaces read failed:", sErr.message);
    for (const r of s ?? []) console.log(`   ${r.heading} :: ${r.label} = ${r.state}${r.photos_optional ? " (no photos)" : ""}${r.removed_from_scope ? " (removed)" : ""}`);
    const { data: p } = await db.from("wo_photos").select("kind, area, caption, storage_path, created_at, taken_by").eq("work_order_id", w.id).order("created_at");
    console.log(`   photos: ${(p ?? []).length}`);
    for (const r of p ?? []) console.log(`     ${r.created_at.slice(0, 16)} ${r.kind} area="${r.area}" ${r.storage_path.split("/").pop()}`);
    const { data: ev } = await db.from("wo_events").select("type, actor_kind, created_at, meta").eq("work_order_id", w.id).order("created_at", { ascending: false }).limit(12);
    console.log("   last events:");
    for (const r of ev ?? []) console.log(`     ${r.created_at.slice(0, 16)} ${r.type} (${r.actor_kind}) ${JSON.stringify(r.meta ?? {}).slice(0, 90)}`);
  }
}
