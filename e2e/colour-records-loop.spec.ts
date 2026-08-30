import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { TINY_SIGNATURE_PNG } from "./helpers";

/**
 * Trade portal v2 · Session 2B — the colour_records write path, driven AS
 * STAFF through the real PC screen (brief §7 row 2 + rulings 2/3, 30 Aug):
 *
 *  · estimate/WO creation writes NO colour_records (preferences never write);
 *  · answering the pre-start colours question YES → planned rows whose
 *    colour is the JOB SHEET's (work_orders.colours), not the snapshot's;
 *  · a surface DONE tick → the group flips to applied with dates from
 *    wo_surfaces.state_changed_at, re-reading the sheet at that moment and
 *    logging a colour change to wo_events;
 *  · a second job at the same property supersedes the group's old applied
 *    row — nothing deleted.
 */

const db: SupabaseClient | null = serviceClient();
const staff = {
  email: process.env.E2E_STAFF_EMAIL ?? "",
  password: process.env.E2E_STAFF_PASSWORD ?? "",
};

const PRODUCT = "C1 Wall Paint";
const key = (colour: string) => `${PRODUCT}||${colour}`;

/** A post-split contractor-safe snapshot: one WALL surface per area. */
function snapshot(areas: Array<{ title: string; colour: string; hex: string }>) {
  return {
    version: 1, woRef: "WO-CRL", status: "issued",
    jobTitle: "Colour records loop e2e", jobAddress: "22 Ormond Rd, Elwood",
    contactFirstName: "Test", contactPhone: "", startDate: null,
    accessNotes: "", crewNotes: "", levelOfFinish: "Level 3", finishCode: "PG-3",
    contractorName: "", contractorPaymentCents: 0,
    materials: areas.map((a) => ({
      product: PRODUCT, colourKey: key(a.colour), photoUrl: "", litres: 4, coverageMissing: false,
      colourName: a.colour, colourHex: a.hex, colourStatus: "tbc",
    })),
    areas: areas.map((a, i) => ({
      id: `a${i}`, title: a.title, finishCode: "PG-3", finishOverridden: false, photos: [],
      surfaces: [{
        key: `a${i}:0`, label: "Walls", coats: 2, product: PRODUCT,
        colourName: a.colour, colourHex: a.hex, colourKey: key(a.colour),
        prep: "", hours: 1, status: "not_started",
      }],
    })),
    exclusions: [], company: { name: "Paint Group", phone: "", logoUrl: "" },
  };
}

test.describe("colour records write path (trade portal v2, session 2B)", () => {
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  const run = randomBytes(4).toString("hex");
  let accountId = "";
  let propertyId = "";
  const estimates: string[] = [];
  const workOrders: string[] = [];
  const photoPaths: string[] = [];
  let migrationReady = true;

  async function makeJob(areas: Array<{ title: string; colour: string; hex: string }>, colours: Record<string, unknown>) {
    const sb = db!;
    const est = await sb.from("estimates").insert({
      title: `Colour loop ${run}`, status: "accepted", source: "manual", level_of_finish: 3,
      account_id: accountId, property_id: propertyId, builder_state: {},
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimates.push(est.data.id);

    const wo = await sb.from("work_orders").insert({
      estimate_id: est.data.id, wo_ref: `WO-CRL${run.slice(0, 4)}${workOrders.length}`,
      share_token: `crl${workOrders.length}${run}${Date.now()}`,
      stage: "pre_start", status: "issued", issued_at: new Date().toISOString(),
      wo_snapshot: snapshot(areas), colours,
    }).select("id").single();
    if (wo.error) throw new Error(wo.error.message);
    workOrders.push(wo.data.id);

    const seeded = await sb.rpc("wo_seed_checklists", { p_work_order_id: wo.data.id });
    if (seeded.error) throw new Error(seeded.error.message);

    const surfaces = await sb.from("wo_surfaces").insert(areas.map((a, i) => ({
      work_order_id: wo.data.id, heading: a.title, heading_meta: "1 surface · 2 coats",
      label: "Walls", surface_key: `a${i}:0`, sort: i,
    }))).select("id, heading");
    if (surfaces.error) throw new Error(surfaces.error.message);

    const item = await sb.from("wo_checklist_items").select("id")
      .eq("work_order_id", wo.data.id).eq("item_key", "colours").single();
    if (item.error) throw new Error(item.error.message);

    return {
      workOrderId: wo.data.id as string,
      coloursItemId: item.data.id as string,
      surfaceIds: Object.fromEntries((surfaces.data as Array<{ id: string; heading: string }>).map((r) => [r.heading, r.id])),
    };
  }

  /** Stage → in_progress with the before-photo gate satisfied per heading. */
  async function openForTicking(workOrderId: string, headings: string[]) {
    const sb = db!;
    const png = Buffer.from(TINY_SIGNATURE_PNG.split(",")[1], "base64");
    for (const heading of headings) {
      const path = `e2e-crl/${run}/${workOrderId}/${heading.replace(/\W+/g, "-")}.png`;
      const up = await sb.storage.from("wo-photos").upload(path, png, { contentType: "image/png" });
      if (up.error) throw new Error(up.error.message);
      photoPaths.push(path);
      const row = await sb.from("wo_photos").insert({
        work_order_id: workOrderId, kind: "before", area: heading, storage_path: path,
      });
      if (row.error) throw new Error(row.error.message);
    }
    const upd = await sb.from("work_orders").update({ stage: "in_progress", status: "in_progress" }).eq("id", workOrderId);
    if (upd.error) throw new Error(upd.error.message);
  }

  test.beforeAll(async () => {
    const sb = db!;
    const probe = await sb.from("colour_records").select("id").limit(1);
    if (probe.error) { migrationReady = false; return; }

    const acct = await sb.from("accounts").insert({
      email: `pg.e2e.crl.${run}@example.com`, name: "Colour loop org", account_type: "trade",
    }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id;

    const prop = await sb.from("properties").insert({
      account_id: accountId, address: "22 Ormond Rd", suburb: "Elwood", postcode: "3184",
      address_norm: `22 ormond rd elwood 3184 ${run}`,
    }).select("id").single();
    if (prop.error) throw new Error(prop.error.message);
    propertyId = prop.data.id;
  });

  test.afterAll(async () => {
    const sb = db!;
    if (propertyId) await sb.from("colour_records").delete().eq("property_id", propertyId);
    for (const wo of workOrders) {
      await sb.from("wo_photos").delete().eq("work_order_id", wo);
      await sb.from("wo_surfaces").delete().eq("work_order_id", wo);
      await sb.from("wo_checklist_items").delete().eq("work_order_id", wo);
      await sb.from("wo_events").delete().eq("work_order_id", wo);
      await sb.from("work_orders").delete().eq("id", wo);
    }
    if (photoPaths.length) await sb.storage.from("wo-photos").remove(photoPaths);
    for (const e of estimates) await sb.from("estimates").delete().eq("id", e);
    if (propertyId) await sb.from("properties").delete().eq("id", propertyId);
    if (accountId) await sb.from("accounts").delete().eq("id", accountId);
  });

  test("planned → applied → superseded, through the real PC screen", async ({ page }) => {
    test.skip(!migrationReady, "run migrations 20261213/20261214 first");
    test.setTimeout(240_000);
    const sb = db!;

    // Job 1: snapshot says Study = Domino, but the JOB SHEET renamed it
    // Monument before the schedule was finalised — the sheet must win.
    const job1 = await makeJob(
      [
        { title: "Living room", colour: "Natural White", hex: "#F1EDE4" },
        { title: "Study", colour: "Domino", hex: "#2A2E33" },
      ],
      { [key("Domino")]: { name: "Monument", hex: "#3B3F44", status: "confirmed" } },
    );

    // Estimate preferences never write: nothing exists before the YES.
    const before = await sb.from("colour_records").select("id").eq("property_id", propertyId);
    expect(before.data).toEqual([]);

    await page.goto("/login");
    await page.fill('input[type="email"]', staff.email);
    await page.fill('input[type="password"]', staff.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/estimates/);

    // 1 · Answer the colours question YES on the real pre-start checklist.
    await page.goto(`/pc/wo/${job1.workOrderId}`);
    await page.getByTestId(`chk-yes-${job1.coloursItemId}`).click();

    let planned: Array<{ area_label: string; colour_name: string; status: string; sheen: string; coats: number }> = [];
    await expect.poll(async () => {
      const { data } = await sb.from("colour_records")
        .select("area_label, colour_name, status, sheen, coats")
        .eq("property_id", propertyId).order("area_label");
      planned = (data ?? []) as typeof planned;
      return planned.length;
    }, { timeout: 20_000 }).toBe(2);
    expect(planned.every((r) => r.status === "planned")).toBe(true);
    expect(planned.find((r) => r.area_label === "Living room")?.colour_name).toBe("Natural White");
    // The job sheet's rename won over the snapshot's Domino.
    expect(planned.find((r) => r.area_label === "Study")?.colour_name).toBe("Monument");
    expect(planned.every((r) => r.coats === 2)).toBe(true);

    // 2 · Living room walls DONE (two taps: todo → prepped → done).
    await openForTicking(job1.workOrderId, ["Living room", "Study"]);
    await page.reload();
    const livingTick = page.getByTestId(`tick-${job1.surfaceIds["Living room"]}`);
    await livingTick.click();
    await expect(livingTick.getByText("Prepped")).toBeVisible();
    await livingTick.click();
    await expect(livingTick.getByText(/Done/i)).toBeVisible();

    await expect.poll(async () => {
      const { data } = await sb.from("colour_records")
        .select("status, applied_from")
        .eq("property_id", propertyId).eq("area_label", "Living room").single();
      return (data as { status: string } | null)?.status ?? "missing";
    }, { timeout: 20_000 }).toBe("applied");
    const living = await sb.from("colour_records")
      .select("applied_from, applied_to, source")
      .eq("property_id", propertyId).eq("area_label", "Living room").single();
    expect(living.data?.applied_from).toBeTruthy(); // stamped from the tick, Melbourne day
    expect(living.data?.applied_from).toBe(living.data?.applied_to);
    expect(living.data?.source).toBe("colour_schedule");

    // 3 · The sheet changes the study's colour AFTER planning; the DONE tick
    // re-reads it (ruling 2) and the change lands on wo_events.
    const patch = await sb.from("work_orders")
      .update({ colours: { [key("Domino")]: { name: "Klavier", hex: "#A9A290", status: "confirmed" } } })
      .eq("id", job1.workOrderId);
    if (patch.error) throw new Error(patch.error.message);

    const studyTick = page.getByTestId(`tick-${job1.surfaceIds["Study"]}`);
    await studyTick.click();
    await studyTick.click();
    await expect.poll(async () => {
      const { data } = await sb.from("colour_records")
        .select("colour_name, status").eq("property_id", propertyId).eq("area_label", "Study").single();
      const r = data as { colour_name: string; status: string } | null;
      return r ? `${r.status}:${r.colour_name}` : "missing";
    }, { timeout: 20_000 }).toBe("applied:Klavier");
    const ev = await sb.from("wo_events").select("meta")
      .eq("work_order_id", job1.workOrderId).eq("type", "colour_record_update");
    expect(ev.data).toHaveLength(1);
    expect((ev.data![0] as { meta: { from: string; to: string } }).meta).toMatchObject({ from: "Monument", to: "Klavier" });

    // 4 · Job 2 repaints the living room Grey Pail → new row, old superseded.
    const job2 = await makeJob(
      [{ title: "Living room", colour: "Grey Pail", hex: "#C9CCD0" }],
      {},
    );
    await page.goto(`/pc/wo/${job2.workOrderId}`);
    await page.getByTestId(`chk-yes-${job2.coloursItemId}`).click();
    await expect.poll(async () => {
      const { data } = await sb.from("colour_records").select("id").eq("source_job_id", job2.workOrderId);
      return (data ?? []).length;
    }, { timeout: 20_000 }).toBe(1);

    await openForTicking(job2.workOrderId, ["Living room"]);
    await page.reload();
    const tick2 = page.getByTestId(`tick-${job2.surfaceIds["Living room"]}`);
    await tick2.click();
    await tick2.click();

    await expect.poll(async () => {
      const { data } = await sb.from("colour_records")
        .select("colour_name, status, superseded_by, source_job_id")
        .eq("property_id", propertyId).eq("area_label", "Living room").order("created_at");
      const rows = (data ?? []) as Array<{ colour_name: string; status: string; superseded_by: string | null }>;
      return rows.map((r) => `${r.colour_name}:${r.status}`).join(" | ");
    }, { timeout: 20_000 }).toBe("Natural White:superseded | Grey Pail:applied");

    // Nothing deleted: the property's full history is 2 living-room rows + study.
    const all = await sb.from("colour_records").select("id").eq("property_id", propertyId);
    expect((all.data ?? []).length).toBe(3);
    const old = await sb.from("colour_records").select("superseded_by")
      .eq("property_id", propertyId).eq("status", "superseded").single();
    expect(old.data?.superseded_by).toBeTruthy();
  });
});
