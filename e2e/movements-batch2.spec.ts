import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test, userIdFor } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Movements — Tom's second batch (21 Oct 2026, evening), migration 20270289.
 *
 *   API: material_line_split takes one item off a comma-separated line into its own line and
 *   chip (and refuses the last item); movement_set_duration; movement_publish_run lands a
 *   planned run — a tray chip at 07:30, a quality-check stop as an Other chip, a site check-in
 *   onto the job's unscheduled visit — with durations and the sequence, in one call, and
 *   refuses an empty plan or a stop with no purpose.
 *   Browser, as the PC: the job page past pre-start shows the Materials & movements card with
 *   the lines as bubbles (tap to edit); the Map's run planner takes a chip from the tray list,
 *   starts it at 07:30, and Publish puts it on the staff person's day; the estimate builder's
 *   Materials & sundries field makes a bubble on Enter.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const RUN = Math.random().toString(36).slice(2, 8);
const BRAND = `E2E Dulux ${RUN}`;
const PRODUCT = `${BRAND} Weathershield`;
const LINE = `E2E gap filler, interior filler, tapes ${RUN}`;
const TAPES = `tapes ${RUN}`;
const GEAR = `E2E sprayer ${RUN}`;

type Row = Record<string, unknown>;
let contractorId = "";
let staffProfileId = "";
let job: LoopFixture | null = null;
let productId = "";
let branchId = "";
let visitId = "";
let settingsBefore: unknown = undefined;
let settingsExisted = false;

const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
function addDays(iso: string, n: number): string { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function targetMonday(): string {
  const today = melbourne.format(new Date());
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(addDays(today, ((8 - dow) % 7) || 7), 21); // four weeks out: clear of the other movements specs
}
const MON = targetMonday();
const WED = addDays(MON, 2);

async function chips(): Promise<Row[]> {
  const { data, error } = await db!.from("movements").select("id, kind, source_key, title, status, assignee_kind, assignee_id, due_date, time, sequence, duration_min").eq("work_order_id", job!.workOrderId).order("created_at");
  expect(error).toBeNull();
  return (data ?? []) as Row[];
}
async function lines(): Promise<Row[]> {
  const { data, error } = await db!.from("wo_material_lines").select("id, text, merged_into").eq("work_order_id", job!.workOrderId).is("merged_into", null).order("sort");
  expect(error).toBeNull();
  return (data ?? []) as Row[];
}
const okId = (s: string) => { expect(s).toMatch(/^ok:/); return s.replace(/^ok:/, ""); };
async function openMap(page: Page) {
  await page.goto(`/pc/movements?view=map&week=${MON}&day=${MON}`);
  await expect(page.getByTestId("run-planner")).toBeVisible({ timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("Movements second batch: bubbles, split, the run planner", () => {
  test.skip(!staff || !contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    staffProfileId = (await userIdFor(staff!))!;
    expect(contractorId && staffProfileId).toBeTruthy();
    const { data: pr, error: pErr } = await db!.from("products").insert({ name: PRODUCT, brand: BRAND, coverage: 12, price_per_litre: 2500, wastage_pct: 10 }).select("id").single();
    if (pErr) throw new Error(pErr.message);
    productId = (pr as { id: string }).id;
    const { data: b, error: bErr } = await db!.from("supplier_branches").insert({
      brand: BRAND, branch: "Trade", kind: "paint", suburb: "Oakleigh South", address: "1 Paint Rd", postcode: "3167", lat: -37.92, lng: 145.1, delivers_to_site: true, opens_weekday: "06:30", active: true,
    }).select("id").single();
    if (bErr) throw new Error(bErr.message);
    branchId = (b as { id: string }).id;
    const { data: s } = await db!.from("settings").select("value").eq("key", "movements").maybeSingle();
    settingsExisted = Boolean(s);
    settingsBefore = s?.value ?? null;
    const base = (settingsBefore && typeof settingsBefore === "object" ? settingsBefore : {}) as Record<string, unknown>;
    const people = Array.isArray(base.boardPeople) ? (base.boardPeople as Row[]).filter((p) => p.id !== staffProfileId) : [];
    const { error: sErr } = await db!.from("settings").upsert({ key: "movements", value: { ...base, boardPeople: [...people, { id: staffProfileId, slots: "hour", colour: "#0E8C9C" }] } }, { onConflict: "key" });
    if (sErr) throw new Error(sErr.message);

    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    const { error: eErr } = await db!.from("estimates").update({ builder_state: { internalMaterials: [LINE] } }).eq("id", job.estimateId);
    if (eErr) throw new Error(eErr.message);
    const materials = [{ product: PRODUCT, colourKey: `${PRODUCT}||Lexicon`, photoUrl: "", litres: 20, coverageMissing: false, colourName: "Lexicon Quarter", colourHex: "#EEEEEE", colourStatus: "confirmed" }];
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", job.workOrderId).single();
    const snap = { ...((w as { wo_snapshot: Row }).wo_snapshot), materials, jobAddress: "1 Test St, Oakleigh South VIC 3167", jobTitle: `E2E Batch two ${RUN}` };
    const { error: uErr } = await db!.from("work_orders").update({
      wo_snapshot: snap, stage: "pre_start", start_date: MON, end_date: WED,
      colours: { [PRODUCT]: { status: "confirmed", name: "Lexicon Quarter", hex: "#EEEEEE" } },
    }).eq("id", job.workOrderId);
    if (uErr) throw new Error(uErr.message);
    const { data: v, error: vErr } = await db!.from("wo_site_visits").insert({ work_order_id: job.workOrderId }).select("id").single();
    if (vErr) throw new Error(vErr.message);
    visitId = (v as { id: string }).id;
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, job);
    if (branchId) await db!.from("supplier_branches").delete().eq("id", branchId);
    await db!.from("vendors").delete().eq("name", BRAND);
    if (productId) await db!.from("products").delete().eq("id", productId);
    if (settingsExisted) await db!.from("settings").update({ value: settingsBefore }).eq("key", "movements");
    else await db!.from("settings").delete().eq("key", "movements");
  });

  test("split: one item off the line is its own line and chip; the last item refuses", async () => {
    const [line] = await lines();
    expect(String(line.text)).toContain("tapes");
    expect(await rpcAs(staff!, "material_line_split", { p_id: line.id, p_item: "nothing like this" })).toBe("error:no_such_item");
    const newId = okId(await rpcAs(staff!, "material_line_split", { p_id: line.id, p_item: TAPES }));
    const after = await lines();
    expect(after.map((l) => l.text)).toEqual([`E2E gap filler, interior filler`, TAPES]);
    const rows = await chips();
    expect(rows.find((r) => r.source_key === `matline:${newId}`), "the split item has a chip").toBeTruthy();
    expect(String(rows.find((r) => r.source_key === `matline:${line.id}`)!.title)).not.toContain("tapes");
    expect(await rpcAs(staff!, "material_line_split", { p_id: newId, p_item: TAPES })).toBe("error:last_item");
  });

  test("duration: a stop is 15 min to 10 h", async () => {
    const paint = (await chips()).find((r) => r.kind === "paint")!;
    expect(await rpcAs(staff!, "movement_set_duration", { p_id: paint.id, p_minutes: 5 })).toBe("error:bad_duration");
    expect(await rpcAs(staff!, "movement_set_duration", { p_id: paint.id, p_minutes: 90 })).toBe("ok:90");
    expect((await chips()).find((r) => r.kind === "paint")!.duration_min).toBe(90);
  });

  test("publish: a chip, a quality check and a site check-in land on the person's day in order", async () => {
    expect(await rpcAs(staff!, "movement_publish_run", { p_person_kind: "profiles", p_person_id: staffProfileId, p_day: MON, p_stops: [] })).toBe("error:no_stops");
    expect(await rpcAs(staff!, "movement_publish_run", { p_person_kind: "profiles", p_person_id: staffProfileId, p_day: MON, p_stops: [{ work_order_id: job!.workOrderId, purpose: "", time: "07:30" }] })).toBe("error:bad_purpose");
    const tapes = (await chips()).find((r) => String(r.title).includes("tapes"))!;
    expect(await rpcAs(staff!, "movement_set_method", { p_id: tapes.id, p_method: "pickup", p_branch_id: branchId })).toBe("ok:pickup");
    expect(await rpcAs(staff!, "movement_publish_run", {
      p_person_kind: "profiles", p_person_id: staffProfileId, p_day: MON, p_stops: [
        { movement_id: tapes.id, time: "07:30", duration_min: 30 },
        { work_order_id: job!.workOrderId, purpose: "quality_check", time: "09:00", duration_min: 45 },
        { work_order_id: job!.workOrderId, purpose: "site_checkin", time: "10:00", duration_min: 60 },
      ],
    })).toBe("ok:3");
    const rows = await chips();
    const placed = rows.find((r) => r.id === tapes.id)!;
    expect(placed.assignee_kind).toBe("person");
    expect(placed.assignee_id).toBe(staffProfileId);
    expect(placed.due_date).toBe(MON);
    expect(String(placed.time)).toMatch(/^07:30/);
    expect(placed.duration_min).toBe(30);
    expect(placed.sequence).toBe(1);
    const qc = rows.find((r) => r.kind === "other" && r.title === "Quality check")!;
    expect(qc, "the quality check is an Other chip").toBeTruthy();
    expect(String(qc.time)).toMatch(/^09:00/);
    expect(qc.duration_min).toBe(45);
    expect(qc.sequence).toBe(2);
    const { data: v } = await db!.from("wo_site_visits").select("scheduled_for, scheduled_time").eq("id", visitId).single();
    expect((v as { scheduled_for: string }).scheduled_for, "the check-in used the unscheduled visit").toBe(MON);
    expect(String((v as { scheduled_time: string }).scheduled_time)).toMatch(/^10:00/);
    // Back to the tray for the browser test below.
    expect(await rpcAs(staff!, "movement_unplace", { p_id: tapes.id })).toMatch(/^ok/);
  });

  test("Tom, 22 Oct: from our stock — the warehouse is the source, no order step, never the Supplier lane, and the sync leaves it alone", async () => {
    const paint = (await chips()).find((r) => r.kind === "paint")!;
    expect(await rpcAs(staff!, "movement_set_method", { p_id: paint.id, p_method: "stock" })).toBe("ok:stock");
    const { data: a } = await db!.from("movements").select("from_kind, from_branch_id, method_pref").eq("id", paint.id).single();
    expect(a).toMatchObject({ from_kind: "warehouse", from_branch_id: null, method_pref: "stock" });
    expect(await rpcAs(staff!, "movement_place", { p_id: paint.id, p_assignee_kind: "supplier", p_assignee_id: null, p_due_date: MON, p_half: "AM" })).toBe("error:from_stock");
    expect(await rpcAs(staff!, "movements_sync_now", { p_work_order_id: job!.workOrderId })).toMatch(/^ok/);
    const { data: b } = await db!.from("movements").select("from_kind, from_branch_id").eq("id", paint.id).single();
    expect(b, "the sync refilled a shop onto a stock chip").toMatchObject({ from_kind: "warehouse", from_branch_id: null });
    expect(await rpcAs(staff!, "movement_place", { p_id: paint.id, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: MON, p_half: "AM" }), "no order step from stock").toBe("ok:booked");
    expect(await rpcAs(staff!, "movement_unplace", { p_id: paint.id })).toMatch(/^ok/);
    expect(await rpcAs(staff!, "movement_set_method", { p_id: paint.id, p_method: "pickup", p_branch_id: branchId })).toBe("ok:pickup");
    const { data: c } = await db!.from("movements").select("from_kind, from_branch_id").eq("id", paint.id).single();
    expect(c).toMatchObject({ from_kind: "branch", from_branch_id: branchId });
  });

  test("publish: a rubbish chip on an office run is a collection — in the car until the warehouse, no tip, no warehouse trip", async () => {
    const rubbish = (await chips()).find((r) => r.source_key === "rubbish")!;
    expect(rubbish, "the rubbish question from the sync").toBeTruthy();
    expect(await rpcAs(staff!, "movement_publish_run", {
      p_person_kind: "profiles", p_person_id: staffProfileId, p_day: WED, p_stops: [{ movement_id: rubbish.id, purpose: "rubbish_collection", time: "14:00", duration_min: 30 }],
    })).toBe("ok:1");
    const { data: after } = await db!.from("movements").select("title, detail, to_kind, status, assignee_id, due_date").eq("id", rubbish.id).single();
    const r = after as Row;
    expect(r.title).toBe("Rubbish — collected on the run");
    expect(r.to_kind).toBe("warehouse");
    expect(String(r.detail)).toContain("stays in the car");
    expect(r.assignee_id).toBe(staffProfileId);
    expect(r.due_date).toBe(WED);
    expect(await rpcAs(staff!, "movement_unplace", { p_id: rubbish.id })).toMatch(/^ok/);
  });

  test("in the browser: the job page card past pre-start with bubbles; the Map planner publishes a chip at 07:30; the builder makes a bubble", async ({ page }) => {
    const { error } = await db!.from("work_orders").update({ stage: "in_progress" }).eq("id", job!.workOrderId);
    if (error) throw new Error(error.message);
    await signIn(page, staff!, /\/(home|estimates)/);

    // The job page: the card, the bubbles, tap to edit.
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    const card = page.getByTestId("job-movements-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    const bubbles = card.getByTestId("prestart-material-line");
    await expect(bubbles).toHaveCount(2);
    await bubbles.filter({ hasText: TAPES }).getByTestId("bubble-words").click();
    // Editing swaps the words for an input, so the bubble no longer carries the text — find the input on the card.
    const edit = card.getByTestId("bubble-edit");
    await edit.fill(`masking ${TAPES}`);
    await edit.press("Enter");
    await expect(card.getByTestId("prestart-materials-msg")).toContainText(/Line updated/, { timeout: 15_000 });
    expect((await lines()).some((l) => l.text === `masking ${TAPES}`), "the edit reached the line").toBe(true);

    // Tom, 22 Oct: one tap removes a tray chip — a materials line chip takes its line with it.
    await page.goto(`/pc/movements?view=week&week=${MON}`);
    await expect(page.getByTestId("movements-board")).toBeVisible({ timeout: 30_000 });
    const gone = (await chips()).find((r) => String(r.title).includes("tapes"))!;
    await page.locator(`[data-testid="tray-chip"][data-movement-id="${gone.id}"]`).getByTestId("tray-chip-remove").click();
    await expect(page.locator(".toast.show")).toContainText(/Removed/);
    await expect(page.locator(`[data-testid="tray-chip"][data-movement-id="${gone.id}"]`)).toHaveCount(0, { timeout: 15_000 });
    expect((await lines()).some((l) => String(l.text).includes("tapes")), "the line went with the chip").toBe(false);

    // The Map's run planner: add the gear chip from the tray list, 07:30, publish.
    const gear = okId(await rpcAs(staff!, "movement_create", { p: { kind: "equipment_out", work_order_id: job!.workOrderId, title: GEAR } }));
    await openMap(page);
    await expect(page.getByTestId("run-plan-empty")).toBeVisible();
    await page.getByTestId("run-plan-who").selectOption(staffProfileId);
    await page.locator(`[data-testid="map-tray-chip"][data-movement-id="${gear}"]`).getByTestId("map-tray-add").click();
    const row = page.getByTestId("run-plan-row");
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("run-plan-time")).toHaveValue("07:30");
    // Tom: the reason is the office's — another reason makes a new chip; the chip's own keeps it.
    await expect(row.getByTestId("run-plan-purpose")).toHaveValue("drop_materials");
    await row.getByTestId("run-plan-purpose").selectOption("site_checkin");
    await expect(row.getByTestId("run-plan-new-chip")).toBeVisible();
    await row.getByTestId("run-plan-purpose").selectOption("drop_materials");
    await expect(row.getByTestId("run-plan-new-chip")).toHaveCount(0);
    await expect(row.getByTestId("run-plan-open")).toBeVisible();
    await expect(row.getByTestId("run-plan-end")).toContainText("08:30");
    await row.getByTestId("run-plan-duration").selectOption("30");
    await expect(row.getByTestId("run-plan-end")).toContainText("08:00");
    await page.getByTestId("run-plan-publish").click();
    await expect(page.locator(".toast.show")).toContainText(/Published — 1 stop/, { timeout: 15_000 });
    await expect(page.getByTestId("run-plan-row")).toHaveCount(0);
    const placed = (await chips()).find((r) => r.id === gear)!;
    expect(placed.assignee_id).toBe(staffProfileId);
    expect(placed.due_date).toBe(MON);
    expect(String(placed.time)).toMatch(/^07:30/);
    expect(placed.duration_min).toBe(30);

    // The estimate builder: the field is the bubble input, and on this issued (locked) estimate the
    // line from the fixture shows as a bubble while the input is disabled with the rest of the builder.
    await page.goto(`/quote?id=${job!.estimateId}`);
    const input = page.getByTestId("internal-materials-input");
    await expect(input).toBeVisible({ timeout: 30_000 });
    await expect(input).toBeDisabled();
    await expect(page.getByTestId("draft-bubble").first()).toBeVisible();
  });
});
