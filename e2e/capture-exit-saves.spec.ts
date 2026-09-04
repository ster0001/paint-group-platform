import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Tom, 4 Sep 2026 — 116 Coppin St: "leaving capture view didn't save the
 * capture into the estimate; I had to rewrite it in the normal view."
 *
 * Only "Next room →" ever committed; "Exit to builder" was a bare link. Now
 * leaving SAVES: the room on screen is committed, the queue flushed, and the
 * builder opens with the room in it. This drives exactly Tom's path — tiles
 * tapped, then straight to the exit, never touching "Next room".
 */
const db = serviceClient();
const staff = credentials("STAFF");

test.describe("capture → save & exit", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const run = randomBytes(3).toString("hex");
  let estimateId = "";

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Capture exit ${run}`, status: "draft", source: "manual",
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id;
  });
  test.afterAll(async () => { if (estimateId) await db!.from("estimates").delete().eq("id", estimateId); });

  test("a room captured then exited lands in the estimate", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/quote/capture?id=${estimateId}`);
    // Ceiling heights first (hydration takes a beat — wait for the button, don't peek).
    const start = page.getByRole("button", { name: "Start capturing" });
    await expect(start).toBeVisible({ timeout: 30_000 });
    await start.click();

    // Pick a room (its core tiles come pre-selected), give it a size, and
    // LEAVE — Tom's path. Never "Next room →".
    await page.getByRole("button", { name: /^Bedroom$/ }).first().click();
    const walls = page.getByRole("button", { name: /^Walls/ });
    await expect(walls.first()).toBeVisible({ timeout: 20_000 });
    // The room card's number boxes, in order: L · W · H · perimeter.
    const boxes = page.locator("input[type=number]");
    await boxes.nth(0).fill("4");
    await boxes.nth(1).fill("3");
    await expect(page.getByText("L and W needed")).toHaveCount(0);

    await page.getByTestId("exit-to-builder").click();
    await expect(page).toHaveURL(new RegExp(`/quote\\?id=${estimateId}`), { timeout: 30_000 });

    // The builder has the room, and the row carries capture's own markers.
    await expect(page.getByText("Bedroom", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    const { data } = await db!.from("estimates").select("builder_state, storey_heights").eq("id", estimateId).single();
    const blocks = ((data?.builder_state as { blocks?: Array<{ name?: string; surfaces?: unknown[]; capturedVia?: string }> } | null)?.blocks) ?? [];
    expect(blocks.length).toBe(1);
    expect(blocks[0].name).toMatch(/Bedroom/);
    expect((blocks[0].surfaces ?? []).length).toBeGreaterThanOrEqual(2);
    expect(blocks[0].capturedVia).toBe("room_loop");
    expect(data?.storey_heights).not.toBeNull();
  });
});
