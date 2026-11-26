/**
 * Tom, 26 Nov 2026: "Send a message keeps dropping out when trying to fill it
 * in." As an anonymous customer on a laptop and a phone: the sheet stays up
 * and keeps every word while it is typed in slowly, while text is selected
 * with a drag that ends outside the sheet, and after a press that starts on a
 * field and ends on the backdrop. Only a press that both starts and ends on
 * the backdrop (or the ×, Back, Escape) closes it.
 */
import { test, expect, type Page } from "@playwright/test";
import { fillQuickAddress, openQuickLook, quickNext, openTalk } from "./drive";

const SIZES = [{ name: "laptop", width: 1280, height: 800 }, { name: "phone", width: 390, height: 780 }] as const;

async function openMessage(page: Page) {
  await openQuickLook(page);
  // A phone carries the doors behind the Contact pill; a laptop shows the talk bar from step 2.
  const pill = page.getByTestId("wzm-contact");
  if (await pill.isVisible().catch(() => false)) {
    await pill.click();
    await page.getByTestId("wzm-contact-message").click();
  } else {
    await fillQuickAddress(page);
    await quickNext(page);
    await openTalk(page);
    await page.getByTestId("ql-message").click();
  }
  await expect(page.getByTestId("talk-sheet")).toBeVisible();
}

for (const size of SIZES) {
  test.describe(`Send a message stays open while it is filled in — ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("typing slowly, selecting text past the edge and a stray release on the backdrop never close it or lose a word", async ({ page }) => {
      test.setTimeout(180_000);
      await openMessage(page);
      const sheet = page.getByTestId("talk-sheet");

      // The details, typed the way a person types — across autosaves and the heartbeat.
      await page.getByTestId("talk-name").pressSequentially("Slow Typer", { delay: 120 });
      // Before an address is on the estimate the sheet asks for it too.
      if (await page.getByTestId("talk-address").count()) await page.getByTestId("talk-address").fill("9 Slow Street, Kew");
      await page.getByTestId("talk-email").pressSequentially("slow.typer@example.com", { delay: 120 });
      await page.getByTestId("talk-mobile").pressSequentially("0412 000 778", { delay: 120 });
      await page.waitForTimeout(16_000); // one heartbeat and an autosave pass
      await expect(sheet).toBeVisible();
      await expect(page.getByTestId("talk-name")).toHaveValue("Slow Typer");
      await expect(page.getByTestId("talk-email")).toHaveValue("slow.typer@example.com");

      // Select the name by dragging from inside the field to outside the sheet, and let go there.
      const name = await page.getByTestId("talk-name").boundingBox();
      const panel = await sheet.locator(".wz-sheet").boundingBox();
      const outside = size.name === "laptop" ? { x: Math.max(4, panel!.x - 60), y: name!.y + name!.height / 2 } : { x: panel!.x + panel!.width / 2, y: Math.max(4, panel!.y - 30) };
      await page.mouse.move(name!.x + name!.width - 12, name!.y + name!.height / 2);
      await page.mouse.down();
      await page.mouse.move(outside.x, outside.y, { steps: 8 });
      await page.mouse.up();
      await expect(sheet, "a drag that ends on the backdrop is not a close").toBeVisible();
      await expect(page.getByTestId("talk-name")).toHaveValue("Slow Typer");

      // On to the message box; the same there.
      await page.getByTestId("talk-go").click();
      const box = page.getByTestId("talk-message");
      await expect(box).toBeVisible();
      await box.pressSequentially("Could you tell me whether ceilings are included?", { delay: 60 });
      const b = await box.boundingBox();
      await page.mouse.move(b!.x + 20, b!.y + 20);
      await page.mouse.down();
      await page.mouse.move(outside.x, outside.y, { steps: 8 });
      await page.mouse.up();
      await expect(sheet).toBeVisible();
      await expect(box).toHaveValue("Could you tell me whether ceilings are included?");

      // A real backdrop press still closes it.
      await page.mouse.click(outside.x, outside.y);
      await expect(sheet).toHaveCount(0);
    });
  });
}
