import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, userIdFor } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 10 Sep 2026 — staff notifications. Settings → Automations is broken
 * into Customers / Contractors / Staff; the Staff section lists the six
 * staff alerts as switchable automations and carries the routing table
 * (who gets each one, Email / Text). A staff login ticks Email for
 * "Invoice paid" on their own row, saves, and the tick survives a reload —
 * profiles.staff_notify holds it. Text stays disabled until the login has a
 * mobile, which the master sets under Staff logins.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

test.describe("Settings → Automations → Staff alerts", () => {
  test.skip(!staff || !db, missingCreds("STAFF") + " + service key");
  test.use({ viewport: { width: 1280, height: 900 } });

  let meId = "";
  let before: { staff_notify: unknown; phone: string | null } | null = null;

  test.beforeAll(async () => {
    meId = (await userIdFor(staff!)) ?? "";
    if (!meId) throw new Error("e2e staff login not found");
    const { data } = await db!.from("profiles").select("staff_notify, phone").eq("id", meId).single();
    before = (data as typeof before) ?? { staff_notify: {}, phone: null };
    await db!.from("profiles").update({ staff_notify: {}, phone: null }).eq("id", meId);
  });
  test.afterAll(async () => {
    if (db && meId && before) await db.from("profiles").update({ staff_notify: before.staff_notify ?? {}, phone: before.phone }).eq("id", meId);
  });

  test("three audiences; the six staff alerts; a tick on my own row saves and comes back", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/settings#automations");
    const panel = page.getByTestId("automations");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    // The three sections, in Tom's words.
    for (const label of ["Customers", "Contractors", "Staff"]) {
      await expect(panel.getByRole("heading", { level: 3, name: label, exact: true })).toBeVisible();
    }
    // Each staff alert is a switchable automation.
    for (const key of ["office_estimate_accepted", "office_job_accepted", "office_job_declined", "office_invoice_paid", "office_variation_raised", "office_contractor_invoice"]) {
      await expect(page.getByTestId(`switch-${key}`)).toBeVisible();
    }

    // The routing table: my row, Email tick on "Invoice paid"; Text is disabled with no mobile.
    const matrix = page.getByTestId("staff-alerts");
    await expect(matrix).toBeVisible();
    const email = staff!.email;
    const emailTick = page.getByTestId(`alert-${email}-office_invoice_paid-email`);
    const smsTick = page.getByTestId(`alert-${email}-office_invoice_paid-sms`);
    await expect(emailTick).toBeVisible({ timeout: 20_000 });
    await expect(emailTick).not.toBeChecked();
    await expect(smsTick).toBeDisabled();

    await emailTick.check();
    await page.getByTestId("staff-alerts-save").click();
    await expect(page.getByTestId("staff-alerts-msg")).toHaveText(/Saved/, { timeout: 15_000 });

    // Persisted on the profile, and back on reload.
    const { data } = await db!.from("profiles").select("staff_notify").eq("id", meId).single();
    expect(data?.staff_notify).toEqual({ office_invoice_paid: ["email"] });
    await page.reload();
    await expect(page.getByTestId(`alert-${email}-office_invoice_paid-email`)).toBeChecked({ timeout: 20_000 });

    // A mobile on the login unlocks Text.
    await db!.from("profiles").update({ phone: "+61400000001" }).eq("id", meId);
    await page.reload();
    await expect(page.getByTestId(`alert-${email}-office_invoice_paid-sms`)).toBeEnabled({ timeout: 20_000 });
  });
});
