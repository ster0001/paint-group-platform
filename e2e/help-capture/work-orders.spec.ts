import { test, expect, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contractorIdForEmail, customerIdForEmail, rpcAs, serviceClient, type LoopFixture } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn } from "../helpers";
import { DESK_TALL, PHONE, createHelpJob, destroyHelpJob, frame, placeholderPng, shot } from "./rig";

/**
 * Help capture — the work order loop, painter (phone) + project coordinator
 * (desktop). Not a gate. See rig.ts.
 *
 * Offer accepted → PC works the pre-start list, ticks "quality check required",
 * starts the job → painter: before photo, ticks, site note, raises a variation →
 * PC prices it, customer signs (RPC), painter accepts → painter finishes every
 * surface (finished shots), answers the completion list, "All done — next step"
 * → quality check: PC fails it once (rectification lands on the painter's list),
 * painter puts it right, PC passes → walkthrough: painter hands the phone over,
 * customer approves each area and signs → closed.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const SECRET = process.env.CRON_SECRET;
const F = "work-orders";
const HEADINGS = ["Front", "Left side", "Rear"];

let job: LoopFixture | null = null;
let contractorId = "";
let photoSeed = 0;

async function uploadVia(page: Page, trigger: Locator, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await trigger.click();
  await (await chooser).setFiles({ name, mimeType: "image/png", buffer: placeholderPng(480, 360, photoSeed++) });
}

/** Rows of one heading, by id — the DOM grouping is not something to guess at. */
async function surfaceIds(heading: string): Promise<string[]> {
  const { data } = await db!.from("wo_surfaces").select("id").eq("work_order_id", job!.workOrderId).eq("heading", heading).order("sort");
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * Tap a row once, supplying a photo if the tap opens the picker instead of
 * ticking: the tick list asks for the before shot on an area's first tick and
 * the finished shot on its last one by opening the phone's camera directly.
 */
async function tapRow(page: Page, row: Locator, name: string) {
  const chooser = page.waitForEvent("filechooser", { timeout: 2_500 }).catch(() => null);
  await row.click();
  const fc = await chooser;
  if (fc) {
    await fc.setFiles({ name, mimeType: "image/png", buffer: placeholderPng(480, 360, photoSeed++) });
    await page.waitForTimeout(1500);
    return "photo" as const;
  }
  await page.waitForTimeout(600);
  return "tick" as const;
}

/** Tap a heading's rows through to Done, meeting the photo prompts as they come. */
async function finishHeading(page: Page, heading: string) {
  const list = page.getByTestId("tick-list");
  for (const id of await surfaceIds(heading)) {
    const row = list.getByTestId(`tick-${id}`);
    for (let attempt = 0; attempt < 8; attempt++) {
      if (((await row.getAttribute("class")) ?? "").includes("done")) break;
      await tapRow(page, row, `${heading}-${attempt}.png`);
    }
  }
}

/** The finish button composes two RPCs app-side; poll the row rather than racing the page. */
async function waitForStage(stage: string, ms = 45_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const { data } = await db!.from("work_orders").select("stage").eq("id", job!.workOrderId).single();
    if ((data as { stage: string } | null)?.stage === stage) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`work order did not reach ${stage} within ${ms} ms`);
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!db || !staff || !contractor || !customer) return;
  contractorId = (await contractorIdForEmail(db, contractor.email)) ?? "";
  if (!contractorId) throw new Error(`no contractors row for ${contractor.email} on this stack`);
  const customerId = await customerIdForEmail(db, customer.email);
  job = await createHelpJob(db, {
    title: "Exterior repaint — weatherboard house",
    address: "14 Banksia Court, Northcote VIC 3070",
    contactFirstName: "Daniel",
    paymentCents: 786_000,
    areas: [
      { title: "Front", surfaces: [{ label: "Weatherboards", hours: 8 }, { label: "Windows × 3", hours: 4 }, { label: "Eaves", hours: 3 }] },
      { title: "Left side", surfaces: [{ label: "Weatherboards", hours: 6 }, { label: "Eaves", hours: 2 }] },
      { title: "Rear", surfaces: [{ label: "Weatherboards", hours: 6 }, { label: "Back door", hours: 1.5 }] },
    ],
  });
  await db.from("estimates").update({ total_cents: 1_842_000, accepted_name: "Daniel Okafor", customer_id: customerId }).eq("id", job.estimateId);

  // The real path in: offer → accept (the trigger moves the stage and seeds the lists).
  const today = new Date();
  const end = new Date(today); end.setDate(end.getDate() + 4);
  const sent = await rpcAs(staff, "send_offer", {
    p_work_order_id: job.workOrderId, p_contractor_id: contractorId,
    p_start: iso(today), p_end: iso(end), p_note: "Ladder access at the rear only — the side path is narrow.",
  });
  if (!/^ok|offered/.test(sent)) throw new Error(`send_offer: ${sent}`);
  const { data: offer } = await db.from("booking_offers").select("id").eq("work_order_id", job.workOrderId).eq("state", "offered").single();
  const acc = await rpcAs(contractor, "respond_to_offer", { p_offer_id: (offer as { id: string }).id, p_action: "accept", p_note: "" });
  if (!/accepted/.test(acc)) throw new Error(`respond_to_offer: ${acc}`);
  await rpcAs(staff, "wo_book_walkthrough", {
    p_work_order_id: job.workOrderId, p_kind: "final", p_date: iso(end), p_time: "15:00", p_note: "Confirmed with the client at booking",
  });
});

test.afterAll(async () => {
  if (!db) return;
  await destroyHelpJob(db, job);
});

test("work orders — painter and PC, offer to signed off", async ({ browser, request }) => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!staff || !contractor || !customer, missingCreds("CUSTOMER"));
  test.setTimeout(900_000);
  const woId = job!.workOrderId;

  const pCtx = await browser.newContext({ viewport: DESK_TALL, deviceScaleFactor: 2 });
  const p = await pCtx.newPage();
  await signIn(p, staff!, /\/estimates/);
  const cCtx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const c = await cCtx.newPage();
  await signIn(c, contractor!, /\/portal/);

  // ---- PC: console, lanes, the pre-start list ---------------------------------
  await p.goto("/pc");
  await expect(p.getByText("Needs you now")).toBeVisible({ timeout: 60_000 });
  await shot(p, F, "pc", "01");
  await p.goto("/pc/flow");
  await expect(p.locator("body")).toContainText("Exterior repaint", { timeout: 60_000 });
  await shot(p, F, "pc", "02");
  await p.goto(`/pc/wo/${woId}`);
  const pre = p.getByTestId("checklist-pre-start");
  await expect(pre).toBeVisible({ timeout: 60_000 });
  await shot(p, F, "pc", "03");
  await frame(p, pre);
  await shot(p, F, "pc", "04");

  // Work the list the way the office does: questions answered Yes, required ticks in order.
  for (let i = 0; i < 20; i++) {
    const openQuestion = pre.locator(".chk.q:not(.on)").first();
    if (await openQuestion.count()) {
      await openQuestion.locator('[data-testid^="chk-yes-"]').click();
      await p.waitForTimeout(800);
      continue;
    }
    const unticked = pre.locator("button.chk:not(.on)").first();
    if (!(await unticked.count())) break;
    await unticked.click();
    await p.waitForTimeout(800);
  }
  // Controlled checkbox backed by a server action — click, then wait for the round trip.
  const qaRequired = p.getByTestId("qa-required");
  if (!(await qaRequired.isChecked())) {
    await qaRequired.click();
    await expect(qaRequired).toBeChecked({ timeout: 15_000 });
  }
  await frame(p, pre);
  await shot(p, F, "pc", "05");
  await frame(p, p.getByTestId("stage-advance"));
  await shot(p, F, "pc", "06");

  // The painter's view before the start: the locked Ready-to-start card.
  await c.goto(`/portal/jobs/${woId}`);
  await expect(c.locator("body")).toContainText("Ready to start?");
  await shot(c, F, "contractor", "01");

  await p.getByTestId("advance-in_progress").click();
  // The move is a server action; wait for its result before reloading, or the
  // reload cancels it mid-flight.
  await expect(p.getByTestId("stage-moved").or(p.getByTestId("stage-message"))).toBeVisible({ timeout: 30_000 });
  await p.reload();
  await expect(p.getByTestId("tick-list")).toBeVisible({ timeout: 60_000 });
  await shot(p, F, "pc", "07");

  // ---- painter: photo first, then ticks, a note, a variation ---------------------
  await c.goto(`/portal/jobs/${woId}`);
  const list = c.getByTestId("tick-list");
  await expect(list).toBeVisible({ timeout: 30_000 });
  await frame(c, list);
  await shot(c, F, "contractor", "02");
  const frontIds = await surfaceIds("Front");
  const firstRow = list.getByTestId(`tick-${frontIds[0]}`);
  await firstRow.click();
  await expect(c.getByTestId("tick-message")).toContainText("Before photo", { timeout: 10_000 });
  await shot(c, F, "contractor", "03");
  await uploadVia(c, list.getByTestId("photo-prompt-Front"), "front-before.png");
  await expect(c.getByTestId("tick-message")).toContainText("saved", { timeout: 20_000 });
  await firstRow.click();
  await expect(firstRow).toHaveClass(/prepped/, { timeout: 10_000 });
  await shot(c, F, "contractor", "04");

  const photos = c.getByTestId("site-photos");
  await frame(c, photos);
  await photos.locator("textarea").fill("Gutter on the left side is loose above the eaves — not ours, but you may want to tell the owner.");
  await shot(c, F, "contractor", "05");
  await photos.getByRole("button", { name: "Send the note" }).click();
  await expect(photos).toContainText("Note sent", { timeout: 15_000 });

  const vars = c.getByTestId("variations");
  await frame(c, vars);
  await vars.getByTestId("raise-variation").click();
  await vars.locator('[data-testid^="category-"]').first().click();
  await vars.getByTestId("variation-comment").fill("Three lower weatherboards on the left side are soft right through — rot, not paint.");
  await uploadVia(c, vars.getByTestId("variation-photo"), "rot.png");
  await c.waitForTimeout(1500);
  await vars.getByTestId("variation-hours").fill("3");
  await frame(c, vars);
  await shot(c, F, "contractor", "06");
  await vars.getByTestId("send-variation").click();
  await expect(vars).toContainText("With the office", { timeout: 20_000 });
  await frame(c, vars);
  await shot(c, F, "contractor", "07");
  const { data: vrow } = await db!.from("wo_variations").select("id").eq("work_order_id", woId).single();
  const variationId = (vrow as { id: string }).id;

  // ---- PC: price it; the customer signs; the painter accepts --------------------
  await p.goto(`/pc/wo/${woId}`);
  const vcard = p.getByTestId(`variation-${variationId}`);
  await expect(vcard).toBeVisible({ timeout: 60_000 });
  await frame(p, vcard);
  await shot(p, F, "pc", "08");
  await vcard.getByTestId(`quick-price-toggle-${variationId}`).click();
  await vcard.getByTestId(`hours-${variationId}`).fill("3");
  await vcard.getByTestId(`materials-${variationId}`).fill("60");
  await p.waitForTimeout(400);
  await frame(p, vcard);
  await shot(p, F, "pc", "09");
  await vcard.getByTestId(`price-${variationId}`).click();
  await expect(vcard).toContainText("With the customer", { timeout: 20_000 });
  await frame(p, vcard);
  await shot(p, F, "pc", "10");
  const { data: tok } = await db!.from("wo_variations").select("customer_token").eq("id", variationId).single();
  const signed = await rpcAs(customer!, "wo_customer_sign_variation", {
    p_token: (tok as { customer_token: string }).customer_token, p_name: "Daniel Okafor",
    p_signature: "data:image/png;base64," + placeholderPng(200, 80, 9).toString("base64"),
  });
  expect(signed).toBe("ok:approved");

  await c.goto(`/portal/jobs/${woId}`);
  const vars2 = c.getByTestId("variations");
  await frame(c, vars2);
  await shot(c, F, "contractor", "08");
  const acceptBtn = vars2.getByTestId(`accept-${variationId}`);
  if (await acceptBtn.count()) {
    await acceptBtn.click();
    await expect(vars2).toContainText(/Accepted|Acknowledged|coming to you/, { timeout: 15_000 });
  }

  // ---- painter: finish every surface, answer the completion list ---------------
  for (const h of HEADINGS) await finishHeading(c, h);
  await expect(c.getByTestId("finish-up")).toBeVisible({ timeout: 20_000 });
  const prep = c.getByTestId("prep-checklist");
  await frame(c, prep);
  await shot(c, F, "contractor", "09");
  for (let i = 0; i < 20; i++) {
    const q = prep.locator(".prep.q:not(.on)").first();
    if (await q.count()) {
      const label = (await q.innerText()).toLowerCase();
      if (label.includes("rubbish")) {
        await q.locator('[data-testid^="prep-yes-"]').click();
        await c.waitForTimeout(700);
        const ta = q.locator("textarea");
        if (await ta.count()) { await ta.fill("Two bags of sanding dust and the old downpipe offcuts."); await q.locator('[data-testid^="prep-save-"]').click(); }
      } else if (label.includes("equipment")) {
        await q.locator('[data-testid^="prep-no-"]').click();
      } else {
        const ta = q.locator("textarea");
        const yes = q.locator('[data-testid^="prep-yes-"]');
        if (await yes.count()) await yes.click();
        else if (await ta.count()) { await ta.fill("Keep the back door open for an hour tomorrow morning while it cures."); await q.locator('[data-testid^="prep-save-"]').click(); }
        else break;
      }
      await c.waitForTimeout(800);
      continue;
    }
    const t = prep.locator("button.prep:not(.on)").first();
    if (!(await t.count())) break;
    await t.click();
    await c.waitForTimeout(700);
  }
  await frame(c, prep);
  await shot(c, F, "contractor", "10");
  await c.getByTestId("finish-job").click();
  await waitForStage("qa");
  await c.goto(`/portal/jobs/${woId}`);
  await expect(c.locator("body")).toContainText("Quality check", { timeout: 20_000 });
  await shot(c, F, "contractor", "11");

  // The day's ticks become a drafted customer update (sweep), which the PC reviews.
  if (SECRET) {
    await request.get("/api/cron/wo-sweep", { headers: { Authorization: `Bearer ${SECRET}` } });
    await p.goto("/pc/updates");
    await p.waitForLoadState("networkidle");
    await shot(p, F, "pc", "11");
  }

  // ---- PC: the quality check — fail once, then pass -----------------------------
  await p.goto(`/pc/wo/${woId}`);
  const check = p.locator('.card[data-testid^="qa-"]').filter({ has: p.locator('[data-testid^="qa-item-"]') }).first();
  await expect(check).toBeVisible({ timeout: 60_000 });
  await frame(p, check);
  await shot(p, F, "pc", "12");
  const checkId = ((await check.getAttribute("data-testid")) ?? "").replace("qa-", "");
  await check.getByTestId(`qa-fail-${checkId}`).click();
  await check.getByTestId(`qa-where-${checkId}`).fill("Left side");
  await check.getByTestId(`qa-what-${checkId}`).fill("Lower weatherboards patchy — re-sand and recoat the bottom three boards.");
  await frame(p, check);
  await shot(p, F, "pc", "13");
  await check.getByTestId(`qa-confirm-fail-${checkId}`).click();
  await waitForStage("in_progress");

  await c.goto(`/portal/jobs/${woId}`);
  await expect(c.locator("body")).toContainText("areas to put right", { timeout: 20_000 });
  await shot(c, F, "contractor", "12");
  const { data: rectRows } = await db!.from("wo_surfaces").select("id").eq("work_order_id", woId).eq("rectification", true);
  const rectId = ((rectRows ?? []) as { id: string }[])[0]?.id ?? "";
  const rectRow = c.getByTestId(`tick-${rectId}`);
  await frame(c, rectRow);
  await shot(c, F, "contractor", "13");
  for (let i = 0; i < 6; i++) {
    if (((await rectRow.getAttribute("class")) ?? "").includes("done")) break;
    await tapRow(c, rectRow, `rectify-${i}.png`);
  }
  await expect(c.getByTestId("finish-up")).toBeVisible({ timeout: 20_000 });
  await c.getByTestId("finish-job").click();
  await waitForStage("qa");

  // The failed check stays logged FAIL and cannot be re-logged, and no fresh
  // check is scheduled, so the office adds a mid-job check to inspect the
  // rectification and passes that one.
  await p.goto(`/pc/wo/${woId}`);
  await expect(p.getByTestId("qa-controls")).toBeVisible({ timeout: 60_000 });
  await p.getByTestId("qa-mid-open").click();
  await p.getByTestId("qa-mid-date").fill(iso(new Date()));
  await p.getByTestId("qa-mid-add").click();
  await expect(p.getByTestId("qa-controls-msg").or(p.locator('.card[data-testid^="qa-"]').filter({ has: p.locator('[data-testid^="qa-item-"]') }).first())).toBeVisible({ timeout: 30_000 });
  await p.reload();
  const check2 = p.locator('.card[data-testid^="qa-"]').filter({ has: p.locator('[data-testid^="qa-item-"]') }).first();
  await expect(check2).toBeVisible({ timeout: 60_000 });
  const id2 = ((await check2.getAttribute("data-testid")) ?? "").replace("qa-", "");
  for (const item of await check2.locator('[data-testid^="qa-item-"]').all()) {
    if (!((await item.getAttribute("class")) ?? "").includes("on")) { await item.click(); await p.waitForTimeout(500); }
  }
  await check2.getByTestId(`qa-notes-${id2}`).fill("Boards recoated, even sheen from 1.5 m.");
  await frame(p, check2);
  await shot(p, F, "pc", "14");
  await check2.getByTestId(`qa-pass-${id2}`).click();
  await expect(check2).toContainText(/PASS|Logged/, { timeout: 30_000 });
  // WORKAROUND, not the app: the failed 'final' check still counts as open in
  // wo_gate_blocked and nothing in the UI can re-pass it (task "Let a failed
  // quality check be re-inspected and passed", 6 Sep 2026). Settle it the way
  // e2e/wo-full-loop.spec.ts does so the sign-off screens can be captured;
  // remove this once the real re-check path exists.
  await db!.from("wo_qa_checks").update({ result: "pass" }).eq("work_order_id", woId).eq("result", "fail");
  await p.reload(); // the PC page self-heals a parked qa job on view (wo_qa_route_passed)
  await waitForStage("walkthrough");
  await p.reload();
  await expect(p.getByTestId("stage-advance")).toBeVisible({ timeout: 60_000 });
  await frame(p, p.getByTestId("stage-advance"));
  await shot(p, F, "pc", "15");
  const walk = p.locator(".card", { hasText: /^Walkthrough/ }).first();
  if (await walk.count()) { await frame(p, walk); await shot(p, F, "pc", "16"); }

  // ---- painter: hand the phone to the customer --------------------------------
  await c.goto(`/portal/jobs/${woId}`);
  await expect(c.getByTestId("walkthrough-start")).toBeVisible({ timeout: 30_000 });
  await frame(c, c.getByTestId("walkthrough-start"));
  await shot(c, F, "contractor", "14");
  await c.getByTestId("start-walkthrough").click();
  await expect(c).toHaveURL(/\/s\//, { timeout: 30_000 });
  await shot(c, F, "contractor", "15");
  for (const h of HEADINGS) {
    const btn = c.getByTestId(`approve-${h}`);
    if (await btn.count()) { await btn.click(); await c.waitForTimeout(800); }
  }
  await c.getByTestId("sign-name").fill("Daniel Okafor");
  await frame(c, c.getByTestId("sign"));
  await shot(c, F, "contractor", "16");
  await c.getByTestId("sign").click();
  await expect(c.getByTestId("signed")).toBeVisible({ timeout: 30_000 });
  await shot(c, F, "contractor", "17");
  await c.goto(`/portal/jobs/${woId}`);
  await expect(c.locator("body")).toContainText("Job complete", { timeout: 20_000 });
  await shot(c, F, "contractor", "18");

  await p.goto(`/pc/wo/${woId}`);
  await expect(p.locator("body")).toContainText("Closed", { timeout: 60_000 });
  await shot(p, F, "pc", "17");
  await p.goto("/pc");
  await p.waitForLoadState("networkidle");
  await shot(p, F, "pc", "18");

  await pCtx.close();
  await cCtx.close();
});
