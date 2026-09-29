import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn, TINY_SIGNATURE_PNG } from "./helpers";

/**
 * Tom, 30 Sep 2026: "unable to add photos to new products — it says it
 * violates the policy". Staff, Settings → Products: upload a photo on a
 * product. The bucket is public; the upload is an upsert, which needs the
 * uploader to be able to READ the object under RLS (migration 20270206).
 * Nothing is saved: the photo lands in the bucket, the row is left alone.
 */
const staff = credentials("STAFF");

test("staff can upload a product photo (the bucket lets its uploaders read)", async ({ page }) => {
  test.skip(!staff, missingCreds("STAFF"));
  await signIn(page, staff!, /\/(home|estimates)/);
  await page.goto("/settings#products");
  // Each product is a collapsed row; Edit opens the one with the photo button.
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const label = page.getByText(/^(Upload photo|Change photo)$/).first();
  await expect(label).toBeVisible({ timeout: 30_000 });
  const input = label.locator("input[type=file]");
  const png = Buffer.from(TINY_SIGNATURE_PNG.split(",")[1], "base64");
  await input.setInputFiles({ name: `e2e-product-${Date.now()}.png`, mimeType: "image/png", buffer: png });
  // The message beside Save says what happened — the policy error, or the upload.
  const card = label.locator("xpath=ancestor::div[contains(@class,'mt-3')][1]");
  await expect(card).toContainText(/Photo uploaded/, { timeout: 30_000 });
  await expect(card).not.toContainText(/violates|policy/);
});
