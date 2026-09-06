import { test, expect, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * A failed quality check can be re-inspected and passed — through the screens.
 *
 * The gap (6 Sep 2026, found by the help-capture rig): PC fails the final
 * check → painter rectifies and taps "All done — next step" → the job is back
 * at Quality check with ONE card, "Logged: FAIL", no controls, and every gate
 * counting that fail as open. Parked for ever; the only way through was an
 * administrator editing wo_qa_checks — which is what wo-full-loop step 7 did.
 *
 * Now (migration 20270112) a FAIL spawns its own re-check — same kind,
 * `retry_of` = the failed check, standards fresh — and a fail counts as open
 * only until that re-check exists. This story drives the real buttons in
 * both portals: the painter's finish, QaCheck's fail and pass. The ONLY
 * service-role writes are the fixture (job, surfaces, the two photos the tick
 * list asks for). Nothing here touches wo_qa_checks directly.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const HEADING = "Front";
let job: LoopFixture | null = null;
let failedId = "";
let recheckId = "";
let rectifyId = "";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function stageNow(): Promise<string> {
  const { data } = await db!.from("work_orders").select("stage").eq("id", job!.workOrderId).single();
  return (data as { stage: string }).stage;
}

/** The finish button composes two RPCs app-side; poll the row rather than racing the page. */
async function waitForStage(stage: string, ms = 45_000) {
  await expect.poll(stageNow, { timeout: ms, message: `work order did not reach ${stage}` }).toBe(stage);
}

/**
 * Tap a tick row once. The photos for the area are on record, so this is a
 * plain tick — but if the list still opens the camera, feed it a shot rather
 * than failing on a prompt that is not what this story is about.
 */
async function tapRow(page: Page, row: Locator) {
  const chooser = page.waitForEvent("filechooser", { timeout: 2_500 }).catch(() => null);
  await row.click();
  const fc = await chooser;
  if (fc) await fc.setFiles({ name: "shot.png", mimeType: "image/png", buffer: PNG });
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });

/**
 * "All done — next step". The press is a server action on a page that
 * refreshes itself the moment the stage moves (the finish card unmounts with
 * its message), so the proof is the STAGE, not the toast. A press that lands
 * before hydration is silently lost — wait for the network to settle, and if
 * nothing moved in 15 s press once more before giving up.
 */
async function pressFinish(page: Page, expectStage: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForLoadState("networkidle");
    const btn = page.getByTestId("finish-job");
    await expect(btn).toBeVisible({ timeout: 30_000 });
    await btn.click();
    const until = Date.now() + 15_000;
    while (Date.now() < until) {
      if ((await stageNow()) === expectStage) return;
      const msg = page.getByTestId("finish-msg");
      if (await msg.count()) {
        const text = (await msg.innerText()).trim();
        if (text && !/quality check|nice work/i.test(text)) throw new Error(`finish refused: ${text}`);
      }
      await page.waitForTimeout(500);
    }
  }
  throw new Error(`work order did not reach ${expectStage} after pressing finish`);
}

test.describe.configure({ mode: "serial" });

test.describe("QA fail → rectify → re-check → pass → walkthrough, on the screens", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [{ heading: HEADING, labels: ["Weatherboards", "Windows × 3"] }]);

    // The office wants this job checked — the cadence is not what's under test.
    expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: job.workOrderId, p_required: true }))
      .toMatch(/^ok/);

    // The tick list asks for a before shot on an area's first tick and a
    // finished shot on its last; both on record so the ticks are plain ticks.
    const { error } = await db!.from("wo_photos").insert([
      { work_order_id: job.workOrderId, kind: "before", area: HEADING, storage_path: `wo/${job.workOrderId}/before-${Date.now()}.jpg` },
      { work_order_id: job.workOrderId, kind: "completion", area: HEADING, storage_path: `wo/${job.workOrderId}/after-${Date.now()}.jpg` },
    ]);
    if (error) throw new Error(`fixture photos: ${error.message}`);

    // The painter ticks every surface and answers the finishing-up list.
    for (const s of job.surfaces) {
      expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: s.id, p_to: "done" })).toBe("ok:done");
    }
    await completePrep(db!, contractor!, job.workOrderId);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("1 · the painter finishes — the server routes the job to quality check", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    await expect(page.getByTestId("finish-up")).toBeVisible({ timeout: 30_000 });
    await pressFinish(page, "qa");
    await page.reload();
    await expect(page.getByTestId("qa-notice")).toContainText(/quality checking/i, { timeout: 30_000 });

    const { data: checks } = await db!.from("wo_qa_checks")
      .select("id, kind, result").eq("work_order_id", job!.workOrderId);
    const list = (checks ?? []) as { id: string; kind: string; result: string | null }[];
    expect(list.length).toBe(1);
    expect(list[0].kind).toBe("final");
    expect(list[0].result).toBeNull();
  });

  test("2 · the PC fails it — rectification raised, a linked re-check exists, the job is back with the painter", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    const card = page.locator('.card[data-testid^="qa-"]').filter({ has: page.locator('[data-testid^="qa-item-"]') }).first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    failedId = ((await card.getAttribute("data-testid")) ?? "").replace("qa-", "");
    expect(failedId).toBeTruthy();

    await card.getByTestId(`qa-fail-${failedId}`).click();
    await card.getByTestId(`qa-where-${failedId}`).fill(HEADING);
    await card.getByTestId(`qa-what-${failedId}`).fill("Lower boards patchy — re-sand and recoat the bottom three.");
    await card.getByTestId(`qa-confirm-fail-${failedId}`).click();
    await expect(page.getByTestId(`qa-result-${failedId}`)).toContainText("FAIL", { timeout: 30_000 });
    await expect(page.getByTestId(`qa-result-${failedId}`)).toContainText(/re-check/i);
    await waitForStage("in_progress");

    // The record: the fail stays a fail, and its successor is already there —
    // same kind, linked, not yet logged, with its own fresh standards.
    const { data: checks } = await db!.from("wo_qa_checks")
      .select("id, kind, result, retry_of").eq("work_order_id", job!.workOrderId);
    const list = (checks ?? []) as { id: string; kind: string; result: string | null; retry_of: string | null }[];
    expect(list.find((c) => c.id === failedId)?.result).toBe("fail");
    const recheck = list.find((c) => c.retry_of === failedId);
    expect(recheck, "the fail spawned its re-check").toBeTruthy();
    expect(recheck!.result).toBeNull();
    expect(recheck!.kind).toBe("final");
    recheckId = recheck!.id;
    const { data: items } = await db!.from("wo_qa_items").select("id, done_at").eq("qa_check_id", recheckId);
    expect((items ?? []).length).toBe(4);
    expect((items as { done_at: string | null }[]).every((i) => i.done_at === null)).toBe(true);

    // The rectification landed on the SAME tick list, under the area named.
    const { data: rect } = await db!.from("wo_surfaces")
      .select("id, heading, label, state").eq("work_order_id", job!.workOrderId).eq("rectification", true);
    const rows = (rect ?? []) as { id: string; heading: string; label: string; state: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].heading).toBe(HEADING);
    expect(rows[0].label).toContain("re-sand");
    rectifyId = rows[0].id;

    // And the sign-off date still can't be booked: the re-check is open.
    expect(await rpcAs(staff!, "wo_book_walkthrough", {
      p_work_order_id: job!.workOrderId, p_kind: "final", p_date: today(), p_note: "", p_time: null,
    })).toBe("error:qa_first");
  });

  test("3 · the painter puts it right on that list and finishes again — back to quality check", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);
    await expect(page.getByTestId("qa-fail-card")).toContainText(/re-sand/i, { timeout: 30_000 });

    const row = page.getByTestId(`tick-${rectifyId}`);
    await expect(row).toBeVisible();
    await page.waitForLoadState("networkidle");
    for (let i = 0; i < 4; i++) {
      if (((await row.getAttribute("class")) ?? "").includes("done")) break;
      await tapRow(page, row);
      await page.waitForTimeout(800);
    }
    await expect(row).toHaveClass(/done/, { timeout: 15_000 });

    await expect(page.getByTestId("finish-up")).toBeVisible({ timeout: 20_000 });
    await pressFinish(page, "qa");
    await page.reload();
    await expect(page.getByTestId("qa-notice")).toBeVisible({ timeout: 30_000 });

    // The gate holds on the re-check — ONE open check, not the fail as well.
    expect(await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: job!.workOrderId }))
      .toBe("error:gate:1 quality check still open");
  });

  test("4 · the PC works the re-check card and passes it — the job moves to walkthrough on its own", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);

    // The failed card is the record: it stays, without controls.
    const failedCard = page.getByTestId(`qa-${failedId}`);
    await expect(failedCard).toContainText("FAIL", { timeout: 60_000 });
    await expect(failedCard.getByTestId(`qa-pass-${failedId}`)).toHaveCount(0);
    await expect(failedCard.getByTestId(`qa-fail-${failedId}`)).toHaveCount(0);

    // The re-check card says what it is and carries the controls.
    const re = page.getByTestId(`qa-${recheckId}`);
    await expect(re).toBeVisible();
    await expect(re).toContainText(/re-check/i);
    for (const item of await re.locator('[data-testid^="qa-item-"]').all()) {
      await item.click();
      await expect(item).toHaveClass(/on/, { timeout: 15_000 });
    }
    await re.getByTestId(`qa-notes-${recheckId}`).fill("Boards recoated — even sheen from 1.5 m.");
    await re.getByTestId(`qa-pass-${recheckId}`).click();
    await expect(page.getByTestId(`qa-msg-${recheckId}`)).toContainText(/Passed — all checks clear/, { timeout: 30_000 });
    await waitForStage("walkthrough");

    // The record holds both verdicts; the pack is out; the events tell the story.
    const { data: checks } = await db!.from("wo_qa_checks")
      .select("id, result").eq("work_order_id", job!.workOrderId);
    const byId = new Map(((checks ?? []) as { id: string; result: string | null }[]).map((c) => [c.id, c.result]));
    expect(byId.get(failedId)).toBe("fail");
    expect(byId.get(recheckId)).toBe("pass");

    const { data: so } = await db!.from("wo_signoff").select("customer_token").eq("work_order_id", job!.workOrderId).single();
    expect((so as { customer_token: string | null }).customer_token).toBeTruthy();

    const { data: ev } = await db!.from("wo_events")
      .select("type, from_stage, to_stage").eq("work_order_id", job!.workOrderId).order("created_at");
    const events = (ev ?? []) as { type: string; from_stage: string | null; to_stage: string | null }[];
    expect(events.filter((e) => e.type === "qa_fail").length).toBe(1);
    expect(events.filter((e) => e.type === "qa_pass").length).toBe(1);
    const moves = events.filter((e) => e.type === "stage_changed").map((e) => `${e.from_stage}>${e.to_stage}`);
    expect(moves).toContain("qa>in_progress");
    expect(moves.filter((m) => m === "completion_prep>qa").length).toBe(2);
    expect(moves[moves.length - 1]).toBe("qa>walkthrough");
  });
});
