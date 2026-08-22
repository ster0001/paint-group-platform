import { test } from "@playwright/test";
import { credentials, signIn } from "./helpers";
const OUT = "/private/tmp/claude-501/-Users-tomroman-Documents-paint-group-platform-/06c484f8-b472-48c8-ac41-1becfb5f4c2a/scratchpad/shots";

test("edit job sheet path", async ({ page }) => {
  await signIn(page, credentials("STAFF")!, /\/estimates/);
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.goto("/pc/flow");
  await page.waitForTimeout(800);
  await page.locator('[data-testid^="job-"]').first().click();
  await page.waitForTimeout(1200);
  console.log("WO VIEW URL:", page.url());
  const edit = page.getByTestId("edit-wo");
  console.log("EDIT BUTTON PRESENT:", await edit.count(), "HREF:", await edit.getAttribute("href").catch(() => "-"));
  await page.screenshot({ path: `${OUT}/pc-wo-now.png`, fullPage: true });
  if (await edit.count()) {
    await edit.click();
    await page.waitForTimeout(2500);
    console.log("LANDED ON:", page.url());
    await page.screenshot({ path: `${OUT}/builder-wo-tab.png`, fullPage: true });
  }
});
