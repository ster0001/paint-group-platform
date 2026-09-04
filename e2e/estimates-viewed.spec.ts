import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";

/** Tom, 4 Sep 2026: a sent estimate the customer has opened reads "viewed" on the list, with its own tab. */
const db = serviceClient();
const staff = credentials("STAFF");

test.describe("estimates list — viewed", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const run = randomBytes(3).toString("hex");
  let viewedId = ""; let unviewedId = "";

  test.beforeAll(async () => {
    const base = { status: "sent", source: "manual", level_of_finish: 3, sent_at: new Date().toISOString(), builder_state: { blocks: [] } };
    const a = await db!.from("estimates").insert({ ...base, title: `Viewed ${run}`, share_token: `vw${run}${Math.random().toString(36).slice(2, 22)}`, viewed_at: new Date().toISOString() }).select("id").single();
    const b = await db!.from("estimates").insert({ ...base, title: `Unviewed ${run}`, share_token: `uv${run}${Math.random().toString(36).slice(2, 22)}` }).select("id").single();
    if (a.error || b.error) throw new Error(a.error?.message ?? b.error?.message);
    viewedId = a.data.id; unviewedId = b.data.id;
  });
  test.afterAll(async () => { await db!.from("estimates").delete().in("id", [viewedId, unviewedId].filter(Boolean)); });

  test("the row reads viewed, and the Sent / Viewed tabs split them", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/estimates");
    await expect(page.getByTestId(`status-${viewedId}`)).toHaveText("viewed");
    await expect(page.getByTestId(`status-${unviewedId}`)).toHaveText("sent");

    await page.getByRole("link", { name: "viewed", exact: true }).click();
    await expect(page).toHaveURL(/status=viewed/);
    await expect(page.getByTestId(`status-${viewedId}`)).toBeVisible();
    await expect(page.getByTestId(`status-${unviewedId}`)).toHaveCount(0);

    await page.getByRole("link", { name: "sent", exact: true }).click();
    await expect(page.getByTestId(`status-${unviewedId}`)).toBeVisible();
    await expect(page.getByTestId(`status-${viewedId}`)).toHaveCount(0);
  });
});
