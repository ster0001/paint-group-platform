import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 8 Oct 2026 — two PC Command asks on the job page:
 *
 *  1. "When adjusting colours for a project in PC Command, please allow to be
 *     able to choose from our list of colours saved." The Materials card's
 *     "Adjust colour / litres" form gains the builder's own colour library
 *     (app/components/ColourPicker — the `colours` table), and typing a name
 *     by hand still works.
 *
 *  2. "Please add the 'further instructions for the crew' into the PC Command,
 *     to write and save instructions for the crew which are updated in the
 *     work order." work_orders.crew_notes is the one place it lives; the job
 *     sheet the painter reads follows it (20270244), whichever door wrote it.
 *
 * The assertion that matters is the CONTRACTOR'S OWN ANONYMOUS SHEET at
 * /w/[token], read with no session. Staff steps run alongside.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let f: LoopFixture | null = null;
let shareToken = "";
let colourId: string | null = null;
const SUFFIX = Math.random().toString(36).slice(2, 8);
const LIBRARY_NAME = `E2E Harbour Mist ${SUFFIX}`;
const LIBRARY_HEX = "#A7B8BF";
const ROW = "Weathershield"; // the fixture's one material, keyed by product

async function woRow(): Promise<{ crew_notes: string; wo_snapshot: { crewNotes?: string; materials: { colourName: string; colourHex: string }[] } }> {
  const { data, error } = await db!.from("work_orders")
    .select("crew_notes, wo_snapshot").eq("id", f!.workOrderId).single();
  if (error) throw new Error(`read work order: ${error.message}`);
  return data as never;
}

test.describe("PC Command — colour list + further instructions for the crew", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    f = await createLoopFixture(db!, cid, [{ heading: "Front", labels: ["Weatherboards"] }]);
    const { data, error } = await db!.from("work_orders").select("share_token").eq("id", f.workOrderId).single();
    if (error) throw new Error(`fixture token: ${error.message}`);
    shareToken = (data as { share_token: string }).share_token;

    // A colour on the saved list that no other run will have.
    const { data: c, error: cErr } = await db!.from("colours")
      .insert({ brand: "E2E", name: LIBRARY_NAME, hex: LIBRARY_HEX, collection: "e2e" })
      .select("id").single();
    if (cErr) throw new Error(`fixture colour: ${cErr.message}`);
    colourId = (c as { id: string }).id;
  });

  test.afterAll(async () => {
    if (colourId) {
      const { error } = await db!.from("colours").delete().eq("id", colourId);
      if (error) throw new Error(`remove fixture colour: ${error.message}`);
    }
    await destroyLoopFixture(db!, f);
  });

  test("a colour picked from the saved list lands on the painter's sheet", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    const card = page.getByTestId("materials-card");
    await card.getByTestId(`material-edit-${ROW}`).click();

    // The library, searched — the same picker the builder uses.
    await card.getByTestId(`material-library-${ROW}`).click();
    await card.getByTestId(`material-library-${ROW}-search`).fill(`Harbour Mist ${SUFFIX}`);
    await card.getByTestId(`material-library-${ROW}-option`).filter({ hasText: LIBRARY_NAME }).click();

    // Picking fills the free-text fields, which stay editable.
    await expect(card.getByTestId(`material-name-${ROW}`)).toHaveValue(LIBRARY_NAME);
    await expect(card.getByTestId(`material-hex-${ROW}`)).toHaveValue(LIBRARY_HEX);

    await card.getByTestId(`material-save-${ROW}`).click();
    await expect(card.getByTestId("materials-msg")).toContainText("job sheet");
    await expect(card.getByTestId(`material-colour-${ROW}`)).toContainText(LIBRARY_NAME);

    const after = await woRow();
    expect(after.wo_snapshot.materials[0]).toMatchObject({ colourName: LIBRARY_NAME, colourHex: LIBRARY_HEX });

    // The contractor's anonymous sheet.
    await page.context().clearCookies();
    await page.goto(`/w/${shareToken}`);
    await expect(page.getByText(LIBRARY_NAME).first()).toBeVisible();
  });

  test("typing a colour by hand still works alongside the list", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    const card = page.getByTestId("materials-card");
    await card.getByTestId(`material-edit-${ROW}`).click();
    await card.getByTestId(`material-name-${ROW}`).fill("Customer's own mix 42");
    await card.getByTestId(`material-save-${ROW}`).click();
    await expect(card.getByTestId(`material-colour-${ROW}`)).toContainText("Customer's own mix 42");
  });

  test("further instructions written in PC Command reach the work order", async ({ page }) => {
    const NOTE = `Key under the mat — start with the eaves ${SUFFIX}`;

    // Before: nothing on the contractor's sheet.
    await page.goto(`/w/${shareToken}`);
    await expect(page.getByText("Further instructions for the crew")).toHaveCount(0);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    const card = page.getByTestId("crew-notes-card");
    await expect(card).toBeVisible();
    await card.getByTestId("crew-notes-input").fill(NOTE);
    await card.getByTestId("crew-notes-save").click();
    await expect(card.getByTestId("crew-notes-msg")).toContainText(/work order/i);

    // Reload: it is saved, not just typed.
    await page.reload();
    await expect(page.getByTestId("crew-notes-input")).toHaveValue(NOTE);

    // One column, and the sheet the painter reads follows it.
    const after = await woRow();
    expect(after.crew_notes).toBe(NOTE);
    expect(after.wo_snapshot.crewNotes).toBe(NOTE);

    // After: the contractor's anonymous sheet.
    await page.context().clearCookies();
    await page.goto(`/w/${shareToken}`);
    await expect(page.getByText("Further instructions for the crew")).toBeVisible();
    await expect(page.getByText(NOTE)).toBeVisible();
  });

  test("the builder's direct write updates the sheet too — the column is the source", async ({ page }) => {
    // The estimate builder still writes crew_notes straight onto the row
    // (patchWorkOrder). The trigger keeps the issued sheet in step.
    const NOTE = `Edited in the builder ${SUFFIX}`;
    const { error } = await db!.from("work_orders").update({ crew_notes: NOTE }).eq("id", f!.workOrderId);
    expect(error).toBeNull();
    expect((await woRow()).wo_snapshot.crewNotes).toBe(NOTE);

    await page.goto(`/w/${shareToken}`);
    await expect(page.getByText(NOTE)).toBeVisible();
  });

  test("the RPC's gates: staff only, closed job refused, too long refused", async () => {
    const args = { p_work_order_id: f!.workOrderId, p_notes: "x" };
    expect(await rpcAs(contractor!, "wo_set_crew_notes", args)).toBe("error:not_staff");
    expect(await rpcAs(staff!, "wo_set_crew_notes", { ...args, p_notes: "y".repeat(4001) })).toBe("error:too_long");
    await db!.from("work_orders").update({ stage: "closed" }).eq("id", f!.workOrderId);
    expect(await rpcAs(staff!, "wo_set_crew_notes", args)).toBe("error:closed");
    await db!.from("work_orders").update({ stage: "in_progress" }).eq("id", f!.workOrderId);
  });
});
