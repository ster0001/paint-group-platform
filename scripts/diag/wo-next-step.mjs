// READ ONLY (6 Oct 2026; Quality check verdict added 7 Oct): why won't this job leave In progress — or Quality check? Usage:
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
    const wos = must(await db.from("work_orders").select("id, wo_ref, stage, stage_entered_at, walkthrough_required, wo_snapshot, colours").eq("estimate_id", e.id), "work_orders");
    if (wos.length === 0) console.log(`\n=== #${e.number} ${e.title} — no work order on this estimate`);
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
      // The colour-match gate on every exit from prep (mirrors wo_colour_match_outstanding).
      const colourNo = must(await db.from("wo_checklist_items").select("answer").eq("work_order_id", w.id).eq("phase", "pre_start").eq("item_key", "colours"), "pre_start colours").some((i) => i.answer === "no");
      const mats = Array.isArray(w.wo_snapshot?.materials) ? w.wo_snapshot.materials : [];
      const colourMatch = mats.filter((m) => {
        const product = String(m.product ?? "");
        const flagged = Boolean(m.colourMatch?.required);
        const colour = String(m.colourName ?? "");
        const snapCode = String(m.colourMatch?.code ?? "");
        const woCode = String(w.colours?.[product]?.match?.code ?? "");
        return (flagged || (colourNo && colour === "")) && snapCode === "" && woCode === "" && !/fuel|consumable/i.test(product);
      }).map((m) => m.product);
      console.log(`colour match: pre-start colours answered no=${colourNo}; codes still needed for: ${colourMatch.length ? colourMatch.join(", ") : "none"}`);
      const signoff = must(await db.from("wo_signoff").select("signed_at, evidence_pack_sent_at").eq("work_order_id", w.id), "wo_signoff")[0];
      console.log(`sign-off row: ${signoff ? `signed_at=${signoff.signed_at} pack_sent=${signoff.evidence_pack_sent_at}` : "none"}`);
      const waived = must(await db.from("wo_events").select("id").eq("work_order_id", w.id).eq("type", "after_photos_waived"), "wo_events").length > 0;
      const events = must(await db.from("wo_events").select("type, actor_kind, meta, created_at").eq("work_order_id", w.id).order("created_at", { ascending: false }).limit(8), "wo_events");
      for (const ev of events) console.log(`   ev ${String(ev.created_at).slice(0, 16)} ${ev.type} (${ev.actor_kind}) ${JSON.stringify(ev.meta ?? {}).slice(0, 140)}`);
      // Tom, 7 Oct 2026 (25 Bunney Road): why won't a job leave Quality check? The
      // route (wo_qa_route_passed) needs NO open check — unlogged, or a fail with no
      // re-check — then the pack gate: no variation at raised/priced/customer_approved,
      // colour-match codes in, a sign-off row not already signed. Zero checks used to
      // park it for ever (fixed in 20270220: nothing to check routes like a pass).
      const qaFull = must(await db.from("wo_qa_checks").select("id, kind, result, retry_of").eq("work_order_id", w.id), "wo_qa_checks");
      const unlogged = qaFull.filter((c) => c.result === null);
      const failsOpen = qaFull.filter((c) => c.result === "fail" && !qaFull.some((r) => r.retry_of === c.id));
      const varDetail = vars.map((v) => `${v.status}${v.status === "customer_approved" ? " (waiting on the painter's accept — or on Release if the automation is off)" : ""}`).join("; ");
      const qaVerdict = w.stage !== "qa" ? null
        : qaFull.length === 0 ? "NO CHECK ON THIS JOB — before 20270220 this parked it for ever; with 20270220 live it routes on next view/sweep. If it still sits here, the pack gate below is the reason."
        : unlogged.length > 0 ? `${unlogged.length} quality check(s) not logged yet — tick the four standards and log PASS (or FAIL) on the job page`
        : failsOpen.length > 0 ? `${failsOpen.length} FAILED check(s) with no re-check scheduled — the painter has to finish again (job → In progress) so the re-check is created`
        : vars.length > 0 ? `every check passed, but ${vars.length} variation(s) hold the pack gate: ${varDetail} — approve/decline/release them (a painter-declined one no longer holds)`
        : colourMatch.length > 0 ? `every check passed, but COLOUR MATCH CODES are still needed for ${colourMatch.join(", ")}`
        : signoff?.signed_at ? "every check passed, but the sign-off row is already signed — the close refuses (already_signed); tell whoever looks after the platform"
        : "every check passed and nothing holds the pack — open the job page in PC Command (or wait for the evening sweep) and it routes to Walkthrough / Closed on its own";
      const verdict = qaVerdict ? qaVerdict
        : w.stage !== "in_progress" && w.stage !== "completion_prep" ? `not at In progress (stage ${w.stage})`
        : working.length === 0 ? "no tick list — build it from the job sheet"
        : left.length > 0 ? `${left.length} of ${working.length} surfaces still to tick off`
        : w.stage === "in_progress" && !byKind.completion && !waived && wantPhotos.length > 0 ? "AFTER PHOTOS MISSING — the finish refuses (upload them on the PC card, or waive with a reason)"
        : openItems.length > 0 ? `${openItems.length} finishing-up item(s) still to tick or answer`
        : vars.length > 0 ? `${vars.length} variation(s) still waiting on a decision`
        : colourMatch.length > 0 ? `COLOUR MATCH CODES still needed for ${colourMatch.join(", ")} — enter the code on the job sheet's colours (or answer the pre-start colours question yes), then press again`
        : signoff?.signed_at ? "sign-off row already signed — the close refuses (already_signed); tell whoever looks after the platform"
        : "nothing in the way of the finish — press All done — next step (a quality check may be due next)";
      console.log("VERDICT:", verdict);
    }
  }
}
