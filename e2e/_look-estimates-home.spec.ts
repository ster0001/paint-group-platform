import { test } from "@playwright/test";
import { credentials, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Look-only (C7b): the estimates home and one wizard estimate at 1440px,
 * for the visual check against design/reference/estimates-home-mockup.html.
 * Signs in through the helper; writes PNGs to LOOK_OUT.
 */
const staff = credentials("STAFF");
const db = serviceClient();
const OUT = process.env.LOOK_OUT ?? "/tmp";

test("look: estimates home at 1440", async ({ page }) => {
  test.skip(!staff || !db, "needs staff creds + service key");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, staff!, /\/estimates/);

  await page.goto("/estimates");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/look-estimates-waiting.png` });

  await page.goto("/estimates?status=all");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/look-estimates-all.png` });

  await page.goto("/estimates?status=all&built=customers");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/look-estimates-customers.png` });

  // The newest wizard estimate with an OPEN request, else the newest wizard estimate.
  const { data: req } = await db!.from("confirmation_requests").select("estimate_id")
    .in("status", ["requested", "question_asked"]).order("requested_at", { ascending: false }).limit(1).maybeSingle();
  let id = req?.estimate_id as string | undefined;
  if (!id) {
    const { data: est } = await db!.from("estimates").select("id")
      .not("builder_state->wizard->state", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    id = est?.id as string | undefined;
  }
  test.skip(!id, "no wizard estimate on the test project");

  await page.goto(`/quote?id=${id}&tab=pack`);
  await page.getByTestId("desk-check").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/look-estimate-pack.png` });

  await page.goto(`/quote?id=${id}`);
  await page.locator("section[data-provenance]").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/look-estimate-scope.png` });
});
