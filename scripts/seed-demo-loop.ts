/**
 * Two demo jobs for walking the completion loop by hand.
 *
 * Job A sits IN PROGRESS so the contractor side can be walked: a tick list with
 * one elevation photographed (tickable now) and one not (so the before-photo
 * gate shows itself), plus a variation waiting on a price for the console.
 *
 * Job B sits at WALKTHROUGH with its evidence pack delivered, so the customer
 * link is live and can be approved, flagged and signed.
 *
 * These are REAL rows in the live project. Both are prefixed WO-DEMO and
 * `npx tsx scripts/seed-demo-loop.ts --destroy` removes them and everything
 * that cascades from them.
 *
 *   npx tsx scripts/seed-demo-loop.ts
 *   npx tsx scripts/seed-demo-loop.ts --destroy
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadEnv() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
  }
}

const token = () =>
  Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join("");

async function idFor(db: SupabaseClient, email: string, table: "contractors" | "customers") {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (!data?.users?.length) return null;
    const user = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (user) {
      const { data: row } = await db.from(table).select("id").eq("profile_id", user.id).maybeSingle();
      return (row as { id: string } | null)?.id ?? null;
    }
    if (data.users.length < 200) return null;
  }
  return null;
}

async function destroy(db: SupabaseClient) {
  const { data } = await db.from("work_orders").select("estimate_id").like("wo_ref", "WO-DEMO%");
  const ids = ((data ?? []) as { estimate_id: string }[]).map((r) => r.estimate_id);
  if (ids.length === 0) { console.log("nothing to remove"); return; }
  await db.from("estimates").delete().in("id", ids);
  console.log(`removed ${ids.length} demo job${ids.length === 1 ? "" : "s"} (everything cascades from the estimate)`);
}

type Area = { heading: string; meta: string; labels: string[] };

async function makeJob(
  db: SupabaseClient, ref: string, title: string, address: string,
  contractorId: string, customerId: string | null, areas: Area[], contractCents: number,
) {
  const { data: est, error: e1 } = await db.from("estimates")
    .insert({ status: "accepted", source: "manual", level_of_finish: 3,
              customer_id: customerId, total_cents: contractCents, accepted_name: "Melissa Hartley" })
    .select("id").single();
  if (e1) throw new Error(`estimate: ${e1.message}`);
  const estimateId = (est as { id: string }).id;

  const { data: wo, error: e2 } = await db.from("work_orders").insert({
    estimate_id: estimateId, wo_ref: ref, share_token: token(),
    contractor_id: contractorId, stage: "in_progress", status: "in_progress",
    issued_at: new Date().toISOString(),
    start_date: new Date().toISOString().slice(0, 10),
    contractor_payment_cents: Math.round(contractCents * 0.43),
    wo_snapshot: {
      version: 1, woRef: ref, status: "in_progress", jobTitle: title, jobAddress: address,
      contactFirstName: "Melissa", contactPhone: "", startDate: null, accessNotes: "",
      crewNotes: "", levelOfFinish: "Level 3 — Good", finishCode: "PG-3",
      contractorName: "", contractorPaymentCents: 0, materials: [],
      areas: areas.map((a, i) => ({
        id: `a${i}`, title: a.heading, finishCode: "PG-3", finishOverridden: false, photos: [],
        surfaces: a.labels.map((label, j) => ({
          key: `a${i}:${j}`, label, coats: 2, product: "Weathershield", prep: "", hours: 2,
          status: "not_started",
        })),
      })),
      exclusions: [], company: { name: "Paint Group", phone: "", logoUrl: "" },
    },
  }).select("id").single();
  if (e2) throw new Error(`work order: ${e2.message}`);
  const workOrderId = (wo as { id: string }).id;

  const rows = areas.flatMap((a, i) =>
    a.labels.map((label, j) => ({
      work_order_id: workOrderId, heading: a.heading, heading_meta: a.meta,
      label, surface_key: `a${i}:${j}`, sort: i * 100 + j,
    })));
  const { error: e3 } = await db.from("wo_surfaces").insert(rows);
  if (e3) throw new Error(`surfaces: ${e3.message}`);

  return { estimateId, workOrderId };
}

async function main() {
  loadEnv();
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } });

  if (process.argv.includes("--destroy")) { await destroy(db); return; }
  await destroy(db);   // never stack demos on top of each other

  const contractorId = await idFor(db, "pg.josef.contractor@gmail.com", "contractors");
  const customerId = await idFor(db, "pg.melissa.customer@gmail.com", "customers");
  if (!contractorId) throw new Error("no contractors row for pg.josef.contractor@gmail.com");

  // ---- Job A: live on site -------------------------------------------------
  const a = await makeJob(db, "WO-DEMO1", "DEMO — 14 Bellair St, Kensington",
    "14 Bellair St, Kensington VIC 3031", contractorId, customerId, [
      { heading: "Front", meta: "12 × 2.6 m · wb 75 / render 25", labels: ["Walls — weatherboard + render", "Windows × 3 · entry door", "Fascias & gutters"] },
      { heading: "Left", meta: "9 × 2.6 m · weatherboard", labels: ["Eaves — 9 m", "Walls — weatherboard", "Windows × 2"] },
    ], 1_842_000);

  // Front has its before photo (tickable now); Left does not, so the gate shows.
  await db.from("wo_photos").insert({
    work_order_id: a.workOrderId, kind: "before", area: "Front",
    storage_path: `wo/${a.workOrderId}/demo-front-before.jpg`,
  });

  // A variation waiting on a price, so the console has something to do.
  const { data: vphoto } = await db.from("wo_photos").insert({
    work_order_id: a.workOrderId, kind: "variation",
    storage_path: `wo/${a.workOrderId}/demo-rot.jpg`,
  }).select("id").single();
  const { data: variation } = await db.from("wo_variations").insert({
    work_order_id: a.workOrderId, category: "rot",
    comment: "Three lower boards on the left side are gone at the bottom edge — soft right through. Needs cutting out before I can prep that wall.",
    est_hours: 3, status: "raised", raised_kind: "contractor",
  }).select("id").single();
  await db.from("wo_photos").update({ variation_id: (variation as { id: string }).id })
    .eq("id", (vphoto as { id: string }).id);

  // ---- Job B: waiting on the customer -------------------------------------
  const b = await makeJob(db, "WO-DEMO2", "DEMO — 7 The Boulevard, Ivanhoe",
    "7 The Boulevard, Ivanhoe VIC 3079", contractorId, customerId, [
      { heading: "Front", meta: "10 × 2.4 m · render", labels: ["Walls — render", "Windows × 2"] },
      { heading: "Back", meta: "10 × 2.4 m · render", labels: ["Walls — render", "Back door"] },
    ], 734_000);

  await db.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", b.workOrderId);
  await db.from("work_orders").update({ stage: "completion_prep" }).eq("id", b.workOrderId);
  await db.from("wo_signoff").insert({
    work_order_id: b.workOrderId,
    evidence_pack_sent_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    customer_token: token(),
  });
  await db.from("work_orders").update({ stage: "walkthrough" }).eq("id", b.workOrderId);

  const { data: signoff } = await db.from("wo_signoff")
    .select("customer_token").eq("work_order_id", b.workOrderId).single();

  console.log("\n=== demo jobs seeded ===");
  console.log(`Job A (on site)     WO-DEMO1  /portal/jobs/${a.workOrderId}`);
  console.log(`Job A console       /pc/wo/${a.workOrderId}`);
  console.log(`Job B (walkthrough) WO-DEMO2  /s/${(signoff as { customer_token: string }).customer_token}`);
  console.log("\nRemove with: npx tsx scripts/seed-demo-loop.ts --destroy");
}

main().catch((e) => { console.error(e); process.exit(1); });
