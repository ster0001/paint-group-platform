import { test } from "@playwright/test";
import { credentials, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

// Throwaway visual pass: the three §7 invoicing screens on a phone viewport,
// breathing the real data. Screenshots land in the session scratchpad.
const OUT =
  "/private/tmp/claude-501/-Users-tomroman-Documents-paint-group-platform-/eaffbd88-8e8f-442a-980a-c33284b9766f/scratchpad/shots";

test("invoicing screens on a phone", async ({ page }) => {
  await signIn(page, credentials("STAFF")!, /\/estimates/);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/invoicing");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/dash-receivables.png`, fullPage: true });
  await page.getByRole("navigation").getByRole("button", { name: "Activity" }).click();
  await page.screenshot({ path: `${OUT}/dash-activity.png`, fullPage: true });

  const db = serviceClient()!;
  const { data: inv } = await db
    .from("invoices")
    .select("id, estimate_id, kind, status")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  const row = inv as { id: string; estimate_id: string };
  console.log("LOOK AT:", row);

  await page.goto(`/invoicing/job/${row.estimate_id}`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/job-money-payments.png`, fullPage: true });
  await page.getByRole("navigation").getByRole("button", { name: "Invoices" }).click();
  await page.screenshot({ path: `${OUT}/job-money-invoices.png`, fullPage: true });
  await page.getByRole("navigation").getByRole("button", { name: "Costs" }).click();
  await page.screenshot({ path: `${OUT}/job-money-costs.png`, fullPage: true });
  await page.getByRole("button", { name: "Request payment" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/job-money-request-sheet.png` });

  await page.goto(`/invoicing/inv/${row.id}`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/invoice-doc.png`, fullPage: true });
});
