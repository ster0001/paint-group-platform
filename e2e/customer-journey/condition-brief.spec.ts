import { test, expect } from "@playwright/test";

/**
 * "Anything we should know?" — the additive condition description
 * (Tom, 9 Sep, resolving ⚑14).
 *
 * *"Add describe it alongside the other features — like floorplan plus
 * describe it, or describe the condition overall and tell us if there is
 * anything which needs extra work — then it could come back asking for
 * photos?"*
 *
 * So the box appears on the routes that are NOT already a description, reads
 * as they type, and asks for a photo of whatever it heard. It costs nothing
 * and calls no model, so this drives the real screen with no API key.
 */

async function startWizard(page: import("@playwright/test").Page) {
  await page.goto("/estimate");
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
  await page.getByPlaceholder("Suburb").fill("Murrumbeena");
  await page.getByPlaceholder("Postcode").fill("3163");
}

test("the condition box rides alongside the other ways in, and asks for photos", async ({ page }) => {
  test.setTimeout(180_000);
  await startWizard(page);

  // It is NOT on screen until a route is chosen, and never on the Describe
  // route — that box already IS a description.
  await expect(page.getByTestId("condition-box")).toHaveCount(0);
  await page.getByTestId("entry-describe").click();
  await expect(page.getByTestId("condition-box")).toHaveCount(0);
  await expect(page.getByTestId("describe-box")).toBeVisible();

  // On the no-floorplan route it appears, alongside — not instead of.
  await page.getByTestId("entry-questions").click();
  const box = page.getByTestId("condition-box");
  await expect(box).toBeVisible();
  await expect(box).toContainText(/the part a floorplan can.t tell us/i);
  await expect(page.getByTestId("wz-entry")).toBeVisible();

  // A clean description is answered as such — no photo chased for nothing.
  await page.getByTestId("describe-condition").fill("Three bedroom house, all in good order, just after a refresh");
  await expect(page.getByTestId("condition-clear")).toBeVisible();
  await expect(page.getByTestId("condition-photo-ask")).toHaveCount(0);

  // Something that needs extra work comes back asking for a photo of it.
  await page.getByTestId("describe-condition").fill("Generally sound but the paint is peeling above the shower and there's a water mark on the hall ceiling");
  const ask = page.getByTestId("condition-photo-ask");
  await expect(ask).toBeVisible();
  await expect(ask).toContainText(/the flaking paint/i);
  await expect(ask).toContainText(/we can price the repair now/i);
  await expect(page.getByTestId("condition-clear")).toHaveCount(0);

  // The two cases a photo would not settle come back as notes instead.
  await page.getByTestId("describe-condition").fill("The new skirting boards are raw MDF and the existing trims are oil based");
  await expect(page.getByTestId("condition-note").first()).toContainText(/raw MDF or bare timber/i);
  await expect(page.getByTestId("condition-note").nth(1)).toContainText(/bonding primer/i);

  // The live chat bubble is untouched and separate — a direct line to the
  // office, nothing to do with describing the job (Tom, 8 and 9 Sep).
  await expect(page.locator(".wz-chat-bubble, [data-testid='chat-bubble']").first().or(page.getByRole("button", { name: /chat/i }).first())).toBeTruthy();
});
