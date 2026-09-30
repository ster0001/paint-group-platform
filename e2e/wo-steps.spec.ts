import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn, TINY_SIGNATURE_PNG } from "./helpers";
import { completePreStart, contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 30 Sep 2026 — the painter's job in four numbered steps:
 *   1  Upload the before photos — many at once, one Done — and the scope unlocks.
 *   2  Tick the work (Prepped, Done) with no per-side photo prompts.
 *   3  Upload the after photos of all rooms or all sides.
 *   4  Finish — refused by the SERVER, not just the screen, until Step 3 is in.
 * Plus: the question card says it is for questions only.
 * The painter, on a phone-sized screen, through the real upload path.
 */
const db = serviceClient();
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
let fixture: LoopFixture | null = null;
const png = () => Buffer.from(TINY_SIGNATURE_PNG.split(",")[1], "base64");

test.describe("the job in steps (Tom, 30 Sep)", () => {
  test.skip(!db || !contractor || !staff, missingCreds("CONTRACTOR"));
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls", "Windows"] },
      { heading: "Left", labels: ["Eaves"] },
    ]);
    await completePreStart(db!, staff!, fixture.workOrderId);
  });
  test.afterAll(async () => { await destroyLoopFixture(db!, fixture); });

  test("Step 1 unlocks the scope; Step 3 is asked once, at the finish, and the server holds the line", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);

    // Step 1: locked list, one uploader, two photos in one batch.
    await expect(page.getByTestId("job-steps")).toHaveAttribute("data-step", "1");
    await expect(page.getByTestId("tick-locked")).toBeVisible();
    await page.getByTestId("before-input").setInputFiles([
      { name: "front.png", mimeType: "image/png", buffer: png() },
      { name: "left.png", mimeType: "image/png", buffer: png() },
    ]);
    // Tom, 1 Oct: picking IS uploading — no Done press. When the last one
    // lands the page refreshes: the Step 1 card folds away and the list unlocks.
    await expect(page.getByTestId("tick-locked")).toHaveCount(0, { timeout: 90_000 });
    await expect(page.getByTestId("before-more")).toBeVisible();
    await expect(page.getByTestId("job-steps")).toHaveAttribute("data-step", "2");
    const { data: before } = await db!.from("wo_photos").select("id").eq("work_order_id", fixture!.workOrderId).eq("kind", "before");
    expect(before?.length).toBe(2);

    // Step 2: every row ticks, on both sides, with no photo prompt in the way.
    for (const s of fixture!.surfaces) {
      const row = page.getByTestId(`tick-${s.id}`);
      await row.click();
      await expect(row).toContainText("Prepped");
      await row.click();
      await expect(row).toContainText("Done");
    }
    await expect(page.getByTestId("tick-progress")).toHaveText("3 / 3");

    // Step 3 appears; Step 4 is blocked on screen AND on the server.
    await expect(page.getByTestId("after-uploader")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("job-steps")).toHaveAttribute("data-step", "3");
    await expect(page.getByTestId("after-uploader")).toContainText("all rooms or all sides");
    await expect(page.getByTestId("finish-blocked")).toBeVisible();
    await expect(page.getByTestId("finish-job")).toBeDisabled();
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: fixture!.workOrderId })).toBe("error:after_photos_required");

    await page.getByTestId("after-input").setInputFiles([{ name: "after.png", mimeType: "image/png", buffer: png() }]);
    await expect(page.getByTestId("finish-blocked")).toHaveCount(0, { timeout: 90_000 });
    await expect(page.getByTestId("job-steps")).toHaveAttribute("data-step", "4");
    await expect(page.getByTestId("finish-job")).toBeEnabled();

    // The question card says what it is for.
    await expect(page.getByTestId("site-photos-hint")).toContainText("Only add photos here if you have a question");
    await expect(page.getByTestId("photo-kind-completion")).toHaveCount(0);
  });
});
