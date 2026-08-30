/**
 * Trade portal v2 · Session 3 — seed the demo orgs for Tom's mockup-parity
 * walk on the TEST project. Idempotent: each run destroys and recreates the
 * demo orgs by email.
 *
 *   node scripts/portal/seed-trade-demo.mjs
 *
 * TEST STACK ONLY: reads .env.test.local via scripts/c1/env.mjs and refuses
 * anything that resolves to production (the F1-03 rule).
 *
 * Creates (password painttest123 for every login):
 *   pg.demo.agency@example.com      — Harbourside Property Management
 *     (real_estate): 5 properties in the mockup's five states
 *   pg.demo.facilities@example.com  — Bayside Aged Care — Facilities
 *     (facilities): 2 sites, Site/PO references
 *   pg.demo.insurer@example.com     — Southern Cross Claims (insurance):
 *     2 properties, Claim/Assessor references
 *   pg.demo.volume@example.com      — Volume Portfolio Org: 40 properties
 *     with references + colour records (the <1.5 s render acceptance).
 */
import { createClient } from "@supabase/supabase-js";
import { loadTestEnv, refuseProduction } from "../c1/env.mjs";

loadTestEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing test-stack env — see .env.test.local"); process.exit(1); }
refuseProduction(url);
console.log(`Seeding trade demo on ${url.match(/https:\/\/([a-z0-9]+)\./)?.[1]}`);

const db = createClient(url, key, { auth: { persistSession: false } });
const PASSWORD = "painttest123";
const today = new Date();
const day = (offset) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
};

async function must(pending, what) {
  const res = await pending;
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function destroyOrg(email) {
  const { data: acct } = await db.from("accounts").select("id").eq("email", email).maybeSingle();
  if (acct) {
    const { data: props } = await db.from("properties").select("id").eq("account_id", acct.id);
    const propIds = (props ?? []).map((p) => p.id);
    if (propIds.length) {
      await db.from("colour_records").delete().in("property_id", propIds);
      await db.from("property_references").delete().in("property_id", propIds);
    }
    const { data: ests } = await db.from("estimates").select("id").eq("account_id", acct.id);
    const estIds = (ests ?? []).map((e) => e.id);
    if (estIds.length) {
      const { data: wos } = await db.from("work_orders").select("id").in("estimate_id", estIds);
      for (const w of wos ?? []) {
        await db.from("wo_surfaces").delete().eq("work_order_id", w.id);
        await db.from("wo_checklist_items").delete().eq("work_order_id", w.id);
        await db.from("wo_events").delete().eq("work_order_id", w.id);
        await db.from("wo_signoff").delete().eq("work_order_id", w.id);
        await db.from("warranties").delete().eq("work_order_id", w.id);
        await db.from("work_orders").delete().eq("id", w.id);
      }
      const { data: invs } = await db.from("invoices").select("id").in("estimate_id", estIds);
      for (const i of invs ?? []) {
        await db.from("payments").delete().eq("invoice_id", i.id);
        await db.from("invoices").delete().eq("id", i.id);
      }
      for (const e of estIds) await db.from("estimates").delete().eq("id", e);
    }
    await db.from("account_users").delete().eq("account_id", acct.id);
    if (propIds.length) await db.from("properties").delete().in("id", propIds);
    await db.from("accounts").delete().eq("id", acct.id);
  }
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const u = users?.users?.find((x) => x.email === email);
  if (u) await db.auth.admin.deleteUser(u.id);
}

async function makeOrg({ email, name, orgKind }) {
  await destroyOrg(email);
  const user = await must(await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true }), "user");
  const acct = await must(
    db.from("accounts").insert({ email, name, account_type: "trade", org_kind: orgKind }).select("id").single(),
    "account",
  );
  await must(db.from("account_users").insert({ account_id: acct.id, profile_id: user.user.id, role: "admin" }), "membership");
  return acct.id;
}

async function makeProperty(accountId, address, suburb, postcode, refs) {
  const p = await must(
    db.from("properties").insert({
      account_id: accountId, address, suburb, postcode,
      address_norm: `${address} ${suburb} ${postcode}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    }).select("id").single(),
    "property",
  );
  if (refs.length) {
    await must(db.from("property_references").insert(
      refs.map(([label, value], i) => ({ property_id: p.id, label, value, sort: i })),
    ), "references");
  }
  return p.id;
}

async function makeColours(propertyId, rows) {
  await must(db.from("colour_records").insert(rows.map((r) => ({
    property_id: propertyId, area_label: r.area, surface_type: r.type,
    brand: "Dulux", product: r.product ?? "Wash & Wear Low Sheen",
    colour_name: r.name, colour_code: r.code ?? "", sheen: r.sheen ?? "low sheen",
    coats: 2, swatch_hex: r.hex, status: r.status ?? "applied",
    applied_from: r.on ?? null, applied_to: r.on ?? null,
    source: "historical_import", colour_attribution_lossy: Boolean(r.lossy),
  }))), "colour_records");
}

async function makeJob(accountId, propertyId, title, { status = "accepted", woStage = null, start = null, end = null, surfaces = null, sent = null } = {}) {
  const est = await must(db.from("estimates").insert({
    title, status, source: "manual", level_of_finish: 3,
    account_id: accountId, property_id: propertyId,
    total_cents: 693000, share_token: status === "sent" ? `demo${Math.random().toString(36).slice(2, 14)}` : null,
    sent_at: sent, builder_state: {},
  }).select("id").single(), "estimate");
  let woId = null;
  if (woStage) {
    const wo = await must(db.from("work_orders").insert({
      estimate_id: est.id, wo_ref: `PG-${3100 + Math.floor(Math.random() * 99)}`,
      share_token: `demo${Math.random().toString(36).slice(2, 16)}`,
      stage: woStage, status: woStage === "closed" ? "complete" : woStage === "in_progress" ? "in_progress" : "issued",
      issued_at: new Date().toISOString(), start_date: start, end_date: end,
      wo_snapshot: { jobTitle: title, areas: [], materials: [] }, colours: {},
    }).select("id").single(), "work order");
    woId = wo.id;
    if (surfaces) {
      await must(db.from("wo_surfaces").insert(
        Array.from({ length: surfaces.total }, (_, i) => ({
          work_order_id: wo.id, heading: `Room ${1 + (i % 6)}`, heading_meta: "",
          label: i % 2 ? "Walls" : "Ceiling", surface_key: `s${i}`, sort: i,
          state: i < surfaces.done ? "done" : "todo",
          state_changed_at: i < surfaces.done ? new Date().toISOString() : null,
        })),
      ), "surfaces");
    }
  }
  return { estimateId: est.id, woId };
}

// ---- the agency (the mockup walk) -------------------------------------------
const agency = await makeOrg({ email: "pg.demo.agency@example.com", name: "Harbourside Property Management", orgKind: "real_estate" });

const beaumont = await makeProperty(agency, "14 Beaumont St", "Elwood", "3184", [["Owner", "T. & M. Nguyen"]]);
await makeJob(agency, beaumont, "Interior repaint between tenancies", { status: "sent", sent: new Date().toISOString() });
await makeColours(beaumont, [
  { area: "Walls — all rooms", type: "wall", name: "Natural White", hex: "#e9e4d8", on: day(-380), lossy: true },
  { area: "Ceilings", type: "ceiling", name: "Ceiling White", hex: "#f4f2ec", on: day(-380), lossy: true },
  { area: "Front door", type: "door", name: "Domino", hex: "#3b3f44", on: day(-380), lossy: true },
]);

const ormond = await makeProperty(agency, "Unit 7/22 Ormond Rd", "Elwood", "3184", [["Owner", "Elwood Holdings Pty Ltd"], ["Your ref", "EH-0448"]]);
await makeJob(agency, ormond, "Full interior", { woStage: "in_progress", start: day(-1), end: day(2), surfaces: { done: 11, total: 24 } });
await makeColours(ormond, [
  { area: "Walls — all rooms", type: "wall", name: "Natural White", hex: "#f1ede4", code: "SW1 P4", on: day(-1) },
  { area: "Ceilings", type: "ceiling", name: "Ceiling White", hex: "#ffffff", code: "SW1 P8", product: "Ceiling White", sheen: "flat", on: day(-1) },
  { area: "Trims, skirting & architraves", type: "trim", name: "Natural White", hex: "#f1ede4", product: "Aquanamel Semi Gloss", sheen: "semi gloss", status: "planned" },
  { area: "Front door (exterior face)", type: "door", name: "Domino", hex: "#2a2e33", code: "SN4 G8", product: "Weathershield", sheen: "gloss", status: "planned" },
]);

const tennyson = await makeProperty(agency, "3 Tennyson St", "Elwood", "3184", [["Owner", "R. Castellano"]]);
await makeJob(agency, tennyson, "Exterior weatherboard", { woStage: "walkthrough" });
await makeColours(tennyson, [
  { area: "Weatherboards", type: "wall", name: "Grey Pail", hex: "#d9d2c1", on: day(-2) },
  { area: "Fascia & bargeboards", type: "fascia", name: "Vivid White", hex: "#f7f5f0", on: day(-2) },
  { area: "Front door", type: "door", name: "Colorbond Monument", hex: "#5a6066", on: day(-2) },
]);

const mitford = await makeProperty(agency, "9 Mitford St", "St Kilda", "3182", [["Owner", "K. Adebayo"]]);
const mitfordJob = await makeJob(agency, mitford, "Full exterior", { woStage: "closed" });
await must(db.from("invoices").insert({
  estimate_id: mitfordJob.estimateId, kind: "final", status: "issued", number: "PG-3172",
  token: `demoinv${Math.random().toString(36).slice(2, 20)}`,
  issued_on: day(-16), due_on: day(-9), subtotal_ex_cents: 210000, gst_cents: 21000, total_inc_cents: 231000,
}), "overdue invoice");
await makeColours(mitford, [
  { area: "Walls", type: "wall", name: "Natural White", hex: "#ede8dc", on: day(-19) },
  { area: "Trims", type: "trim", name: "Vivid White", hex: "#f9f8f4", on: day(-19) },
]);

const broadway = await makeProperty(agency, "28 Broadway", "Elwood", "3184", []);
await makeColours(broadway, [
  { area: "Walls — all rooms", type: "wall", name: "Hog Bristle Quarter", hex: "#e6e1d5", on: day(-280), lossy: true },
  { area: "Trims", type: "trim", name: "Vivid White", hex: "#f2efe8", on: day(-280), lossy: true },
]);

// ---- facilities + insurer (the persona label proof) -------------------------
const facilities = await makeOrg({ email: "pg.demo.facilities@example.com", name: "Bayside Aged Care — Facilities", orgKind: "facilities" });
const blockB = await makeProperty(facilities, "Elwood Village, Block B", "Elwood", "3184", [["Site", "Elwood Village, Block B"], ["PO", "BAC-2026-0712"]]);
await makeJob(facilities, blockB, "Corridor repaint — Block B", { woStage: "in_progress", start: day(-1), end: day(3), surfaces: { done: 5, total: 18 } });
await makeColours(blockB, [{ area: "Corridor walls", type: "wall", name: "Whisper White", hex: "#f2f0ea", on: day(-1) }]);
await makeProperty(facilities, "Elwood Village, Block C", "Elwood", "3184", [["Site", "Elwood Village, Block C"], ["PO", "BAC-2026-0731"]]);

const insurer = await makeOrg({ email: "pg.demo.insurer@example.com", name: "Southern Cross Claims", orgKind: "insurance" });
const claim1 = await makeProperty(insurer, "41 Foam St", "Elwood", "3184", [["Claim", "SC-44810-M"], ["Assessor", "P. Ryan"]]);
await makeJob(insurer, claim1, "Water damage — ceiling & walls", { woStage: "pre_start", start: day(4) });
await makeProperty(insurer, "8 Docker St", "Richmond", "3121", [["Claim", "SC-44502-M"], ["Assessor", "P. Ryan"]]);

// ---- the 40-property volume org (render-time acceptance) --------------------
const volume = await makeOrg({ email: "pg.demo.volume@example.com", name: "Volume Portfolio Org", orgKind: "real_estate" });
for (let i = 0; i < 40; i++) {
  const pid = await makeProperty(volume, `${100 + i} Portfolio Rd`, "Preston", "3072", [["Owner", `Owner ${i + 1}`], ["Your ref", `VP-${1000 + i}`]]);
  await makeColours(pid, [
    { area: "Walls — all rooms", type: "wall", name: "Natural White", hex: "#f1ede4", on: day(-60 - i) },
    { area: "Ceilings", type: "ceiling", name: "Ceiling White", hex: "#ffffff", on: day(-60 - i) },
    { area: "Trims", type: "trim", name: "Vivid White", hex: "#f9f8f4", on: day(-60 - i) },
  ]);
  if (i < 6) {
    await makeJob(volume, pid, `Repaint ${100 + i} Portfolio Rd`, {
      woStage: "in_progress", start: day(-2), end: day(3), surfaces: { done: 6 + i, total: 24 },
    });
  } else if (i < 10) {
    await makeJob(volume, pid, `Repaint ${100 + i} Portfolio Rd`, { status: "sent", sent: new Date().toISOString() });
  } else {
    await makeJob(volume, pid, `Repaint ${100 + i} Portfolio Rd`, { woStage: "closed" });
  }
}

console.log("\nSeeded:");
console.log("  pg.demo.agency@example.com      / painttest123  (Harbourside — the mockup walk)");
console.log("  pg.demo.facilities@example.com  / painttest123  (Site/PO labels)");
console.log("  pg.demo.insurer@example.com     / painttest123  (Claim/Assessor labels)");
console.log("  pg.demo.volume@example.com      / painttest123  (40 properties — perf)");
