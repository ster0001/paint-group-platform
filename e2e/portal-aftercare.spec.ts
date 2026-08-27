import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient, createLoopFixture, destroyLoopFixture, type LoopFixture } from "./fixtures/woLoop";
import { deleteUserByEmail, magicLinkFor } from "./fixtures/portal";
import { TINY_SIGNATURE_PNG } from "./helpers";

/**
 * 3a-5 · My colours + Documents + warranty, as the signed-in customer.
 *
 * What must hold: the colour register renders confirmed colours with their
 * swatch/code and says TBC honestly; the warranty card carries the real
 * dates with a countdown; credentials download through the ownership route;
 * the terms wear the DRAFT watermark until approved in Settings; and
 * "Report an issue" lands a photo-first row for the PC console.
 */

const db: SupabaseClient | null = serviceClient();

test.describe("portal aftercare (3a-5)", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the aftercare suite");

  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.aftercare.${run}@example.com`;
  let fixture: LoopFixture | null = null;
  let accountId = "";
  let docId = "";
  let migrationReady = true;
  const docPath = `docs/e2e-${run}.pdf`;
  const day = (n: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(Date.now() + n * 86_400_000));

  test.beforeAll(async () => {
    const sb = db!;
    // Probe: skip cleanly until migration 20261129 lands in this environment.
    const probe = await sb.from("company_documents").select("id").limit(1);
    if (probe.error) {
      migrationReady = false;
      return;
    }

    fixture = await createLoopFixture(sb, null as unknown as string, [
      { heading: "Hallway & stairs", labels: ["Walls", "Trim & doors"] },
    ]).catch(async () => {
      // contractor_id is nullable on work_orders — a null contractor is fine
      // for aftercare, but the fixture insists on one; fall back to creating
      // the chain by hand if it refuses.
      return null;
    });
    if (!fixture) {
      const est = await sb.from("estimates")
        .insert({ status: "accepted", source: "manual", level_of_finish: 3 })
        .select("id").single();
      if (est.error) throw new Error(est.error.message);
      const wo = await sb.from("work_orders").insert({
        estimate_id: est.data.id, wo_ref: `WO-AC${run}`, share_token: `acwo${run}${Date.now() % 1e6}`,
        stage: "closed", status: "complete", issued_at: new Date().toISOString(),
        wo_snapshot: { version: 1, areas: [] },
      }).select("id").single();
      if (wo.error) throw new Error(wo.error.message);
      fixture = { estimateId: est.data.id, workOrderId: wo.data.id, surfaces: [] };
    }

    // The snapshot the register reads: one confirmed colour, one TBC.
    const snap = {
      version: 1, woRef: `WO-AC${run}`, jobTitle: "12 Acacia Street",
      materials: [
        { product: "Dulux Wash&Wear Low Sheen", photoUrl: "", litres: 10, coverageMissing: false,
          colourName: "Natural White", colourHex: "#F2EFE6", colourStatus: "confirmed" },
        { product: "Aquanamel Semi-Gloss", photoUrl: "", litres: 4, coverageMissing: false,
          colourName: "", colourHex: "", colourStatus: "tbc" },
      ],
      areas: [{
        id: "a0", title: "Hallway & stairs", finishCode: "PG-3", finishOverridden: false, photos: [],
        surfaces: [
          { key: "a0:0", label: "Walls", coats: 2, product: "Dulux Wash&Wear Low Sheen", prep: "", hours: 1, status: "complete" },
          { key: "a0:1", label: "Trim & doors", coats: 2, product: "Aquanamel Semi-Gloss", prep: "", hours: 1, status: "complete" },
        ],
      }],
    };
    await sb.from("work_orders").update({
      wo_snapshot: snap,
      stage: "closed",
      colours: { "Dulux Wash&Wear Low Sheen": { status: "confirmed", match: { code: "PN1E4", brand: "Dulux" } } },
    }).eq("id", fixture.workOrderId);

    const acct = await sb.from("accounts").insert({ email, name: "Margaret Aftercare" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id;
    await sb.from("estimates").update({ account_id: accountId, title: "12 Acacia Street" }).eq("id", fixture.estimateId);

    // Warranty: signed off 30 days ago, two years to run.
    const w = await sb.from("warranties").insert({
      work_order_id: fixture.workOrderId, estimate_id: fixture.estimateId,
      starts_on: day(-30), ends_on: day(700), years: 2, signed_kind: "in_person",
    });
    if (w.error) throw new Error(`warranty fixture: ${w.error.message}`);

    // The credential on display.
    const pdf = Buffer.from(`%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF e2e ${run}`);
    const up = await sb.storage.from("company-docs").upload(docPath, pdf, { contentType: "application/pdf" });
    if (up.error) throw new Error(`doc upload: ${up.error.message}`);
    const doc = await sb.from("company_documents").insert({
      title: `Public liability certificate ($20M) e2e-${run}`, kind: "insurance",
      storage_path: docPath, expires_on: day(200),
    }).select("id").single();
    if (doc.error) throw new Error(doc.error.message);
    docId = doc.data.id;
  });

  test.afterAll(async () => {
    const sb = db!;
    if (accountId) await sb.from("warranty_issues").delete().eq("account_id", accountId);
    if (fixture) await destroyLoopFixture(sb, fixture);
    if (docId) await sb.from("company_documents").delete().eq("id", docId);
    await sb.storage.from("company-docs").remove([docPath]);
    if (accountId) {
      await sb.from("account_users").delete().eq("account_id", accountId);
      await sb.from("accounts").delete().eq("id", accountId);
    }
    await deleteUserByEmail(sb, email);
  });

  test("the colour register: confirmed colours with swatch and code, TBC honest", async ({ page }) => {
    test.skip(!migrationReady, "run migration 20261129000000_portal_documents.sql first");
    const sb = db!;
    await page.goto(await magicLinkFor(sb, email));
    await page.goto("/account/colours");

    await expect(page.getByText("Natural White")).toBeVisible();
    await expect(page.getByText(/WALLS · LOW SHEEN · 2 COATS · CODE PN1E4/)).toBeVisible();
    await expect(page.getByText("Colour to be confirmed")).toBeVisible();
    await expect(page.getByText(/TRIM & DOORS · SEMI-GLOSS/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Download as PDF" })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({ path: "test-results/look-portal/phone-colours.png", fullPage: true });
  });

  test("warranty card, credentials and the DRAFT watermark", async ({ page, request }) => {
    test.skip(!migrationReady, "run migration 20261129000000_portal_documents.sql first");
    const sb = db!;
    await page.goto(await magicLinkFor(sb, email));
    await page.goto("/account/documents");

    await expect(page.getByText("Two-year workmanship warranty")).toBeVisible();
    await expect(page.getByText(/left$/).first()).toBeVisible(); // the countdown chip
    await expect(page.getByText(`Public liability certificate ($20M) e2e-${run}`)).toBeVisible();

    // The download route serves the real file to a member.
    const dl = await page.request.get(`/account/document/${docId}`);
    expect(dl.status()).toBe(200);
    expect((await dl.body()).toString()).toContain(`%PDF`);

    // Signed out, the same route is a 404 — never a leak. (The bare
    // `request` fixture carries no session cookies.)
    const anon = await request.get(`/account/document/${docId}`, { maxRedirects: 0 });
    expect(anon.status()).toBe(404);

    // DRAFT watermark tracks the Settings approval flag.
    const { data: flag } = await sb.from("settings").select("value").eq("key", "warranty_terms").maybeSingle();
    const approved = Boolean((flag?.value as { approved?: boolean } | null)?.approved);
    expect(await page.locator(".draftwrap").count()).toBe(approved ? 0 : 1);
    await expect(page.getByRole("heading", { name: /Your rights under the Australian Consumer Law/ })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({ path: "test-results/look-portal/phone-documents.png", fullPage: true });
  });

  test("report an issue: photo-first, lands in the PC queue's table", async ({ page }) => {
    test.skip(!migrationReady, "run migration 20261129000000_portal_documents.sql first");
    const sb = db!;
    await page.goto(await magicLinkFor(sb, email));
    await page.goto("/account/documents");

    await page.locator("textarea[name=note]").fill("Paint bubbling near the laundry window — e2e");
    await page.locator("input[name=photos]").setInputFiles({
      name: "bubble.png", mimeType: "image/png",
      buffer: Buffer.from(TINY_SIGNATURE_PNG.split(",")[1], "base64"),
    });
    await page.getByRole("button", { name: "Report an issue" }).click();

    await expect(page).toHaveURL(/issue=reported/);
    // The UI renders &rsquo; — never match a straight apostrophe (house trap).
    await expect(page.getByText(/we.ve got it/i)).toBeVisible();

    const { data: rows } = await sb.from("warranty_issues")
      .select("note, status, photo_paths, account_id").eq("work_order_id", fixture!.workOrderId);
    expect(rows?.length).toBe(1);
    expect(rows![0].status).toBe("open");
    expect(rows![0].account_id).toBe(accountId);
    expect((rows![0].photo_paths as string[]).length).toBe(1);
    // The photo landed in storage too.
    const path = (rows![0].photo_paths as string[])[0];
    const signed = await sb.storage.from("wo-photos").createSignedUrl(path, 60);
    expect(signed.error).toBeNull();
    await sb.storage.from("wo-photos").remove([path]);
  });
});
