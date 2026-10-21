import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test, userIdFor } from "./helpers";
import { accessTokenFor, contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Movements — Session 5 of the build plan: Day run plans, the texts, the painter side.
 * Brief §3.4 (Day), §3.5 (order step → painter alert, run plan send), rulings 8, 10, 11, 22.
 *
 *   As the PC (staff, in the browser):
 *     1. the Day view lists the painter's stops numbered from the warehouse; ▼ swaps two
 *        stops and the TIMES move with them (ruling 22: the same set of times, new order);
 *     2. Ordered ✓ on the painter's pickup in the Orders card sets ordered_at AND texts the
 *        painter draft-first (an automation_holds row, painter_alerted_at stamped);
 *     3. Send to <name>'s phone stamps the stops and logs movement_run_plan_sent.
 *   As the CONTRACTOR (in the browser):
 *     4. the portal card shows the pickup with the shop's name, address, from-time and the
 *        order reference, with Navigate and Call; Picked up ✓ → done, painter_confirmed_at;
 *     5. the job sheet carries the lines, and the rendered HTML holds no account number, no
 *        cost, no branch email.
 *   As the CUSTOMER: none of it exists (REST + RPC refused or empty, never an error).
 *
 * The service key builds and tears down the fixture; every assertion about what a person
 * sees is made through that person's own session in the browser.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();

const RUN = Math.random().toString(36).slice(2, 8);
const BRAND_T = `E2E Taubmans ${RUN}`;
const PRODUCT_T = `E2E Endure ${RUN}`;
const ACCOUNT_REF = `E2EACCT${RUN}99`;
const BRANCH_EMAIL = `trade-${RUN}@example.com`;
const COST_CENTS = 123456; // "$1,234.56" — must never reach the painter's HTML
const PHONE = "0400000000";

type Row = Record<string, unknown>;

let contractorId = "";
let staffProfileId = "";
let job: LoopFixture | null = null;
let productId = "";
let branchId = "";
let dropoffId = "";
let phoneBefore: string | null | undefined;
let settingsBefore: unknown = undefined;
let settingsExisted = false;

const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
const todayMelb = () => melbourne.format(new Date());
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The Monday of the week after next — far enough out that no other spec's data sits on it. */
function targetMonday(): string {
  const today = todayMelb();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const nextMonday = addDays(today, ((8 - dow) % 7) || 7);
  return addDays(nextMonday, 7);
}
const MON = targetMonday();
const WED = addDays(MON, 2);

async function chipsOf(workOrderId: string): Promise<Row[]> {
  const { data, error } = await db!.from("movements")
    .select("id, kind, source_key, title, status, from_branch_id, ordered_at, due_date, half, time, sequence, assignee_kind, assignee_id, painter_alerted_at, painter_confirmed_at, run_plan_sent_at, order_ref")
    .eq("work_order_id", workOrderId).order("created_at");
  expect(error, "reading the fixture's movements").toBeNull();
  return (data ?? []) as Row[];
}
const chip = (rows: Row[], key: string) => rows.find((r) => r.source_key === key);

async function waitFor<T>(read: () => Promise<T>, ok: (v: T) => boolean, label: string, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  let last: T = await read();
  while (!ok(last) && Date.now() < until) { await new Promise((r) => setTimeout(r, 500)); last = await read(); }
  expect(ok(last), label).toBe(true);
  return last;
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
async function readAs(who: { email: string; password: string }, path: string): Promise<{ rows: Row[] | null; error: Row | null }> {
  const token = await accessTokenFor(who);
  const body = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => r.json());
  return Array.isArray(body) ? { rows: body as Row[], error: null } : { rows: null, error: body as Row };
}

test.describe.configure({ mode: "serial" });

test.describe("Movements Day, texts and the painter side", () => {
  test.skip(!staff || !contractor || !customer, missingCreds("CUSTOMER"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    staffProfileId = (await userIdFor(staff!))!;
    expect(contractorId && staffProfileId, "the E2E contractor and staff logins exist").toBeTruthy();

    // The painter has a mobile, so the order step has somewhere to send the (draft) text.
    const { data: c } = await db!.from("contractors").select("phone").eq("id", contractorId).single();
    phoneBefore = (c as { phone: string | null } | null)?.phone;
    await db!.from("contractors").update({ phone: PHONE }).eq("id", contractorId);

    const { data: pr, error: pErr } = await db!.from("products").insert({ name: PRODUCT_T, brand: BRAND_T, coverage: 12, price_per_litre: 2500, wastage_pct: 10 }).select("id").single();
    if (pErr) throw new Error(`product: ${pErr.message}`);
    productId = (pr as { id: string }).id;
    // A counter-only Taubmans branch (the pickup), with a trade account and an email the painter must never see.
    const { data: b, error: bErr } = await db!.from("supplier_branches").insert({
      brand: BRAND_T, branch: "Trade", kind: "paint", suburb: "Oakleigh South", address: "31 Connell Rd", postcode: "3167", lat: -37.9, lng: 145.09,
      delivers_to_site: false, opens_weekday: "06:30", phone: "(03) 9569 7968", email: BRANCH_EMAIL, active: true,
    }).select("id").single();
    if (bErr) throw new Error(`branch: ${bErr.message}`);
    branchId = (b as { id: string }).id;
    const { error: aErr } = await db!.from("supplier_branch_accounts").insert({ branch_id: branchId, account_ref: ACCOUNT_REF, account_name: "Paint Group" });
    if (aErr) throw new Error(`account: ${aErr.message}`);

    const { data: s } = await db!.from("settings").select("value").eq("key", "movements").maybeSingle();
    settingsExisted = Boolean(s);
    settingsBefore = s?.value ?? null;
    const base = (settingsBefore && typeof settingsBefore === "object" ? settingsBefore : {}) as Record<string, unknown>;
    const people = Array.isArray(base.boardPeople) ? (base.boardPeople as Row[]).filter((p) => p.id !== staffProfileId) : [];
    const { error: sErr } = await db!.from("settings").upsert({
      key: "movements", value: { ...base, boardPeople: [...people, { id: staffProfileId, slots: "hour", colour: "#0E8C9C" }], warehouse: { label: "Warehouse", address: "25-27 Bunney Rd", suburb: "Oakleigh South", postcode: "3167", lat: -37.92, lng: 145.1 } },
    }, { onConflict: "key" });
    if (sErr) throw new Error(`settings: ${sErr.message}`);

    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    const materials = [{ product: PRODUCT_T, colourKey: `${PRODUCT_T}||Monument`, photoUrl: "", litres: 8, coverageMissing: false, colourName: "Monument", colourHex: "#333333", colourStatus: "confirmed" }];
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", job.workOrderId).single();
    const snap = { ...((w as { wo_snapshot: Row }).wo_snapshot), materials, jobAddress: "1 Test St, Oakleigh South VIC 3167", jobTitle: `E2E Movements Day ${RUN}` };
    const { error: uErr } = await db!.from("work_orders").update({
      wo_snapshot: snap, stage: "pre_start", start_date: MON, end_date: WED,
      colours: { [PRODUCT_T]: { status: "confirmed", name: "Monument", hex: "#333333" } },
    }).eq("id", job.workOrderId);
    if (uErr) throw new Error(`fixture update: ${uErr.message}`);

    // The office places two stops on the painter's Monday through the RPCs (Session 4 proved the drag):
    // the Taubmans pickup at 07:00 (needs the order step) and a gear drop-off at 13:00 with an expected cost.
    const rows = await chipsOf(job.workOrderId);
    const taub = chip(rows, `paint:${BRAND_T}`)!;
    // The sync only defaults to a DELIVERING branch; this one is counter-only, so the office picks it in the chip sheet (movement_update).
    expect(await rpcAs(staff!, "movement_update", { p_id: taub.id, p: { from_branch_id: branchId } })).toMatch(/^ok/);
    expect(await rpcAs(staff!, "movement_place", { p_id: taub.id, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: MON, p_half: "AM", p_time: "07:00" })).toBe("ok:planned");
    const made = await rpcAs(staff!, "movement_create", { p: { kind: "other", work_order_id: job.workOrderId, title: `E2E drop sheets ${RUN}`, from: { kind: "warehouse" }, to: { kind: "site" } } });
    expect(made, "manual chip").toMatch(/^ok:/);
    dropoffId = made.replace(/^ok:/, "");
    expect(await rpcAs(staff!, "movement_update", { p_id: dropoffId, p: { expected_cost_cents: COST_CENTS, note: `E2E office-only note ${RUN}` } })).toMatch(/^ok/);
    expect(await rpcAs(staff!, "movement_place", { p_id: dropoffId, p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: MON, p_half: "PM", p_time: "13:00" })).toBe("ok:booked");
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, job);
    if (branchId) { const r = await db!.from("supplier_branches").delete().eq("id", branchId); expect(r.error?.message ?? "", "branch cleanup").toBe(""); }
    await db!.from("vendors").delete().eq("name", BRAND_T);
    if (productId) await db!.from("products").delete().eq("id", productId);
    if (contractorId) {
      await db!.from("automation_holds").delete().eq("contractor_id", contractorId).in("automation_key", ["movement_pickup_ready", "movement_delivery_booked", "movement_run_plan"]);
      if (phoneBefore !== undefined) await db!.from("contractors").update({ phone: phoneBefore }).eq("id", contractorId);
    }
    if (settingsExisted) await db!.from("settings").update({ value: settingsBefore }).eq("key", "movements");
    else await db!.from("settings").delete().eq("key", "movements");
  });

  const openDay = async (page: Page) => {
    await page.goto(`/pc/movements?view=day&day=${MON}&who=${contractorId}`);
    await expect(page.getByTestId("day-view")).toBeVisible({ timeout: 30_000 });
  };

  test("Day: the painter's stops are numbered from the warehouse; ▼ swaps two and the times move with them", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openDay(page);
    await expect(page.getByTestId("day-summary")).toContainText("2 stops");
    const stops = page.locator('[data-testid="run-stop"][data-movement-id]');
    await expect(stops).toHaveCount(2);
    const rows = await chipsOf(job!.workOrderId);
    const taubId = String(chip(rows, `paint:${BRAND_T}`)!.id);
    await expect(stops.nth(0)).toHaveAttribute("data-movement-id", taubId);
    await expect(stops.nth(0).getByTestId("run-stop-n")).toHaveText("1");
    await expect(stops.nth(0)).toContainText("Paint pickup");
    await expect(stops.nth(0)).toContainText("order not placed");
    await expect(stops.nth(1)).toHaveAttribute("data-movement-id", dropoffId);

    await stops.nth(0).getByTestId("run-down").click();
    await expect(page.locator(".toast.show")).toContainText(/Reordered/);
    await expect(page.locator('[data-testid="run-stop"][data-movement-id]').nth(0)).toHaveAttribute("data-movement-id", dropoffId, { timeout: 15_000 });
    // Ruling 22: the same two times (07:00, 13:00), handed out in the new order.
    const after = await chipsOf(job!.workOrderId);
    const taub = chip(after, `paint:${BRAND_T}`)!;
    const drop = after.find((r) => r.id === dropoffId)!;
    expect([drop.sequence, drop.time]).toEqual([1, "07:00:00"]);
    expect([taub.sequence, taub.time]).toEqual([2, "13:00:00"]);
    expect(taub.half).toBe("PM");
  });

  test("Orders card: Ordered ✓ on the pickup sets ordered_at and drafts the painter's text (hold row, painter told)", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openDay(page);
    const rows = await chipsOf(job!.workOrderId);
    const taubId = String(chip(rows, `paint:${BRAND_T}`)!.id);
    const orderRow = page.locator(`[data-testid="order-row"][data-movement-id="${taubId}"]`);
    await expect(orderRow).toBeVisible();
    await expect(orderRow).toContainText(`${BRAND_T} Trade`);
    await orderRow.getByRole("button", { name: "Ordered ✓" }).click();
    await expect(page.locator(".toast.show")).toContainText(/pickup text is drafted/);
    await expect(orderRow).toHaveCount(0);

    const stamped = await waitFor(() => chipsOf(job!.workOrderId), (r) => Boolean(chip(r, `paint:${BRAND_T}`)?.painter_alerted_at), "painter_alerted_at stamped after the text was queued");
    const taub = chip(stamped, `paint:${BRAND_T}`)!;
    expect(taub.ordered_at).toBeTruthy();
    expect(taub.status).toBe("booked");
    // Draft-first (build plan S5): the text sits in the approval queue, not on the painter's phone.
    const { data: holds, error } = await db!.from("automation_holds").select("status, sms_body, automation_key").eq("contractor_id", contractorId).eq("automation_key", "movement_pickup_ready").order("created_at", { ascending: false }).limit(1);
    expect(error).toBeNull();
    const hold = (holds ?? [])[0] as { status: string; sms_body: string | null } | undefined;
    expect(hold, "a pending hold for the pickup text").toBeTruthy();
    expect(hold!.status).toBe("pending");
    expect(hold!.sms_body ?? "").toContain(`${BRAND_T} Trade`);
    expect(hold!.sms_body ?? "").toContain("31 Connell Rd");
    expect(hold!.sms_body ?? "").toContain("6:30 am");
    expect(hold!.sms_body ?? "").toContain(String(taub.order_ref));
    // The customer heard nothing: client notice is off by default (ruling 11).
    const { data: clientHolds } = await db!.from("automation_holds").select("id").eq("automation_key", "movement_delivery_client_notice").eq("work_order_id", job!.workOrderId);
    expect(clientHolds ?? []).toEqual([]);
  });

  test("Send to the painter's phone stamps the stops and logs the run plan", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openDay(page);
    await page.getByTestId("send-run-plan").click();
    await expect(page.locator(".toast.show")).toContainText(/Run plan sent/);
    const rows = await chipsOf(job!.workOrderId);
    expect(rows.filter((r) => r.due_date === MON).every((r) => r.run_plan_sent_at), "every stop stamped").toBe(true);
    const { data: ev } = await db!.from("wo_events").select("meta").eq("work_order_id", job!.workOrderId).eq("type", "movement_run_plan_sent");
    expect((ev ?? []).length).toBeGreaterThan(0);
  });

  test("the painter: the card names the shop, address, from-time and order ref; Picked up ✓ → done; no cost, account or email in the HTML", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal?day=${MON}`);
    const card = page.getByTestId("movements-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    const lines = card.getByTestId("movements-card-line");
    await expect(lines).toHaveCount(2);
    const rows = await chipsOf(job!.workOrderId);
    const taub = chip(rows, `paint:${BRAND_T}`)!;
    const pickup = page.locator(`[data-testid="movements-card-line"][data-movement-id="${taub.id}"]`);
    await expect(pickup).toContainText(`Pick up at ${BRAND_T} Trade, 31 Connell Rd, Oakleigh South, from 6:30 am`);
    await expect(pickup).toContainText(`order ${taub.order_ref} under Paint Group`);
    await expect(pickup.getByTestId("movements-navigate")).toHaveAttribute("href", /google\.com\/maps/);
    await expect(pickup.getByTestId("movements-call")).toHaveAttribute("href", /^tel:/);
    // Acceptance 9: exactly enough. The office's note, the cost and the trade account never render.
    const html = await page.content();
    expect(html).not.toContain(ACCOUNT_REF);
    expect(html).not.toContain(BRANCH_EMAIL);
    expect(html).not.toContain("1,234.56");
    expect(html).not.toContain(String(COST_CENTS));
    expect(html).not.toContain(`E2E office-only note ${RUN}`);

    await pickup.getByTestId("movements-tick").click();
    await expect(pickup).toContainText("✓", { timeout: 15_000 });
    const after = await waitFor(() => chipsOf(job!.workOrderId), (r) => chip(r, `paint:${BRAND_T}`)?.status === "done", "the pickup is done");
    expect(chip(after, `paint:${BRAND_T}`)!.painter_confirmed_at).toBeTruthy();

    // The job sheet: the lines under Materials & colours.
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    const lg = page.getByTestId("wo-logistics");
    await expect(lg).toBeVisible({ timeout: 30_000 });
    await expect(lg.getByTestId("wo-logistics-paint")).toContainText(`Pick up at ${BRAND_T} Trade`);
    const sheetHtml = await page.content();
    expect(sheetHtml).not.toContain(ACCOUNT_REF);
    expect(sheetHtml).not.toContain(BRANCH_EMAIL);
    expect(sheetHtml).not.toContain("1,234.56");
  });

  test("the customer: none of it exists", async () => {
    const table = await readAs(customer!, `movements?work_order_id=eq.${job!.workOrderId}&select=id`);
    expect(table.error, "no error — RLS simply shows nothing").toBeNull();
    expect(table.rows).toEqual([]);
    const token = await accessTokenFor(customer!);
    const rpc = await fetch(`${URL}/rest/v1/rpc/movements_for_painter`, {
      method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_work_order_id: job!.workOrderId }),
    }).then((r) => r.json());
    expect(Array.isArray(rpc) ? rpc : [], "a customer gets no painter rows").toEqual([]);
  });
});
