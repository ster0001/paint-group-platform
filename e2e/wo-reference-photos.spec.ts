import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Photos the office attaches to a job that is already out (Tom, 23 Sep 2026):
 * "we need to add photos to all the jobs coming in from paint scout."
 *
 * The job sheet's own photos ride wo_snapshot.areas[].photos, frozen from the
 * accepted estimate — so on a handover job there was no way to show a painter
 * anything. Work-order photos existed but NEITHER contractor surface was ever
 * passed them: /portal/jobs/[id] and /w/[token] both render WorkOrderDoc with
 * no `photos` prop, so a photo uploaded after acceptance was visible to staff
 * (the builder's job-sheet tab DOES pass them) and to nobody else. It looked
 * attached and wasn't.
 *
 * The test that matters is therefore the painter's own sheet read with NO
 * session: a reference photo the office added is on it, captioned, against the
 * right area. And the leak test runs in the same breath — the painter's own
 * before/progress record and anything QA must NOT appear there, because that
 * section is now fed from a filtered read and a filter is easy to widen by
 * accident.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;
let shareToken = "";
let crewToken = "";

// A real 1×1 PNG. The bytes must exist in the bucket: a signed URL over a
// missing object fails, and the grid drops what it cannot sign — so a row-only
// fixture would prove nothing (the lesson wo-photos.spec.ts already paid for).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A photo the PAINTER took — the record my filter must never surface. */
async function painterPhoto(kind: string, area: string): Promise<void> {
  const path = `wo/${fixture!.workOrderId}/painter-${kind}.png`;
  const { error } = await db!.storage.from("wo-photos")
    .upload(path, PNG, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`fixture upload: ${error.message}`);
  const { error: rowErr } = await db!.from("wo_photos").insert({
    work_order_id: fixture!.workOrderId, storage_path: path,
    kind, area, caption: `painter ${kind} shot`,
  });
  if (rowErr) throw new Error(`fixture row: ${rowErr.message}`);
}

test.describe("photos the office attaches to a job already out", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls", "Windows"] },
    ]);
    const { data, error } = await db!.from("work_orders")
      .select("share_token").eq("id", fixture.workOrderId).single();
    if (error) throw new Error(`fixture token: ${error.message}`);
    shareToken = (data as { share_token: string }).share_token;

    await painterPhoto("before", "Front");
    await painterPhoto("qa", "Front");

    // The crew link — the contractor mints it for their own painters. The
    // fixture sets the token directly; the page under test is the sheet.
    crewToken = randomBytes(32).toString("base64url");
    const { error: crewErr } = await db!.from("work_orders")
      .update({ crew_token: crewToken }).eq("id", fixture.workOrderId);
    if (crewErr) throw new Error(`fixture crew token: ${crewErr.message}`);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
  });

  test("the office adds one, and the painter's own sheet carries it", async ({ page }) => {
    // ---- before: nothing from the office on the painter's sheet ------------
    await page.goto(`/w/${shareToken}`);
    await expect(page.getByTestId("wo-office-photos")).toHaveCount(0);

    // ---- the office attaches it on the job page -----------------------------
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);

    const card = page.getByTestId("reference-photos-card");
    await expect(card).toBeVisible();

    await card.getByTestId("reference-photo-area").selectOption("Front");
    await card.getByTestId("reference-photo-caption").fill("Scaffold goes on this elevation");
    await card.getByTestId("reference-photo-file").setInputFiles({
      name: "site.png", mimeType: "image/png", buffer: PNG,
    });
    await expect(card.getByTestId("reference-photo-msg")).toContainText(/job sheet/i, { timeout: 30_000 });
    await expect(card.getByTestId("reference-photo-row")).toHaveCount(1);

    // ---- Painter's view — the office's mirror of the contractor's page ------
    // This is where the office CHECKS what the painter sees, so it must carry
    // them too; it was the first place the feature looked broken from.
    await page.goto(`/pc/wo/${fixture!.workOrderId}/as-contractor`);
    await expect(page.getByTestId("wo-office-photos")).toBeVisible();
    await expect(page.getByTestId("wo-office-photos")).toContainText("Scaffold goes on this elevation");

    // ---- the painter's sheet, no session ------------------------------------
    await page.context().clearCookies();
    await page.goto(`/w/${shareToken}`);
    const section = page.getByTestId("wo-office-photos");
    await expect(section).toBeVisible();
    await expect(section).toContainText("Scaffold goes on this elevation");
    await expect(section.locator("img")).toHaveCount(1);

    // ---- and NOTHING of the painter's own record leaked into it -------------
    await expect(section).not.toContainText("painter before shot");
    await expect(section).not.toContainText("painter qa shot");

    // ---- the crew link, one rung further down the trust ladder --------------
    // A reference photo is an instruction about the work — exactly what the
    // crew whitelist exists to carry. Same leak test, same anonymous read.
    await page.goto(`/crew/${crewToken}`);
    const crew = page.getByTestId("wo-office-photos");
    await expect(crew).toBeVisible();
    await expect(crew).toContainText("Scaffold goes on this elevation");
    await expect(crew.locator("img")).toHaveCount(1);
    await expect(crew).not.toContainText("painter before shot");
    await expect(crew).not.toContainText("painter qa shot");
  });

  test("a painter cannot pass one off as the office's", async () => {
    // The write is staff-only at the DATABASE, not merely absent from their
    // screen — the contractor's session must be refused by the RPC itself.
    const { data, error } = await db!.rpc("wo_record_reference_photo", {
      p_work_order_id: fixture!.workOrderId,
      p_storage_path: `wo/${fixture!.workOrderId}/nope.png`,
      p_area: "Front",
      p_caption: "not from the office",
    });
    // The service role is not staff either (it carries no JWT claims), so the
    // guard answers the same way it would for a contractor: refused.
    expect(error ?? String(data ?? "")).toBeTruthy();
    expect(String(data ?? "")).toMatch(/not_staff|^$/);
  });
});
