import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * The scope photos pinned to an area of the work order open big, and the set
 * walks left and right — with the arrows, the keyboard, and a swipe.
 *
 * They were 72px tiles a painter could not enlarge (Tom, 16 Sep). The lightbox
 * is the one the site-photo grid already used; this checks the area strip is
 * wired into it on the contractor's own job page, and that a horizontal swipe
 * moves the set while a tap still closes.
 */

const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

// Two 1×1 PNGs, red then blue, so "which photo is showing" is a plain src check.
const RED = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const BLUE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==";

let fixture: LoopFixture | null = null;

test.describe("area photos on the contractor's work order", () => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    if (!contractorId) throw new Error("no contractors row for the e2e contractor");
    fixture = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls", "Trims"] }]);

    const { data } = await db!.from("work_orders").select("wo_snapshot").eq("id", fixture.workOrderId).single();
    const snap = (data as { wo_snapshot: { areas: { photos: string[] }[] } }).wo_snapshot;
    snap.areas[0].photos = [RED, BLUE];
    const { error } = await db!.from("work_orders").update({ wo_snapshot: snap }).eq("id", fixture.workOrderId);
    if (error) throw new Error(`fixture photos: ${error.message}`);
  });
  test.afterAll(async () => { await destroyLoopFixture(db!, fixture); });

  test("tap enlarges; arrows, keys and a swipe walk the set; tap the backdrop to close", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);

    const strip = page.getByTestId("area-photos");
    await expect(strip).toBeVisible();
    await expect(strip.getByTestId("area-photo")).toHaveCount(2);

    await strip.getByTestId("area-photo").first().click();
    const box = page.getByTestId("photo-lightbox");
    await expect(box).toBeVisible();
    await expect(box.getByTestId("lightbox-image")).toHaveAttribute("src", RED);
    await expect(box).toContainText("1 / 2");
    await expect(box).toContainText("Front");

    // Arrow button.
    await box.getByTestId("lightbox-next").click();
    await expect(box.getByTestId("lightbox-image")).toHaveAttribute("src", BLUE);
    await expect(box).toContainText("2 / 2");

    // Keyboard.
    await page.keyboard.press("ArrowLeft");
    await expect(box.getByTestId("lightbox-image")).toHaveAttribute("src", RED);

    // A swipe from right to left — a thumb on a phone — goes forward.
    await swipe(page, -160, 0);
    await expect(box.getByTestId("lightbox-image")).toHaveAttribute("src", BLUE);
    // A short or mostly vertical drag is not a swipe; nothing moves.
    await swipe(page, 20, 0);
    await swipe(page, -60, 140);
    await expect(box.getByTestId("lightbox-image")).toHaveAttribute("src", BLUE);
    // Back the other way.
    await swipe(page, 160, 0);
    await expect(box.getByTestId("lightbox-image")).toHaveAttribute("src", RED);

    await page.screenshot({ path: process.env.E2E_SHOT ?? "test-results/area-photo-lightbox.png" });

    // The image itself does not close; the backdrop does.
    await box.getByTestId("lightbox-image").click();
    await expect(box).toBeVisible();
    await box.click({ position: { x: 10, y: 300 } });
    await expect(box).toHaveCount(0);
  });
});

/** Fire the touch pair the lightbox listens for, starting mid-screen. */
async function swipe(page: import("@playwright/test").Page, dx: number, dy: number) {
  await page.getByTestId("photo-lightbox").evaluate((el, { dx, dy }) => {
    const mk = (x: number, y: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    const fire = (type: string, t: Touch) =>
      el.dispatchEvent(new TouchEvent(type, { touches: type === "touchend" ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
    fire("touchstart", mk(300, 300));
    fire("touchend", mk(300 + dx, 300 + dy));
  }, { dx, dy });
}
