/**
 * C17 story — commercial: retail → send.
 *
 * A shop: the retail tile, the two segment screens, a guide range, then the
 * customer tightens online and SENDS it to the estimator from the finish
 * line — a confirmation request of kind `remote`, never fix-online (C12:
 * commercial never reaches fix-online).
 */
import { test, expect } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";
import { serviceClient } from "../fixtures/woLoop";

test("retail → range → tighten → send to the estimator; no fix-online, a remote confirmation request", async ({ page }) => {
  test.setTimeout(300_000);
  const db = serviceClient();
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-commercial").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='segment']")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("ql-segment-retail").click();
  await quickNext(page);

  // The retail row's areas: sales floor, back of house, fitting rooms.
  await expect(page.locator("[data-quick-step='com_areas']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("com-count-floor-n")).toHaveText("1");
  await expect(page.getByTestId("com-count-boh-n")).toHaveText("1");
  await expect(page.locator("body")).not.toContainText(/how much is gl/i);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='com_job']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("ql-condition-wear")).toContainText(/sign shadows/);
  await quickNext(page);

  // The range, then tighten it online.
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await expect(page.getByTestId("reveal-kicker")).toContainText(/Retail/);
  await page.getByTestId("door-tighten").click();
  await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 60_000 });
  const estimateId = page.url().match(/id=([0-9a-f-]{36})/)![1];
  expect(await page.getByText(/Fix my price/i).count(), "commercial never sees fix-online").toBe(0);

  // The finish line: Send to <name>, never fix-online.
  await page.getByTestId("scope-finalise").click();
  await expect(page).toHaveURL(/\/estimate\/finish\?id=/, { timeout: 60_000 });
  await expect(page.getByTestId("finish-fix_online")).toHaveCount(0);
  const send = page.getByTestId("finish-send_for_confirmation");
  await expect(send).toBeVisible({ timeout: 30_000 });
  await send.click();
  // A successful send lands on the sent page, which names the estimator who has it.
  await expect(page).toHaveURL(/\/estimate\/sent\?id=/, { timeout: 60_000 });
  await expect(page.getByRole("alert")).toContainText(/has it/, { timeout: 30_000 });

  if (db) {
    await expect.poll(async () => {
      const { data } = await db.from("confirmation_requests").select("kind, status").eq("estimate_id", estimateId);
      return data?.map((r) => `${r.kind}:${r.status}`) ?? [];
    }, { timeout: 30_000 }).toEqual(["remote:requested"]);
    await db.from("estimates").delete().eq("id", estimateId);
  }
});
