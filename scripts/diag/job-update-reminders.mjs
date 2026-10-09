// READ ONLY (7 Oct): have the painter's "update your work order" texts been going out?
//   node scripts/diag/job-update-reminders.mjs [days back, default 30]
// Lists every booked job whose days touch the window, its reminder MOMENTS
// (wo_reminder_moments, Step 4: due, texts sent, answered, skipped) and the
// texts actually recorded in `messages` (meta.automation =
// contractor_job_update_reminder), plus whether the automation is switched off
// in Settings.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const KEY = "contractor_job_update_reminder";
const back = Number(process.argv[2] ?? 30);
const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
const mel = (d) => { const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
const today = mel(new Date());
const since = mel(new Date(Date.now() - back * 86_400_000));
console.log(`project ${env.NEXT_PUBLIC_SUPABASE_URL} · Melbourne today ${today} · window from ${since}`);

const { data: st, error: stErr } = await db.from("settings").select("key, value").eq("key", "messaging").maybeSingle();
if (stErr) console.log("settings read failed:", stErr.message);
const disabled = st?.value?.disabled;
console.log(`automation ${KEY}: ${Array.isArray(disabled) && disabled.includes(KEY) ? "SWITCHED OFF" : "on"}  (disabled list: ${JSON.stringify(disabled ?? null)})`);
console.log(`template: ${st?.value?.contractorJobUpdateSms ?? "(default)"}`);

const { data: jobs, error: jErr } = await db.from("work_orders")
  .select("id, wo_ref, stage, start_date, end_date, contractor_id, stage_entered_at, estimates(number, title), contractors(company_name, works_saturday, works_sunday, profiles(name))")
  .not("start_date", "is", null).not("end_date", "is", null).lte("start_date", today).gte("end_date", since)
  .order("start_date", { ascending: true }).limit(200);
if (jErr) { console.log("work_orders read failed:", jErr.message); process.exit(1); }
console.log(`\n${jobs.length} booked job(s) with days in the window\n`);
const ids = jobs.map((j) => j.id);
const { data: moments, error: cErr } = await db.from("wo_reminder_moments").select("work_order_id, kind, day, due_at, sends_count, answered_at, skipped_reason").in("work_order_id", ids).order("due_at");
if (cErr) console.log("moments read failed:", cErr.message);
const { data: msgs, error: mErr } = await db.from("messages").select("work_order_id, to_address, status, occurred_at, body, meta").eq("direction", "out").eq("channel", "sms").filter("meta->>automation", "eq", KEY).gte("occurred_at", `${since}T00:00:00Z`).order("occurred_at", { ascending: true }).limit(1000);
if (mErr) console.log("messages read failed:", mErr.message);
const { data: asg } = await db.from("wo_assignments").select("work_order_id, contractor_id, status").in("work_order_id", ids);

for (const j of jobs) {
  const crew = (asg ?? []).filter((a) => a.work_order_id === j.id && a.status !== "released").length;
  console.log(`#${j.estimates?.number ?? "?"} ${j.estimates?.title ?? "?"} | ${j.wo_ref} | ${j.stage} | ${j.start_date} → ${j.end_date} | ${j.contractors?.company_name ?? "(no contractor)"} / ${j.contractors?.profiles?.name ?? "?"} | crew=${crew}`);
  const cl = (moments ?? []).filter((c) => c.work_order_id === j.id);
  const ms = (msgs ?? []).filter((m) => m.work_order_id === j.id);
  console.log(`   moments: ${cl.length ? cl.map((c) => `${c.kind}@${c.day} ×${c.sends_count}${c.answered_at ? " ✓answered" : ""}${c.skipped_reason ? ` skipped:${c.skipped_reason}` : ""}`).join(", ") : "NONE (not planned yet)"}`);
  console.log(`   texts : ${ms.length ? ms.map((m) => `${m.occurred_at.slice(0, 16)} ${m.status} → ${(m.to_address ?? "?").replace(/(\d{4})\d+(\d{3})/, "$1…$2")}`).join(", ") : "NONE"}`);
}
const orphan = (msgs ?? []).filter((m) => !ids.includes(m.work_order_id));
if (orphan.length) console.log(`\n${orphan.length} text(s) on jobs outside the window`);
console.log(`\ntotals: ${moments?.length ?? 0} moments, ${msgs?.length ?? 0} texts recorded for this automation in the window`);
