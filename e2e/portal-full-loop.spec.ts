import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient, createLoopFixture, destroyLoopFixture, type LoopFixture } from "./fixtures/woLoop";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor } from "./fixtures/portal";
import { driveNoPlanWizard } from "./customer-journey/drive";

/**
 * 3a-8 · The full loop (brief: "wizard → save → accept → deposit → timeline
 * → variation → sign-off → warranty card → colour register → second
 * estimate"), demonstrated AS THE CUSTOMER on phone and desktop viewports.
 *
 * The wizard front door is driven for real; the job's progression uses the
 * same service fixtures every per-session suite proved, and each stage is
 * verified through the CUSTOMER'S rendered portal — which is the thing the
 * phase exists to ship.
 */

const db: SupabaseClient | null = serviceClient();

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 850 };

test.describe("portal full loop (3a-8)", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the full loop");

  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.loop.${run}@example.com`;
  let fixture: LoopFixture | null = null;

  test.afterAll(async () => {
    const sb = db!;
    if (fixture) {
      const { data: invs } = await sb.from("invoices").select("id").eq("estimate_id", fixture.estimateId);
      const ids = (invs ?? []).map((i) => i.id);
      if (ids.length) await sb.from("payments").delete().in("invoice_id", ids);
      await destroyLoopFixture(sb, fixture);
    }
    await destroyAccountChain(sb, email);
    await deleteUserByEmail(sb, email);
  });

  test("one customer, the whole journey, phone and desktop", async ({ page }) => {
    test.setTimeout(300_000);
    const sb = db!;
    await page.setViewportSize(PHONE);

    // 1 · Wizard → save: the real front door, no registration anywhere.
    await page.goto("/estimate");
    if (await page.getByText(/nearly here/i).count()) test.skip(true, "wizard_public off here");
    await driveNoPlanWizard(page, { email });
    expect(await page.locator("input[type=password]").count()).toBe(0);

    // The save created the account; the magic link is the front door.
    await page.goto(await magicLinkFor(sb, email));
    await expect(page.locator("h1")).toHaveText(/Your estimate is saved/);

    // 2 · Accept + book (the flows proven in their own phases, via fixtures):
    // the wizard estimate becomes an accepted job with a live work order.
    const { data: acct } = await sb.from("accounts").select("id").eq("email", email).single();
    fixture = await createLoopFixture(sb, null as unknown as string, [
      { heading: "Hallway & stairs", labels: ["Walls", "Ceiling"] },
    ]);
    const prop0 = await sb.from("properties").insert({
      account_id: acct!.id, address: "12 Acacia Street", suburb: "Murrumbeena",
      state: "VIC", postcode: "3163", address_norm: `12 acacia street murrumbeena 3163 loop${run}`,
    }).select("id").single();
    if (prop0.error) throw new Error(prop0.error.message);
    await sb.from("estimates").update({
      account_id: acct!.id, property_id: prop0.data.id,
      title: "12 Acacia Street", accepted_total_cents: 845_000,
    }).eq("id", fixture.estimateId);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
    await sb.from("work_orders").update({ start_date: today, end_date: today }).eq("id", fixture.workOrderId);

    // 3 · Deposit paid → Money shows it, GST itemised.
    const inv = await sb.from("invoices").insert({
      estimate_id: fixture.estimateId, kind: "deposit", status: "paid",
      number: `INV-LOOP${run}`, token: `looptok${run}`,
      subtotal_ex_cents: 230_455, gst_cents: 23_045, total_inc_cents: 253_500,
      issued_on: today, due_on: today,
    }).select("id").single();
    await sb.from("payments").insert({
      invoice_id: inv.data!.id, amount_cents: 253_500, status: "succeeded",
      method: "bank_transfer", paid_on: today, receipt_number: `RCT-LOOP${run}`,
    });
    await page.goto("/account/money");
    await expect(page.getByText(`INV-LOOP${run}`)).toBeVisible();
    await expect(page.getByText("Includes GST of $230.45")).toBeVisible();

    // 4 · The job underway: ticks + a sent update + a variation to approve.
    for (const s of fixture.surfaces) {
      await sb.from("wo_surfaces").update({ state: s.label === "Walls" ? "done" : "prepped" }).eq("id", s.id);
    }
    await sb.from("wo_updates").insert({
      work_order_id: fixture.workOrderId, for_date: today, status: "sent",
      draft_text: "x", final_text: "First coat on in the hallway today.", sent_at: new Date().toISOString(),
    });
    await sb.from("wo_variations").insert({
      work_order_id: fixture.workOrderId, category: "rot", comment: "Sill repair",
      status: "priced", price_cents: 34_000, customer_token: `loopvt${run}`,
    });

    const timelineChecks = async (p: Page) => {
      await expect(p.getByText("First coat on in the hallway today.")).toBeVisible();
      const pending = p.locator(".card", { hasText: "Something needs your say-so" });
      await expect(pending).toContainText("$340.00");
      await expect(pending.getByRole("link", { name: "Review & approve" }))
        .toHaveAttribute("href", `/v/loopvt${run}`);
      const hallway = p.locator(".area", { hasText: "Hallway & stairs" });
      await expect(hallway.locator(".chip")).toHaveText("First coat");
    };
    await page.goto("/account/project");
    await timelineChecks(page);
    await page.setViewportSize(DESKTOP); // same components, desktop layout
    await page.goto("/account/project");
    await timelineChecks(page);
    await expect(page.locator(".tabbar .tab", { hasText: "My project" })).toBeVisible(); // sidebar form

    // 5 · Variation approved + sign-off → warranty + register.
    await sb.from("wo_variations").update({
      status: "customer_approved", customer_responded_at: new Date().toISOString(),
    }).eq("customer_token", `loopvt${run}`);
    await sb.from("work_orders").update({
      stage: "closed", status: "complete",
      wo_snapshot: {
        version: 1, jobTitle: "12 Acacia Street",
        materials: [{ product: "Wash&Wear Low Sheen", photoUrl: "", litres: 10, coverageMissing: false,
                      colourName: "Natural White", colourHex: "#F2EFE6", colourStatus: "confirmed" }],
        areas: [{ id: "a0", title: "Hallway & stairs", finishCode: "PG-3", finishOverridden: false, photos: [],
                  surfaces: [{ key: "a0:0", label: "Walls", coats: 2, product: "Wash&Wear Low Sheen", prep: "", hours: 1, status: "complete" }] }],
      },
    }).eq("id", fixture.workOrderId);
    await sb.from("warranties").insert({
      work_order_id: fixture.workOrderId, estimate_id: fixture.estimateId,
      starts_on: today, ends_on: `${Number(today.slice(0, 4)) + 2}${today.slice(4)}`, years: 2, signed_kind: "in_person",
    });

    await page.setViewportSize(PHONE);
    await page.goto("/account");
    await expect(page.locator("h1")).toHaveText(/All finished/);
    await page.goto("/account/documents");
    await expect(page.getByText("Two-year workmanship warranty")).toBeVisible();
    await page.goto("/account/colours");
    await expect(page.getByText("Natural White")).toBeVisible();

    // 6 · The second estimate: prefilled, no email gate — the retention loop.
    const { data: prop } = await sb.from("properties").select("id").eq("account_id", acct!.id).limit(1).maybeSingle();
    if (prop) {
      await page.goto(`/estimate?property=${prop.id}`);
      expect(await page.locator("input[type=email]").count()).toBe(0);
    }
  });

  test("the trade persona keeps its portfolio on both viewports", async ({ page }) => {
    const sb = db!;
    // Flip the SAME account to trade — one schema, feature gates only (§3).
    await sb.from("accounts").update({ account_type: "trade" }).eq("email", email);
    await page.goto(await magicLinkFor(sb, email));

    for (const viewport of [PHONE, DESKTOP]) {
      await page.setViewportSize(viewport);
      await page.goto("/account");
      await expect(page.locator("h1")).toHaveText("Your properties, at a glance");
      await expect(page.locator(".tile").first()).toBeVisible();
    }
    await page.goto("/account/properties");
    await expect(page.locator(".job", { hasText: "12 Acacia Street" })).toBeVisible();
  });
});
