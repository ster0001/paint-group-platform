// READ ONLY (6 Oct 2026): why won't this job leave In progress? Usage:
//   node scripts/diag/wo-next-step.mjs "Collins" "Jacka"
// Prints, per matching job: stage, surfaces and their states, photos by kind,
// the finishing-up list with what is still open, unsettled variations, open
// quality checks, the last events — and the verdict the finish gate would give.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const needles = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
if (needles.length === 0) { console.error("give part of one or more job addresses"); process.exit(1); }
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data ?? []; };
for (const needle of needles) {
  const ests = must(await db.from("estimates").select("id, number, title").ilike("title", `%${needle}%`).limit(5), "estimates");
  if (ests.length === 0) { console.log(`\nno estimate matched ${JSON.stringify(needle)}`); continue; }
  for (const e of ests) {
    const wos = must(await db.from("work_orders").select("id, wo_ref, stage, stage_entered_at, walkthrough_required").eq("estimate_id", e.id), "work_orders");
    for (const w of wos) {
      console.log(`\n=== #${e.number} ${e.title} | ${w.wo_ref} | stage=${w.stage} since ${String(w.stage_entered_at).slice(0, 16)} | walkthrough_required=${w.walkthrough_required}`);
      const surfaces = must(await db.from("wo_surfaces").select("heading, label, state, removed_from_scope, photos_optional").eq("work_order_id", w.id).order("sort"), "wo_surfaces");
      const working = surfaces.filter((s) => !s.removed_from_scope);
      const left = working.filter((s) => s.state !== "done");
      const wantPhotos = working.filter((s) => !s.photos_optional);
      console.log(`surfaces: ${working.length} working, ${left.length} not done, ${wantPhotos.length} want photos` + (left.length ? "\n   open: " + left.map((s) => `${s.heading}/${s.label}:${s.state}`).join(", ") : ""));
      const photos = must(await db.from("wo_photos").select("kind").eq("work_order_id", w.id), "wo_photos");
      const byKind = {}; for (const p of photos) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
      console.log("photos by kind:", JSON.stringify(byKind));
      const items = must(await db.from("wo_checklist_items").select("phase, label, required, kind, done_at, answer").eq("work_order_id", w.id).eq("phase", "completion_prep").order("sort"), "wo_checklist_items");
      const openItems = items.filter((i) => i.required && i.done_at === null && !(i.kind === "yes_no" && i.answer));
      console.log(`finishing-up list: ${items.length} items, ${openItems.length} required still open` + (openItems.length ? " — " + openItems.map((i) => i.label).join("; ") : ""));
      const vars = must(await db.from("wo_variations").select("status, comment").eq("work_order_id", w.id).in("status", ["raised", "priced", "customer_approved"]), "wo_variations");
      console.log(`variations waiting: ${vars.length}` + (vars.length ? " — " + vars.map((v) => `${v.status}: ${String(v.comment).slice(0, 60)}`).join("; ") : ""));
      const qa = must(await db.from("wo_qa_checks").select("kind, result").eq("work_order_id", w.id), "wo_qa_checks");
      console.log(`quality checks: ${qa.length} (${qa.filter((c) => c.result === null).length} unlogged)`);
      const waived = must(await db.from("wo_events").select("id").eq("work_order_id", w.id).eq("type", "after_photos_waived"), "wo_events").length > 0;
      const events = must(await db.from("wo_events").select("type, actor_kind, meta, created_at").eq("work_order_id", w.id).order("created_at", { ascending: false }).limit(8), "wo_events");
      for (const ev of events) console.log(`   ev ${String(ev.created_at).slice(0, 16)} ${ev.type} (${ev.actor_kind}) ${JSON.stringify(ev.meta ?? {}).slice(0, 140)}`);
      const verdict = w.stage !== "in_progress" && w.stage !== "completion_prep" ? `not at In progress (stage ${w.stage})`
        : working.length === 0 ? "no tick list — build it from the job sheet"
        : left.length > 0 ? `${left.length} of ${working.length} surfaces still to tick off`
        : w.stage === "in_progress" && !byKind.completion && !waived && wantPhotos.length > 0 ? "AFTER PHOTOS MISSING — the finish refuses (upload them on the PC card, or waive with a reason)"
        : openItems.length > 0 ? `${openItems.length} finishing-up item(s) still to tick or answer`
        : vars.length > 0 ? `${vars.length} variation(s) still waiting on a decision`
        : "nothing in the way of the finish — press All done — next step (a quality check may be due next)";
      console.log("VERDICT:", verdict);
    }
  }
}
