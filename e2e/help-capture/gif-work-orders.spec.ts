import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { completePrep, contractorIdForEmail, customerIdForEmail, rpcAs, serviceClient, type LoopFixture } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn } from "../helpers";
import {
  DESK, PHONE, caption, createHelpJob, daysFromNow, destroyHelpJob, installCaptions, iso, startRecording,
  tapWithPhoto, uploadPhoto, writeGif,
} from "./rig";

/**
 * Walkthrough GIFs for docs/help/work-orders: the painter's flow is split in
 * two (ticks + variation, then finishing + sign-off) to stay under a minute
 * each; the PC gets one. Not a gate.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const F = "work-orders";
const AREAS = [
  { title: "Front", surfaces: [{ label: "Weatherboards", hours: 8 }, { label: "Windows × 3", hours: 4 }] },
  { title: "Rear", surfaces: [{ label: "Weatherboards", hours: 6 }, { label: "Back door", hours: 1.5 }] },
];

let contractorId = "";
const jobs: LoopFixture[] = [];

async function surfaceIds(workOrderId: string, heading: string): Promise<string[]> {
  const { data } = await db!.from("wo_surfaces").select("id").eq("work_order_id", workOrderId).eq("heading", heading).order("sort");
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

async function waitForStage(workOrderId: string, stages: string[], ms = 45_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const { data } = await db!.from("work_orders").select("stage").eq("id", workOrderId).single();
    const s = (data as { stage: string } | null)?.stage ?? "";
    if (stages.includes(s)) return s;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`work order did not reach ${stages.join("|")} within ${ms} ms`);
}

/** Mark every surface done with the photos the gate wants — setup, not a step anyone sees. */
async function finishAllSurfaces(workOrderId: string) {
  for (const h of AREAS.map((a) => a.title)) {
    await db!.from("wo_photos").insert([
      { work_order_id: workOrderId, kind: "before", area: h, storage_path: `wo/${workOrderId}/${h}-before.png` },
      { work_order_id: workOrderId, kind: "completion", area: h, storage_path: `wo/${workOrderId}/${h}-after.png` },
    ]);
  }
  await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", workOrderId);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!db || !staff || !contractor || !customer) return;
  contractorId = (await contractorIdForEmail(db, contractor.email)) ?? "";
  if (!contractorId) throw new Error(`no contractors row for ${contractor.email}`);
});

test.afterAll(async () => {
  if (!db) return;
  for (const j of jobs) await destroyHelpJob(db, j);
});

test("work orders · contractor walkthrough 1 — ticks and a variation", async ({ browser }) => {
  test.skip(!db || !staff || !contractor, missingCreds("CONTRACTOR"));
  test.setTimeout(300_000);
  const job = await createHelpJob(db!, {
    title: "Exterior repaint — weatherboard house", address: "14 Banksia Court, Northcote VIC 3070",
    contactFirstName: "Daniel", paymentCents: 786_000, areas: AREAS,
    assigned: { contractorId, startDate: iso(new Date()), stage: "in_progress" },
  });
  jobs.push(job);

  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const c = await ctx.newPage();
  await installCaptions(c);
  await signIn(c, contractor!, /\/portal/);
  const rec = startRecording(c);

  await c.goto(`/portal/jobs/${job.workOrderId}`);
  const list = c.getByTestId("tick-list");
  await expect(list).toBeVisible({ timeout: 30_000 });
  await list.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await caption(c, "1 · Scope & ticks: every area and surface on the job sheet.");
  await c.waitForTimeout(1500);
  const front = await surfaceIds(job.workOrderId, "Front");
  const first = list.getByTestId(`tick-${front[0]}`);
  await caption(c, "2 · Tap a row before its area has a before photo, and the list asks for one.");
  await first.click();
  await expect(c.getByTestId("tick-message")).toContainText("Before photo", { timeout: 10_000 });
  await c.waitForTimeout(1500);
  await caption(c, "3 · Take the before photo of the area.");
  await uploadPhoto(c, list.getByTestId("photo-prompt-Front"), "front-before.png");
  await expect(c.getByTestId("tick-message")).toContainText("saved", { timeout: 20_000 });
  await c.waitForTimeout(800);
  await caption(c, "4 · Tap once for PREPPED, again for DONE. The last tick asks for the finished shot.");
  for (const id of front) {
    const row = list.getByTestId(`tick-${id}`);
    for (let i = 0; i < 6; i++) {
      if (((await row.getAttribute("class")) ?? "").includes("done")) break;
      await tapWithPhoto(c, row, `front-${i}.png`);
    }
  }
  await c.waitForTimeout(1200);
  const vars = c.getByTestId("variations");
  await vars.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await caption(c, "5 · Found rot, damage or extra scope? Raise a variation before you work on it.");
  await vars.getByTestId("raise-variation").click();
  await vars.locator('[data-testid^="category-"]').first().click();
  await vars.getByTestId("variation-comment").fill("Three lower weatherboards on the left side are soft right through — rot, not paint.");
  await uploadPhoto(c, vars.getByTestId("variation-photo"), "rot.png");
  await c.waitForTimeout(1200);
  await vars.getByTestId("variation-hours").fill("3");
  await caption(c, "6 · A photo, plain words and rough hours, then Send to the office.");
  await c.waitForTimeout(800);
  await vars.getByTestId("send-variation").click();
  await expect(vars).toContainText("With the office", { timeout: 20_000 });
  await caption(c, "7 · With the office: they price it, the customer signs, then it comes to you to accept.");
  await c.waitForTimeout(2400);

  const frames = await rec.stop();
  await ctx.close();
  console.log("gif:", JSON.stringify(await writeGif(frames, F, "contractor-walkthrough", { width: 390 })));
});

test("work orders · contractor walkthrough 2 — finishing and sign-off", async ({ browser }) => {
  test.skip(!db || !staff || !contractor || !customer, missingCreds("CUSTOMER"));
  test.setTimeout(300_000);
  const customerId = await customerIdForEmail(db!, customer!.email);
  const job = await createHelpJob(db!, {
    title: "Exterior repaint — weatherboard house", address: "14 Banksia Court, Northcote VIC 3070",
    contactFirstName: "Daniel", paymentCents: 786_000, areas: AREAS,
    assigned: { contractorId, startDate: iso(daysFromNow(-4)), stage: "in_progress" },
  });
  jobs.push(job);
  await db!.from("estimates").update({ accepted_name: "Daniel Okafor", customer_id: customerId }).eq("id", job.estimateId);
  await rpcAs(staff!, "wo_book_walkthrough", { p_work_order_id: job.workOrderId, p_kind: "final", p_date: iso(new Date()), p_time: "15:00", p_note: "" });
  await finishAllSurfaces(job.workOrderId);

  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const c = await ctx.newPage();
  await installCaptions(c);
  await signIn(c, contractor!, /\/portal/);
  const rec = startRecording(c);

  await c.goto(`/portal/jobs/${job.workOrderId}`);
  const prep = c.getByTestId("prep-checklist");
  await expect(prep).toBeVisible({ timeout: 30_000 });
  await prep.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await caption(c, "1 · Every surface done: the Completion prep list appears. Tick it through.");
  for (let i = 0; i < 20; i++) {
    const q = prep.locator(".prep.q:not(.on)").first();
    if (await q.count()) {
      const label = (await q.innerText()).toLowerCase();
      if (label.includes("rubbish") || label.includes("equipment")) await q.locator('[data-testid^="prep-no-"]').click();
      else {
        const yes = q.locator('[data-testid^="prep-yes-"]'); const ta = q.locator("textarea");
        if (await yes.count()) await yes.click();
        else if (await ta.count()) { await ta.fill("Keep the back door open for an hour tomorrow morning while it cures."); await q.locator('[data-testid^="prep-save-"]').click(); }
        else break;
      }
      await c.waitForTimeout(700); continue;
    }
    const t = prep.locator("button.prep:not(.on)").first();
    if (!(await t.count())) break;
    await t.click(); await c.waitForTimeout(600);
  }
  await c.waitForTimeout(800);
  await c.getByTestId("finish-up").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await caption(c, "2 · All done — next step. The job routes itself: quality check, walkthrough or complete.");
  await c.getByTestId("finish-job").click();
  const stage = await waitForStage(job.workOrderId, ["qa", "walkthrough", "closed"]);
  if (stage === "qa") {
    // Setup only: settle any scheduled check so the walkthrough part of the film can run.
    await db!.from("wo_qa_checks").update({ result: "pass" }).eq("work_order_id", job.workOrderId).is("result", null);
    await c.goto(`/portal/jobs/${job.workOrderId}`);
    await waitForStage(job.workOrderId, ["walkthrough"]);
  }
  await c.goto(`/portal/jobs/${job.workOrderId}`);
  const ws = c.getByTestId("walkthrough-start");
  await expect(ws).toBeVisible({ timeout: 30_000 });
  await ws.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await caption(c, "3 · Walkthrough & sign-off: with the customer beside you, Start the walkthrough.");
  await c.waitForTimeout(1200);
  await c.getByTestId("start-walkthrough").click();
  await expect(c).toHaveURL(/\/s\//, { timeout: 30_000 });
  await caption(c, "4 · Hand the phone over. The customer taps Happy with this for each area.", { bottom: 20 });
  await c.waitForTimeout(1200);
  for (const h of AREAS.map((a) => a.title)) {
    const btn = c.getByTestId(`approve-${h}`);
    if (await btn.count()) { await btn.click(); await c.waitForTimeout(900); }
  }
  await caption(c, "5 · They type their full name and Sign off the job.", { bottom: 20 });
  await c.getByTestId("sign-name").fill("Daniel Okafor");
  await c.waitForTimeout(900);
  await c.getByTestId("sign").click();
  await expect(c.getByTestId("signed")).toBeVisible({ timeout: 30_000 });
  await caption(c, "6 · Signed off. Their completion report and warranty are on their way.", { bottom: 20 });
  await c.waitForTimeout(2000);
  await c.goto(`/portal/jobs/${job.workOrderId}`);
  await expect(c.locator("body")).toContainText("Job complete", { timeout: 20_000 });
  await caption(c, "7 · Job complete. Invoice this job is waiting below.");
  await c.waitForTimeout(2400);

  const frames = await rec.stop();
  await ctx.close();
  console.log("gif:", JSON.stringify(await writeGif(frames, F, "contractor-walkthrough-2", { width: 390 })));
});

test("work orders · pc walkthrough", async ({ browser }) => {
  test.skip(!db || !staff || !contractor || !customer, missingCreds("CUSTOMER"));
  test.setTimeout(400_000);
  const customerId = await customerIdForEmail(db!, customer!.email);
  const job = await createHelpJob(db!, {
    title: "Exterior repaint — weatherboard house", address: "14 Banksia Court, Northcote VIC 3070",
    contactFirstName: "Daniel", paymentCents: 786_000, areas: AREAS,
  });
  jobs.push(job);
  await db!.from("estimates").update({ total_cents: 1_842_000, accepted_name: "Daniel Okafor", customer_id: customerId }).eq("id", job.estimateId);
  const sent = await rpcAs(staff!, "send_offer", { p_work_order_id: job.workOrderId, p_contractor_id: contractorId, p_start: iso(new Date()), p_end: iso(daysFromNow(4)), p_note: "" });
  if (!/^ok|offered/.test(sent)) throw new Error(`send_offer: ${sent}`);
  const { data: offer } = await db!.from("booking_offers").select("id").eq("work_order_id", job.workOrderId).eq("state", "offered").single();
  await rpcAs(contractor!, "respond_to_offer", { p_offer_id: (offer as { id: string }).id, p_action: "accept", p_note: "" });
  await rpcAs(staff!, "wo_book_walkthrough", { p_work_order_id: job.workOrderId, p_kind: "final", p_date: iso(daysFromNow(4)), p_time: "15:00", p_note: "" });

  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await installCaptions(p);
  await signIn(p, staff!, /\/estimates/);
  const rec = startRecording(p);
  const focus = (sel: string) => p.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: "center" }));

  // The lanes page carries C1's 4,000 volume-test jobs and can take minutes;
  // film it when it answers, skip it when it does not.
  const lanes = await p.goto("/pc/flow", { timeout: 90_000 }).then(() => true).catch(() => false);
  if (lanes && (await p.locator("body").textContent().catch(() => ""))?.includes("Exterior repaint")) {
    await caption(p, "1 · Projects → Project progress: six lanes, every open job where its gate says it sits.", { top: 96 });
    await p.waitForTimeout(2200);
  }
  await p.goto(`/pc/wo/${job.workOrderId}`, { timeout: 120_000 });
  const pre = p.getByTestId("checklist-pre-start");
  await expect(pre).toBeVisible({ timeout: 60_000 });
  await focus('[data-testid="checklist-pre-start"]');
  await caption(p, "2 · Pre-start: colours first, then materials, equipment and access. The job cannot start until it is true.", { top: 96 });
  for (let i = 0; i < 20; i++) {
    const q = pre.locator(".chk.q:not(.on)").first();
    if (await q.count()) { await q.locator('[data-testid^="chk-yes-"]').click(); await p.waitForTimeout(800); continue; }
    const u = pre.locator("button.chk:not(.on)").first();
    if (!(await u.count())) break;
    await u.click(); await p.waitForTimeout(700);
  }
  await p.waitForTimeout(800);
  await focus('[data-testid="stage-advance"]');
  await caption(p, "3 · Next step: Start the job (or let it start itself on its booked date).", { top: 96 });
  await p.waitForTimeout(800);
  await p.getByTestId("advance-in_progress").click();
  await expect(p.getByTestId("stage-moved").or(p.getByTestId("stage-message"))).toBeVisible({ timeout: 30_000 });
  await waitForStage(job.workOrderId, ["in_progress"]);

  // The painter raises a variation from site (their side is in the painter's film).
  const { data: ph } = await db!.from("wo_photos").insert({ work_order_id: job.workOrderId, kind: "variation", area: "", storage_path: `wo/${job.workOrderId}/rot.png` }).select("id").single();
  const raised = await rpcAs(contractor!, "wo_raise_variation", {
    p_work_order_id: job.workOrderId, p_category: "rot",
    p_comment: "Three lower weatherboards on the left side are soft right through — rot, not paint.",
    p_photo_ids: [(ph as { id: string }).id], p_est_hours: 3,
  });
  const variationId = raised.slice(3);
  await p.goto(`/pc/wo/${job.workOrderId}`);
  const vcard = p.getByTestId(`variation-${variationId}`);
  await expect(vcard).toBeVisible({ timeout: 60_000 });
  await vcard.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await caption(p, "4 · A variation from site: price it in the builder, quick-price the hours, or absorb it.", { top: 96 });
  await p.waitForTimeout(1500);
  await vcard.getByTestId(`quick-price-toggle-${variationId}`).click();
  await vcard.getByTestId(`hours-${variationId}`).fill("3");
  await vcard.getByTestId(`materials-${variationId}`).fill("60");
  await p.waitForTimeout(1200);
  await caption(p, "5 · The engine prices it for the customer and shows the painter's amount. Price it.", { top: 96 });
  await vcard.getByTestId(`price-${variationId}`).click();
  await expect(vcard).toContainText("With the customer", { timeout: 90_000 });
  await caption(p, "6 · With the customer: the signing link has gone by email; text it too if you like.", { top: 96 });
  await p.waitForTimeout(2200);

  // Setup for the quality check, the painter's real path: the office wants a
  // check on this job, the painter finishes every surface and confirms the
  // completion list, and the server routes the job to qa.
  const must = (label: string, r: string, ok: RegExp) => { if (!ok.test(r)) throw new Error(`${label}: ${r}`); };
  // The finish gate refuses while a variation is undecided: the customer signs
  // the priced variation and the painter accepts it (their halves are filmed elsewhere).
  const { data: tok } = await db!.from("wo_variations").select("customer_token").eq("id", variationId).single();
  must("wo_customer_sign_variation", await rpcAs(customer!, "wo_customer_sign_variation", {
    p_token: (tok as { customer_token: string }).customer_token, p_name: "Daniel Okafor",
    p_signature: "data:image/png;base64," + Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64").toString("base64"),
  }), /^ok/);
  const accepted = await rpcAs(contractor!, "wo_contractor_accept_variation", { p_variation_id: variationId });
  if (accepted === "error:not_released") {
    must("wo_release_variation", await rpcAs(staff!, "wo_release_variation", { p_variation_id: variationId }), /^ok/);
    must("wo_contractor_accept_variation", await rpcAs(contractor!, "wo_contractor_accept_variation", { p_variation_id: variationId }), /^ok/);
  } else must("wo_contractor_accept_variation", accepted, /^ok/);
  must("wo_set_qa_required", await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: job.workOrderId, p_required: true }), /^ok/);
  await finishAllSurfaces(job.workOrderId);
  must("wo_contractor_finish", await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: job.workOrderId }), /^ok:completion_prep/);
  await completePrep(db!, staff!, job.workOrderId);
  must("wo_contractor_confirm_prep", await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: job.workOrderId }), /^ok:qa/);
  await waitForStage(job.workOrderId, ["qa"]);

  await p.goto(`/pc/wo/${job.workOrderId}`);
  const check = p.locator('.card[data-testid^="qa-"]').filter({ has: p.locator('[data-testid^="qa-item-"]') }).first();
  await expect(check).toBeVisible({ timeout: 60_000 });
  await check.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await caption(p, "7 · Quality check: tick each standard as you inspect it, add notes, then Log check — PASS.", { top: 96 });
  const checkId = ((await check.getAttribute("data-testid")) ?? "").replace("qa-", "");
  for (const item of await check.locator('[data-testid^="qa-item-"]').all()) { await item.click(); await p.waitForTimeout(500); }
  await check.getByTestId(`qa-notes-${checkId}`).fill("Even sheen from 1.5 m, cut lines straight.");
  await p.waitForTimeout(800);
  await check.getByTestId(`qa-pass-${checkId}`).click();
  await waitForStage(job.workOrderId, ["walkthrough"]);
  await p.reload();
  await expect(p.getByTestId("stage-advance")).toBeVisible({ timeout: 60_000 });
  await caption(p, "8 · A pass moves the job to Walkthrough on its own — the customer's pack is delivered.", { top: 96 });
  await p.waitForTimeout(1800);
  const walk = p.locator(".card", { hasText: /^Walkthrough/ }).first();
  if (await walk.count()) {
    await walk.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await caption(p, "9 · Sign-off happens on the painter's phone. Open the remote path only if the customer cannot attend.", { top: 96 });
    await p.waitForTimeout(2600);
  }

  const frames = await rec.stop();
  await ctx.close();
  console.log("gif:", JSON.stringify(await writeGif(frames, F, "pc-walkthrough", { width: 960 })));
});
