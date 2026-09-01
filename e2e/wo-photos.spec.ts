import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * What the painter sent in, and what they ticked — as the office sees it.
 *
 * Both of these were written to the database from day one and read by nobody:
 * `wo_photos` rows existed only to answer "has this elevation got a before
 * photo?", and the job sheet rendered the SNAPSHOT's per-surface status, which
 * is frozen at issue and therefore says "Not started" for ever. So these tests
 * put a real object in the bucket and a real tick on a surface, then check the
 * staff screens show them.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;
let variationId = "";
let shareToken = "";
/** False until migration 20261024 is applied — see the skip below. */
let ticksRpcLive = false;

// A 1×1 PNG. The photos must be REAL objects: signing a path whose object does
// not exist fails, and the gallery drops what it cannot sign rather than
// rendering a broken tile — so a row-only fixture would prove nothing.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function putPhoto(
  workOrderId: string,
  name: string,
  row: { kind: string; area?: string; caption?: string },
): Promise<string> {
  const path = `wo/${workOrderId}/${name}.png`;
  const { error } = await db!.storage.from("wo-photos")
    .upload(path, PNG, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`fixture photo upload: ${error.message}`);

  const { data, error: rowErr } = await db!.from("wo_photos").insert({
    work_order_id: workOrderId, storage_path: path,
    kind: row.kind, area: row.area ?? "", caption: row.caption ?? "",
  }).select("id").single();
  if (rowErr) throw new Error(`fixture photo row: ${rowErr.message}`);
  return (data as { id: string }).id;
}

test.describe("site photos and live ticks", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls", "Windows"] },
    ]);

    // The painter's morning: a before photo, and the first surface finished.
    await putPhoto(fixture.workOrderId, "before", { kind: "before", area: "Front", caption: "before start" });
    await db!.from("wo_surfaces").update({ state: "done" })
      .eq("work_order_id", fixture.workOrderId).eq("label", "Walls");

    // And a variation, with the photo that justifies it.
    const { data: v, error } = await db!.from("wo_variations").insert({
      work_order_id: fixture.workOrderId, category: "rot",
      comment: "Three lower boards on the left are soft right through.",
      est_hours: 3, status: "raised",
    }).select("id").single();
    if (error) throw new Error(`fixture variation: ${error.message}`);
    variationId = (v as { id: string }).id;

    const photoId = await putPhoto(fixture.workOrderId, "variation", { kind: "variation", area: "Left" });
    await db!.from("wo_photos").update({ variation_id: variationId }).eq("id", photoId);

    const { data: woRow } = await db!.from("work_orders")
      .select("share_token").eq("id", fixture.workOrderId).single();
    shareToken = (woRow as { share_token: string }).share_token;

    // The token job sheet reads the ticks through an RPC. A migration running is
    // not the same as its statements applying, so ask the database itself
    // rather than assuming.
    const { error: rpcErr } = await db!.rpc("get_work_order_ticks_by_token", { p_token: shareToken });
    ticksRpcLive = !rpcErr;
  });

  test.afterAll(async () => {
    if (fixture) {
      await db!.storage.from("wo-photos").remove([
        `wo/${fixture.workOrderId}/before.png`,
        `wo/${fixture.workOrderId}/variation.png`,
      ]);
    }
    await destroyLoopFixture(db!, fixture);
  });

  test("the job screen shows the photos, including the one on the variation", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);

    const gallery = page.getByTestId("site-photos");
    await expect(gallery).toBeVisible();
    await expect(gallery.getByTestId("wo-photo")).toHaveCount(2);
    // Grouped by kind, so the office can see what stage each photo came from.
    await expect(gallery.getByText("Before", { exact: true })).toBeVisible();
    await expect(gallery.getByText("Variation", { exact: true })).toBeVisible();

    // The variation's own photo sits with the variation being priced.
    const card = page.getByTestId(`variation-${variationId}`);
    await expect(card.getByTestId("wo-photo")).toHaveCount(1);

    // Signed URLs into the private bucket — never a public object URL. The
    // tile became a lightbox BUTTON on 22 Aug (e49e183); the signed URL now
    // lives on the thumbnail image.
    const src = await card.getByTestId("wo-photo").first().locator("img").getAttribute("src");
    expect(src).toContain("token=");
  });

  test("the dashboard shows what came back from site", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc");

    const strip = page.getByTestId("latest-photos");
    await expect(strip).toBeVisible();
    await expect(strip.getByText("E2E tick fixture").first()).toBeVisible();
    await expect(strip.getByTestId("wo-photo").first()).toBeVisible();
  });

  test("a ticked surface reads Complete on the job sheet, not Not started", async ({ page }) => {
    test.skip(!ticksRpcLive, "apply supabase/migrations/20261024000000_wo_ticks_by_token.sql first");

    // The job sheet as the contractor opens it — the frozen snapshot, whose own
    // per-surface status is the thing that used to be wrong.
    await page.goto(`/w/${shareToken}`);

    // a0:0 is "Walls", which the painter finished; a0:1 is "Windows", untouched.
    await expect(page.getByTestId("surf-state-a0:0")).toHaveText("Complete");
    await expect(page.getByTestId("surf-state-a0:1")).toHaveText("Not started");
  });
});

test.describe("the schedule is the first tab of Projects", () => {
  test.skip(!staff, missingCreds("STAFF"));

  test("/schedule lands on the console tab, with the names pinned and the days named", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);

    // The old route still goes somewhere real.
    await page.goto("/schedule");
    await expect(page).toHaveURL(/\/pc\/schedule/);

    // The board streams — wait for a lane before measuring anything.
    await expect(page.getByTestId("lane").first()).toBeVisible({ timeout: 30_000 });

    // Day names as well as numbers.
    const firstDay = page.locator(".sb .dh .cell").nth(1);
    await expect(firstDay.locator(".dw")).toHaveText(/^(MON|TUE|WED|THU|FRI|SAT|SUN)$/);
    await expect(firstDay.locator(".dn")).toHaveText(/^\d{1,2}$/);

    // The contractor column stays put while the dates scroll.
    const stickiness = await page.locator(".sb .cinfo").first()
      .evaluate((el) => getComputedStyle(el).position);
    expect(stickiness).toBe("sticky");

    const name = page.locator(".sb .cinfo .nm").first();
    const before = await name.boundingBox();
    await page.locator(".sb .tl").evaluate((el) => el.scrollBy({ left: 900 }));
    await page.waitForTimeout(300);
    const after = await name.boundingBox();
    expect(after!.x).toBeCloseTo(before!.x, 0);
  });
});
