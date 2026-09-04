import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 4 Sep 2026 — the Materials section on the PC job page (needs
 * 20261231 live):
 *   · the colour breakdown per substrate, editable: a colour saved here lands
 *     on the frozen job sheet (materials AND the surfaces painted in it) and
 *     in work_orders.colours, so the painter's sheet reads the same;
 *   · the materials budget vs invoiced, which moves the moment a supplier
 *     invoice is matched to the job.
 * The RPC's own gates are proven by direct calls (staff only, closed refused,
 * unknown row refused).
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let f: LoopFixture | null = null;
const WHITE = "Wash & Wear Low Sheen||Vivid White";

test.describe("PC materials — colours per substrate + budget", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    f = await createLoopFixture(db!, cid, [{ heading: "Lounge", labels: ["Walls", "Ceiling"] }]);
    // Two colours of one product plus a legacy (bare-product) row, with the
    // per-surface colour truth on the sheet the way the builder freezes it.
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", f.workOrderId).maybeSingle();
    const snap = (w as { wo_snapshot: Record<string, unknown> }).wo_snapshot;
    await db!.from("work_orders").update({
      wo_snapshot: {
        ...snap,
        materials: [
          { product: "Wash & Wear Low Sheen", colourKey: WHITE, photoUrl: "", litres: 10, coverageMissing: false,
            colourName: "Vivid White", colourHex: "#F4F4F0", colourStatus: "tbc" },
          { product: "Wash & Wear Low Sheen", colourKey: "Wash & Wear Low Sheen||Domino", photoUrl: "", litres: 4, coverageMissing: false,
            colourName: "Domino", colourHex: "#2A2E33", colourStatus: "confirmed" },
          { product: "Aquanamel Gloss", photoUrl: "", litres: null, coverageMissing: true, colourName: "", colourHex: "", colourStatus: "tbc" },
        ],
        areas: [{
          id: "a0", title: "Lounge", finishCode: "PG-3", finishOverridden: false, photos: [],
          surfaces: [
            { key: "a0:0", label: "Walls", coats: 2, product: "Wash & Wear Low Sheen", colourKey: WHITE, colourName: "Vivid White", colourHex: "#F4F4F0", prep: "", hours: 1, status: "not_started" },
            { key: "a0:1", label: "Ceiling", coats: 2, product: "Wash & Wear Low Sheen", colourKey: "Wash & Wear Low Sheen||Domino", colourName: "Domino", colourHex: "#2A2E33", prep: "", hours: 1, status: "not_started" },
            { key: "a0:2", label: "Doors", coats: 2, product: "Aquanamel Gloss", prep: "", hours: 1, status: "not_started" },
          ],
        }],
      },
    }).eq("id", f.workOrderId);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, f); });

  test("the breakdown lists each colour with the substrates painted in it", async ({ page }) => {
    await signIn(page, staff!, /estimates/);
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    const card = page.getByTestId("materials-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("materials-summary")).toContainText("1 of 3 colours confirmed");
    await expect(card.getByTestId(`material-substrates-${WHITE}`)).toContainText("Lounge · Walls · 2c");
    await expect(card.getByTestId("material-substrates-Wash & Wear Low Sheen||Domino")).toContainText("Lounge · Ceiling · 2c");
    // the legacy row matches its surfaces by product
    await expect(card.getByTestId("material-substrates-Aquanamel Gloss")).toContainText("Lounge · Doors · 2c");
    await expect(card.getByTestId("material-colour-Aquanamel Gloss")).toContainText("Colour TBC");
    // no priced scope on a fixture → no fabricated budget, nothing invoiced
    await expect(card.getByTestId("materials-budget-amount")).toHaveText("—");
    await expect(card.getByTestId("materials-invoiced-amount")).toHaveText("$0");
  });

  test("adjusting a colour rewrites the job sheet — the row, its surfaces and the colours map", async ({ page }) => {
    await signIn(page, staff!, /estimates/);
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    const card = page.getByTestId("materials-card");
    await card.getByTestId(`material-edit-${WHITE}`).click();
    await card.getByTestId(`material-name-${WHITE}`).fill("Natural White");
    await card.getByTestId(`material-hex-${WHITE}`).fill("#F1EDE4");
    await card.getByTestId(`material-litres-${WHITE}`).fill("15");
    await card.getByTestId(`material-confirmed-${WHITE}`).check();
    await card.getByTestId(`material-save-${WHITE}`).click();
    await expect(card.getByTestId("materials-msg")).toContainText("job sheet");

    // The page re-reads the frozen sheet: new colour, confirmed, 15 L.
    await expect(card.getByTestId(`material-colour-${WHITE}`)).toContainText("Natural White");
    await expect(card.getByTestId(`material-status-${WHITE}`)).toContainText("Confirmed");
    await expect(card.getByTestId(`material-${WHITE}`)).toContainText("15 L");
    await expect(card.getByTestId("materials-summary")).toContainText("2 of 3 colours confirmed");

    const { data: w } = await db!.from("work_orders").select("wo_snapshot, colours").eq("id", f!.workOrderId).maybeSingle();
    const row = w as {
      wo_snapshot: { materials: { colourKey?: string; colourName: string; colourHex: string; colourStatus: string; litres: number | null }[];
                     areas: { surfaces: { label: string; colourName?: string; colourHex?: string }[] }[] };
      colours: Record<string, { name?: string; hex?: string; status?: string }>;
    };
    const white = row.wo_snapshot.materials.find((m) => m.colourKey === WHITE)!;
    expect(white).toMatchObject({ colourName: "Natural White", colourHex: "#F1EDE4", colourStatus: "confirmed", litres: 15 });
    // the other rows untouched
    expect(row.wo_snapshot.materials.find((m) => m.colourKey === "Wash & Wear Low Sheen||Domino")).toMatchObject({ colourName: "Domino" });
    // the surfaces painted in that colour follow; the others don't
    const s = row.wo_snapshot.areas[0].surfaces;
    expect(s.find((x) => x.label === "Walls")).toMatchObject({ colourName: "Natural White", colourHex: "#F1EDE4" });
    expect(s.find((x) => x.label === "Ceiling")).toMatchObject({ colourName: "Domino" });
    expect(s.find((x) => x.label === "Doors")!.colourName).toBeUndefined();
    // and the live colours map mirrors it under the same key
    expect(row.colours[WHITE]).toMatchObject({ name: "Natural White", hex: "#F1EDE4", status: "confirmed" });
    // the event trail
    const { data: ev } = await db!.from("wo_events").select("type, meta").eq("work_order_id", f!.workOrderId).eq("type", "material_edited");
    expect(ev ?? []).toHaveLength(1);
  });

  test("the budget moves as material invoices are matched to the job", async ({ page }) => {
    // Two supplier invoices land on the job (what Payables' match does).
    const { data: ins, error } = await db!.from("material_costs").insert([
      { work_order_id: f!.workOrderId, supplier: "Haymes Moorabbin", order_ref: "PG-TEST", amount_cents: 44000, invoice_date: "2026-09-01", source: "email", matched_by: "manual", matched_at: new Date().toISOString() },
      { work_order_id: f!.workOrderId, supplier: "Dulux Trade", order_ref: "", amount_cents: 22000, invoice_date: "2026-09-02", source: "manual", matched_by: "manual", matched_at: new Date().toISOString() },
    ]).select("id");
    expect(error).toBeNull();
    expect(ins ?? []).toHaveLength(2);

    await signIn(page, staff!, /estimates/);
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    const card = page.getByTestId("materials-card");
    // $660 inc GST → $600 ex GST against the (absent) budget
    await expect(card.getByTestId("materials-invoiced-amount")).toHaveText("$600");
    await expect(card.getByTestId("materials-budget")).toContainText("Invoices total $660 inc GST");
    await expect(card.getByTestId("materials-invoices")).toContainText("Haymes Moorabbin · PG-TEST");
    await expect(card.getByTestId("materials-invoices")).toContainText("Dulux Trade");
  });

  test("the RPC's gates: staff only, unknown row refused, closed job refused", async () => {
    const args = { p_work_order_id: f!.workOrderId, p_row_key: WHITE, p_colour_name: "X", p_colour_hex: "", p_status: "tbc", p_litres: null };
    expect(await rpcAs(contractor!, "wo_set_material", args)).toBe("error:not_staff");
    expect(await rpcAs(staff!, "wo_set_material", { ...args, p_row_key: "Ghost" })).toBe("error:no_such_material");
    expect(await rpcAs(staff!, "wo_set_material", { ...args, p_colour_hex: "red" })).toBe("error:bad_hex");
    expect(await rpcAs(staff!, "wo_set_material", { ...args, p_status: "maybe" })).toBe("error:bad_status");
    await db!.from("work_orders").update({ stage: "closed" }).eq("id", f!.workOrderId);
    expect(await rpcAs(staff!, "wo_set_material", args)).toBe("error:closed");
    await db!.from("work_orders").update({ stage: "in_progress" }).eq("id", f!.workOrderId);
  });
});
