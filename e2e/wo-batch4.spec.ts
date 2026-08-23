import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 23 Aug (batch 4) — needs 20261109 + 20261110 live:
 *   · "walkthrough not required": prep confirmed (no check) → CLOSED; or the
 *     last QA pass → CLOSED; record written (signoff row, warranty, invoice stub);
 *   · colour match: a flagged product with no code gates the hand-over until
 *     the painter supplies it; "No" on the colours question opens uncoloured
 *     products too;
 *   · pre-start: "Pre-start checklist" ticked → the sweep emails (here: no
 *     customer email on the fixture → a skipped event, which proves the path).
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET;

let noWalk: LoopFixture | null = null;   // prep → closed, no QA (established path via flag off)
let qaWalk: LoopFixture | null = null;   // QA pass → closed
let cm: LoopFixture | null = null;       // colour-match gate

async function allDone(f: LoopFixture) {
  await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
}

async function passAll(workOrderId: string) {
  const { data: checks } = await db!.from("wo_qa_checks").select("id").eq("work_order_id", workOrderId);
  let last = "";
  for (const c of (checks ?? []) as { id: string }[]) {
    const { data: items } = await db!.from("wo_qa_items").select("id").eq("qa_check_id", c.id);
    for (const item of (items ?? []) as { id: string }[]) await rpcAs(staff!, "wo_tick_qa_item", { p_item_id: item.id, p_done: true });
    last = await rpcAs(staff!, "wo_record_qa", { p_check_id: c.id, p_result: "pass", p_notes: "e2e", p_rectify: [] });
  }
  return last;
}

test.describe("batch 4 — no walkthrough, colour match, pre-start list", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    noWalk = await createLoopFixture(db!, cid, [{ heading: "Front", labels: ["Walls"] }]);
    qaWalk = await createLoopFixture(db!, cid, [{ heading: "Back", labels: ["Walls"] }]);
    cm = await createLoopFixture(db!, cid, [{ heading: "Side", labels: ["Walls"] }]);
    for (const f of [noWalk!, qaWalk!, cm!]) await allDone(f);
    // A colour-matched product with no code on the snapshot, plus an uncoloured one.
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", cm!.workOrderId).maybeSingle();
    const snap = (w as { wo_snapshot: Record<string, unknown> }).wo_snapshot;
    await db!.from("work_orders").update({
      wo_snapshot: {
        ...snap,
        materials: [
          { product: "Weathershield Low Sheen", photoUrl: "", litres: 10, coverageMissing: false, colourName: "Lexicon Quarter", colourHex: "#eee", colourStatus: "confirmed",
            colourMatch: { required: true, code: "", brand: "", canSize: "" } },
          { product: "Aquanamel Gloss", photoUrl: "", litres: 4, coverageMissing: false, colourName: "", colourHex: "", colourStatus: "tbc" },
        ],
      },
    }).eq("id", cm!.workOrderId);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, noWalk);
    await destroyLoopFixture(db!, qaWalk);
    await destroyLoopFixture(db!, cm);
  });

  test("walkthrough not required: prep confirmed closes the job, with the record a signing writes", async () => {
    // The fixture contractor is NEW (QA due) — disable QA for this job by passing nothing? No:
    // make it the no-QA path by marking the job's checks passed before the confirm.
    expect(await rpcAs(contractor!, "wo_set_walkthrough_required", { p_work_order_id: noWalk!.workOrderId, p_required: false })).toBe("error:not_staff");
    expect(await rpcAs(staff!, "wo_set_walkthrough_required", { p_work_order_id: noWalk!.workOrderId, p_required: false })).toBe("ok:false");

    await completePrep(db!, staff!, noWalk!.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: noWalk!.workOrderId })).toMatch(/^ok:completion_prep/);
    // Settle the cadence check so the confirm takes the no-check branch.
    await db!.from("wo_qa_checks").update({ result: "pass" }).eq("work_order_id", noWalk!.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: noWalk!.workOrderId })).toBe("ok:closed");

    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", noWalk!.workOrderId).maybeSingle();
    expect((wo as { stage: string }).stage).toBe("closed");
    const { data: so } = await db!.from("wo_signoff").select("signed_kind, signed_name, report").eq("work_order_id", noWalk!.workOrderId).maybeSingle();
    expect((so as { signed_kind: string }).signed_kind).toBe("no_walkthrough");
    expect((so as { report: { signed_kind?: string } }).report?.signed_kind).toBe("no_walkthrough");
    const { data: warranty } = await db!.from("warranties").select("signed_kind").eq("work_order_id", noWalk!.workOrderId);
    expect((warranty ?? []).length).toBe(1);
    const { data: ev } = await db!.from("wo_events").select("id").eq("work_order_id", noWalk!.workOrderId).eq("type", "closed_without_walkthrough");
    expect((ev ?? []).length).toBe(1);
  });

  test("walkthrough not required + QA due: the last pass closes the job", async () => {
    expect(await rpcAs(staff!, "wo_set_walkthrough_required", { p_work_order_id: qaWalk!.workOrderId, p_required: false })).toBe("ok:false");
    await completePrep(db!, staff!, qaWalk!.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: qaWalk!.workOrderId })).toBe("ok:completion_prep:qa_pending");
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: qaWalk!.workOrderId })).toBe("ok:qa");
    expect(await passAll(qaWalk!.workOrderId)).toMatch(/^ok:pass:closed/);
    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", qaWalk!.workOrderId).maybeSingle();
    expect((wo as { stage: string }).stage).toBe("closed");
  });

  test("colour match gates the hand-over until the painter supplies the codes", async ({ page }) => {
    // Answer the colours question NO on the pre-start list (opens the uncoloured product too).
    await rpcAs(staff!, "wo_seed_checklists", { p_work_order_id: cm!.workOrderId });
    const { data: colours } = await db!.from("wo_checklist_items").select("id")
      .eq("work_order_id", cm!.workOrderId).eq("phase", "pre_start").eq("item_key", "colours").maybeSingle();
    expect(await rpcAs(staff!, "wo_answer_checklist_item", { p_item_id: (colours as { id: string }).id, p_answer: "no", p_note: "" })).toBe("ok:no");
    expect(await rpcAs(staff!, "wo_colour_match_outstanding", { p_work_order_id: cm!.workOrderId }))
      .toBe("Aquanamel Gloss, Weathershield Low Sheen");

    await completePrep(db!, staff!, cm!.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: cm!.workOrderId })).toMatch(/^ok:completion_prep/);
    await db!.from("wo_qa_checks").update({ result: "pass" }).eq("work_order_id", cm!.workOrderId);
    const blocked = await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: cm!.workOrderId });
    expect(blocked).toMatch(/^error:gate:colour match codes still needed for/);

    // The painter supplies them on their job page.
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${cm!.workOrderId}`);
    await expect(page.getByTestId("colour-match-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("colour-match-state-Weathershield Low Sheen")).toContainText(/colour match required/i);
    await page.getByTestId("cm-code-Weathershield Low Sheen").fill("P23H4");
    await page.getByTestId("cm-brand-Weathershield Low Sheen").fill("Dulux");
    await page.getByTestId("cm-can-Weathershield Low Sheen").fill("10 L");
    await page.getByTestId("cm-save-Weathershield Low Sheen").click();
    await expect(page.getByTestId("colour-match-msg")).toContainText(/saved/i, { timeout: 15_000 });
    expect(await rpcAs(staff!, "wo_set_colour_match", { p_work_order_id: cm!.workOrderId, p_product: "Aquanamel Gloss", p_code: "SW7006", p_brand: "Sherwin", p_can_size: "4 L" })).toBe("ok");
    expect(await rpcAs(staff!, "wo_colour_match_outstanding", { p_work_order_id: cm!.workOrderId })).toBe("");

    // Gate clear — the hand-over goes through.
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: cm!.workOrderId })).toBe("ok:walkthrough");
  });

  test("pre-start list: six items; 'Pre-start checklist' ticked → the sweep sends (or records why not)", async ({ request }) => {
    test.skip(!SECRET, "CRON_SECRET not set — the sweep cannot be called");
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    const f = await createLoopFixture(db!, cid, [{ heading: "Rear", labels: ["Walls"] }]);
    try {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
      const t = new Date(`${today}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1);
      await db!.from("work_orders").update({ stage: "pre_start", start_date: t.toISOString().slice(0, 10) }).eq("id", f.workOrderId);
      await rpcAs(staff!, "wo_seed_checklists", { p_work_order_id: f.workOrderId });
      const { data: pre } = await db!.from("wo_checklist_items").select("id, item_key, required, kind, auto_key")
        .eq("work_order_id", f.workOrderId).eq("phase", "pre_start");
      const rows = (pre ?? []) as { id: string; item_key: string | null; required: boolean; kind: string; auto_key: string | null }[];
      expect(rows.length).toBe(6);
      expect(rows.some((r) => r.auto_key === "qa")).toBe(false);
      const checklist = rows.find((r) => r.item_key === "pre_start_checklist")!;
      expect(checklist.required).toBe(false);
      expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: checklist.id, p_done: true })).toBe("ok:done");

      const response = await request.get("/api/cron/wo-sweep", { headers: { Authorization: `Bearer ${SECRET}` } });
      expect(response.status()).toBe(200);
      const { data: ev } = await db!.from("wo_events").select("type, meta").eq("work_order_id", f.workOrderId)
        .in("type", ["pre_start_checklist_sent", "pre_start_checklist_skipped"]);
      // The fixture estimate has no customer email, so the path records a skip — and exactly one.
      expect((ev ?? []).length).toBe(1);
      expect(((ev ?? [])[0] as { type: string }).type).toBe("pre_start_checklist_skipped");
      // A second sweep does not write a second event.
      await request.get("/api/cron/wo-sweep", { headers: { Authorization: `Bearer ${SECRET}` } });
      const { data: ev2 } = await db!.from("wo_events").select("id").eq("work_order_id", f.workOrderId)
        .in("type", ["pre_start_checklist_sent", "pre_start_checklist_skipped"]);
      expect((ev2 ?? []).length).toBe(1);
    } finally {
      await destroyLoopFixture(db!, f);
    }
  });
});
