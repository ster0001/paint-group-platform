import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/** Screenshot walk for the 4 Sep materials batch — not a gate; run by hand. */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const OUT = process.env.LOOK_OUT ?? "/tmp";
let f: LoopFixture | null = null;
let intakeId = "";
let unmatchedId = "";

test.describe("look — materials", () => {
  test.skip(!contractor || !staff || !db, "creds");
  test.beforeAll(async () => {
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    f = await createLoopFixture(db!, cid, [{ heading: "Lounge", labels: ["Walls", "Ceiling"] }]);
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", f.workOrderId).maybeSingle();
    const snap = (w as { wo_snapshot: Record<string, unknown> }).wo_snapshot;
    await db!.from("work_orders").update({
      wo_snapshot: {
        ...snap, jobAddress: "7 Ocean St, Ormond",
        materials: [
          { product: "Wash & Wear Low Sheen", colourKey: "Wash & Wear Low Sheen||Natural White", photoUrl: "", litres: 15, coverageMissing: false, colourName: "Natural White", colourHex: "#F1EDE4", colourStatus: "confirmed" },
          { product: "Wash & Wear Low Sheen", colourKey: "Wash & Wear Low Sheen||Domino", photoUrl: "", litres: 4, coverageMissing: false, colourName: "Domino", colourHex: "#2A2E33", colourStatus: "tbc" },
          { product: "Aquanamel Gloss", photoUrl: "", litres: 2, coverageMissing: false, colourName: "", colourHex: "", colourStatus: "tbc", colourMatch: { required: true, code: "", brand: "", canSize: "" } },
        ],
        areas: [{ id: "a0", title: "Lounge", finishCode: "PG-3", finishOverridden: false, photos: [], surfaces: [
          { key: "a0:0", label: "Walls", coats: 2, product: "Wash & Wear Low Sheen", colourKey: "Wash & Wear Low Sheen||Natural White", colourName: "Natural White", colourHex: "#F1EDE4", prep: "", hours: 1, status: "not_started" },
          { key: "a0:1", label: "Ceiling", coats: 2, product: "Wash & Wear Low Sheen", colourKey: "Wash & Wear Low Sheen||Domino", colourName: "Domino", colourHex: "#2A2E33", prep: "", hours: 1, status: "not_started" },
          { key: "a0:2", label: "Doors", coats: 2, product: "Aquanamel Gloss", prep: "", hours: 1, status: "not_started" },
        ] }],
      },
    }).eq("id", f.workOrderId);
    await db!.from("material_costs").insert({ work_order_id: f.workOrderId, supplier: "Haymes Moorabbin", order_ref: "PG-0007", amount_cents: 41280, invoice_date: "2026-09-01", source: "email", matched_by: "manual", matched_at: new Date().toISOString() });
    const { data: um } = await db!.from("material_costs").insert({ work_order_id: null, supplier: "Dulux Trade", order_ref: "", address_text: "Ocean St", amount_cents: 18700, invoice_date: "2026-09-03", source: "email" }).select("id").single();
    unmatchedId = (um as { id: string }).id;
    const { data: ci } = await db!.from("cost_intake").insert({
      source: "manual", message_id: `look-${Date.now()}`, from_email: "accounts@haymes.com.au", subject: "Tax invoice 88214",
      extracted: { supplier: "Haymes Paint", invoice_no: "88214", invoice_date: "2026-09-02", total_cents: 145000, gst_cents: 13182, subtotal_ex_cents: 131818, order_ref: "7 Ocean St", confidence: {} },
      extract_status: "extracted", status: "pending", proposed_wo_id: f.workOrderId, match_reason: "address",
    }).select("id").single();
    intakeId = (ci as { id: string }).id;
  });
  test.afterAll(async () => {
    if (intakeId) await db!.from("cost_intake").delete().eq("id", intakeId);
    if (unmatchedId) await db!.from("material_costs").delete().eq("id", unmatchedId);
    await destroyLoopFixture(db!, f);
  });

  test("shots", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 1400 });
    await signIn(page, staff!, /estimates/);
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    const card = page.getByTestId("materials-card");
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${OUT}/pc-materials-card.png` });
    await card.getByTestId("material-edit-Wash & Wear Low Sheen||Domino").click();
    await card.screenshot({ path: `${OUT}/pc-materials-edit.png` });

    await page.goto("/invoicing?tab=pay");
    const intake = page.getByTestId(`intake-${intakeId}`);
    await expect(intake).toBeVisible();
    await intake.getByTestId(`confirm-${intakeId}`).click();
    await intake.screenshot({ path: `${OUT}/pay-confirm-chosen.png` });
    await intake.getByTestId(`job-search-${intakeId}-change`).click();
    await intake.getByTestId(`job-search-${intakeId}`).fill("ocean");
    await expect(intake.getByTestId(`job-search-${intakeId}-list`)).toBeVisible();
    await page.screenshot({ path: `${OUT}/pay-confirm-search.png`, fullPage: false });
    await intake.getByTestId(`job-search-${intakeId}-opt-${f!.workOrderId}`).click();
    await expect(intake.getByTestId(`job-search-${intakeId}-chosen`)).toContainText("Ocean St");
    await intake.getByTestId(`category-${intakeId}`).selectOption("materials");
    await intake.screenshot({ path: `${OUT}/pay-confirm-materials.png` });

    const un = page.getByTestId("unmatched-materials");
    await un.getByTestId(`assign-${unmatchedId}`).click();
    await un.getByTestId(`assign-search-${unmatchedId}`).fill("7 ocean");
    await expect(un.getByTestId(`assign-search-${unmatchedId}-list`)).toBeVisible();
    await un.screenshot({ path: `${OUT}/pay-assign-search.png` });
    await un.getByTestId(`assign-search-${unmatchedId}-opt-${f!.workOrderId}`).click();
    await expect(page.getByTestId("costs-message")).toContainText("Matched");
    // the PC budget moved: $412.80 + $187.00 inc = $599.80 → $545 ex
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    await expect(page.getByTestId("materials-invoiced-amount")).toHaveText("$545");
    await page.getByTestId("materials-card").screenshot({ path: `${OUT}/pc-materials-after-match.png` });
  });
});
