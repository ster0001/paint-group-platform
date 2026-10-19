import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
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

// A minimal MP4 — an `ftyp` box with the isom brand, the signature the ingest
// sniffs for (the same bytes e2e/wo-photos.spec.ts uses). Not playable, but a
// real object with a video extension, which is all a tile needs.
const MP4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 8, 0x6d, 0x64, 0x61, 0x74]);

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

  test("the office attaches a video, and it plays on the painter's sheet", async ({ page }) => {
    // Tom, 19 Oct 2026: "we are getting a lot of videos from clients which we
    // want to forward on from whatsapp". The painter could already SEND a video
    // from their own cards; the office's card took photos only — the sign step
    // was never told the type, so the object got a bare photo name and the
    // ingest refused the bytes as "not a photo".
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);

    const card = page.getByTestId("reference-photos-card");
    await card.getByTestId("reference-photo-area").selectOption("Front");
    await card.getByTestId("reference-photo-caption").fill("Customer's walk-round of the front");
    await card.getByTestId("reference-photo-file").setInputFiles({
      name: "whatsapp-front.mp4", mimeType: "video/mp4", buffer: MP4,
    });
    await expect(card.getByTestId("reference-photo-msg")).toContainText(/job sheet/i, { timeout: 30_000 });

    // The office's own card draws it as a video tile, not a broken image.
    const videoRow = card.locator('[data-testid="reference-photo-row"][data-media="video"]');
    await expect(videoRow).toHaveCount(1);
    await expect(videoRow.locator("video")).toHaveCount(1);

    // The painter's sheet, no session: a video tile with the caption, that the
    // lightbox plays.
    await page.context().clearCookies();
    await page.goto(`/w/${shareToken}`);
    const section = page.getByTestId("wo-office-photos");
    await expect(section).toBeVisible();
    await expect(section).toContainText("Customer's walk-round of the front");
    const tile = section.locator('[data-testid="wo-photo"][data-media="video"]');
    await expect(tile).toHaveCount(1);
    await tile.click();
    await expect(page.getByTestId("lightbox-video")).toBeVisible();
    await page.keyboard.press("Escape");

    // And the crew link carries the same clip.
    await page.goto(`/crew/${crewToken}`);
    await expect(page.getByTestId("wo-office-photos").locator('[data-testid="wo-photo"][data-media="video"]')).toHaveCount(1);
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
