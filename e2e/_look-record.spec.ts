import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/** Screenshot rig: the record's head with the status block top right. Not a gate. */
const db = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };
const SHOTS = process.env.LOOK_SHOTS ?? "";
const run = randomBytes(3).toString("hex");

test("look: record head", async ({ page }) => {
  test.skip(!db || !staff.email || !SHOTS, "rig");
  const sb = db!;
  const { data } = await sb.from("accounts").insert({ email: `pg.e2e.look.${run}@example.com`, name: `Look Record ${run}`, phone: "0491 570 156", account_type: "residential", followup_due_at: new Date(Date.now() + 86_400_000).toISOString(), temperature: "warm", tags: ["real_estate"] }).select("id").single();
  const id = (data as { id: string }).id;
  try {
    await page.goto("/login");
    await page.fill('input[type="email"]', staff.email);
    await page.fill('input[type="password"]', staff.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await page.goto(`/crm/customers/${id}`);
    await expect(page.getByTestId("status-card")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/record-desktop.png`, clip: { x: 0, y: 0, width: 1280, height: 620 } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${SHOTS}/record-mobile.png`, fullPage: false });
  } finally {
    await sb.from("accounts").delete().eq("id", id);
  }
});
