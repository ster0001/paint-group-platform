import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient, createLoopFixture, destroyLoopFixture, type LoopFixture } from "./fixtures/woLoop";
import { deleteUserByEmail, magicLinkFor, openMagicLink } from "./fixtures/portal";
import { TINY_SIGNATURE_PNG } from "./helpers";

/**
 * 3a-4 · The Project Timeline, as the signed-in customer.
 *
 * What must hold: the feed renders only what the WO loop captured — SENT
 * updates (drafts never), before/progress photos as signed renditions
 * (qa-kind photos NEVER), the pass-only quality milestone, variation cards
 * that reuse the /v flow, area rollups in customer words, and who's-on-
 * your-job showing first names only.
 */

const db: SupabaseClient | null = serviceClient();

test.describe("portal timeline (3a-4)", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the portal timeline suite");

  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.timeline.${run}@example.com`;
  const painterEmail = `pg.e2e.painter.${run}@example.com`;
  let fixture: LoopFixture | null = null;
  /** A second, signed-off job on the same account — the project switcher (D1) and the past tense (D3). */
  let fixture2: LoopFixture | null = null;
  let accountId = "";
  let contractorId = "";
  let painterUserId = "";
  const photoPaths: string[] = [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
  const daysFromToday = (n: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(Date.now() + n * 86_400_000));

  test.beforeAll(async () => {
    const sb = db!;

    // A painter with a first name the card can show.
    const painter = await sb.auth.admin.createUser({
      email: painterEmail, password: "painttest123", email_confirm: true,
      user_metadata: { name: "Marco Verratti" },
    });
    if (painter.error) throw new Error(painter.error.message);
    painterUserId = painter.data.user!.id;
    await sb.from("profiles").update({ name: "Marco Verratti" }).eq("id", painterUserId);
    const c = await sb.from("contractors").insert({ profile_id: painterUserId, active: true }).select("id").single();
    if (c.error) throw new Error(`contractor fixture: ${c.error.message}`);
    contractorId = c.data.id;

    fixture = await createLoopFixture(sb, contractorId, [
      { heading: "Hallway & stairs", labels: ["Walls", "Ceiling"] },
      { heading: "Lounge", labels: ["Walls", "Feature wall"] },
      // D2: the office adds extras as an area; once one is approved the row must not read "Not started".
      { heading: "Variations", labels: ["Extra work"] },
    ]);
    fixture2 = await createLoopFixture(sb, contractorId, [{ heading: "Kitchen", labels: ["Walls"] }]);

    // The account chain.
    const acct = await sb.from("accounts").insert({ email, name: "Margaret Timeline" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id;
    const link = await sb.from("estimates")
      .update({ account_id: accountId, title: "12 Acacia Street", accepted_total_cents: 845_000 })
      .eq("id", fixture.estimateId);
    if (link.error) throw new Error(`estimate link: ${link.error.message}`);
    const link2 = await sb.from("estimates").update({ account_id: accountId, title: "7 Oak Court" }).eq("id", fixture2.estimateId);
    if (link2.error) throw new Error(`estimate link 2: ${link2.error.message}`);
    await sb.from("work_orders").update({ stage: "closed", status: "complete" }).eq("id", fixture2.workOrderId);

    // Booking dates → "Day 3 of 6".
    await sb.from("work_orders")
      .update({ start_date: daysFromToday(-2), end_date: daysFromToday(3) })
      .eq("id", fixture.workOrderId);

    // Ticks: hallway done, lounge half-prepped.
    for (const s of fixture.surfaces) {
      const state = s.heading.startsWith("Hallway") ? "done" : s.label === "Walls" ? "prepped" : "todo";
      await sb.from("wo_surfaces").update({ state, state_changed_at: new Date().toISOString() }).eq("id", s.id);
    }

    // Milestone events + QA pass.
    await sb.from("wo_events").insert({
      work_order_id: fixture.workOrderId, type: "stage_changed",
      from_stage: "pre_start", to_stage: "in_progress", actor_kind: "system",
      created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    await sb.from("wo_qa_checks").insert({
      work_order_id: fixture.workOrderId, kind: "final", result: "pass",
      checked_at: new Date(Date.now() - 86_400_000).toISOString(), scheduled_for: daysFromToday(-1),
    });

    // Photos: a before (2 days ago), a progress (today) — and a qa-kind one
    // that must never render.
    const png = Buffer.from(TINY_SIGNATURE_PNG.split(",")[1], "base64");
    const photo = async (kind: string, area: string, caption: string, agoDays: number) => {
      const path = `e2e-timeline/${run}/${kind}-${Math.random().toString(36).slice(2, 8)}.png`;
      const up = await sb.storage.from("wo-photos").upload(path, png, { contentType: "image/png" });
      if (up.error) throw new Error(`photo upload: ${up.error.message}`);
      photoPaths.push(path);
      const row = await sb.from("wo_photos").insert({
        work_order_id: fixture!.workOrderId, kind, area, caption, storage_path: path,
        created_at: new Date(Date.now() - agoDays * 86_400_000).toISOString(),
      });
      if (row.error) throw new Error(`photo row: ${row.error.message}`);
    };
    await photo("before", "Hallway", "Before — hallway", 2);
    await photo("progress", "Hallway", "First coat going on", 0);
    await photo("qa", "Hallway", "QA close-up — internal", 0);

    // The PC-approved daily update, SENT — plus a drafted one that must not leak.
    await sb.from("wo_updates").insert([
      {
        work_order_id: fixture.workOrderId, for_date: today, status: "sent",
        draft_text: "draft wording", final_text: "First coat on in the hallway today — it needs to dry overnight, then the final coat goes on.",
        sent_at: new Date().toISOString(),
      },
      {
        work_order_id: fixture.workOrderId, for_date: daysFromToday(1), status: "drafted",
        draft_text: "TOMORROW-DRAFT-MUST-NOT-RENDER",
      },
    ]);

    // Variations: one waiting on the customer, one declined (kept on file).
    await sb.from("wo_variations").insert([
      {
        work_order_id: fixture.workOrderId, category: "rot", comment: "Window sill rot",
        status: "priced", price_cents: 34_000, customer_token: `e2evt${run}`,
      },
      {
        work_order_id: fixture.workOrderId, category: "extra_scope", comment: "Paint the laundry too",
        status: "declined", customer_responded_at: new Date().toISOString(),
      },
      {
        work_order_id: fixture.workOrderId, category: "extra_scope", comment: "Paint the hallway cupboard",
        status: "customer_approved", price_cents: 25_000, customer_token: `e2eva${run}`, customer_responded_at: new Date().toISOString(),
      },
    ]);

    // Deposit paid → milestone + Money agreement.
    const inv = await sb.from("invoices").insert({
      estimate_id: fixture.estimateId, kind: "deposit", status: "paid",
      number: `INV-TL${run}`, token: `tltok${run}`,
      subtotal_ex_cents: 230_455, gst_cents: 23_045, total_inc_cents: 253_500,
      issued_on: daysFromToday(-5), due_on: daysFromToday(2),
    }).select("id").single();
    if (!inv.error) {
      await sb.from("payments").insert({
        invoice_id: inv.data.id, amount_cents: 253_500, status: "succeeded",
        method: "bank_transfer", paid_on: daysFromToday(-5), receipt_number: `RCT-TL${run}`,
      });
    }
  });

  test.afterAll(async () => {
    const sb = db!;
    if (fixture) {
      const { data: invs } = await sb.from("invoices").select("id").eq("estimate_id", fixture.estimateId);
      const ids = (invs ?? []).map((i) => i.id);
      if (ids.length) await sb.from("payments").delete().in("invoice_id", ids);
      await destroyLoopFixture(sb, fixture);
    }
    if (fixture2) await destroyLoopFixture(sb, fixture2);
    if (photoPaths.length) await sb.storage.from("wo-photos").remove(photoPaths);
    if (accountId) {
      await sb.from("account_users").delete().eq("account_id", accountId);
      await sb.from("accounts").delete().eq("id", accountId);
    }
    if (contractorId) await sb.from("contractors").delete().eq("id", contractorId);
    for (const e of [email, painterEmail]) await deleteUserByEmail(sb, e);
  });

  test("the timeline renders the job day by day — and only what the customer may see", async ({ page }) => {
    const sb = db!;
    await openMagicLink(page, await magicLinkFor(sb, email));
    await page.goto("/account/project");

    // Header + rollups in customer words.
    await expect(page.locator("h1")).toHaveText("Your project, day by day");
    await expect(page.getByText("12 Acacia Street")).toBeVisible();
    await expect(page.getByText("Day 3 of 6")).toBeVisible();
    const hallway = page.locator(".area", { hasText: "Hallway & stairs" });
    await expect(hallway.locator(".chip")).toHaveText("Done ✓");
    const lounge = page.locator(".area", { hasText: "Lounge" });
    await expect(lounge.locator(".chip")).toHaveText("Being prepped");
    // D2: the approved extra is one row with count and total; no "Variations · Not started".
    const extras = page.locator(".area", { hasText: "Extra work · 1 approved" });
    await expect(extras).toContainText("$250.00");
    await expect(extras.locator(".chip")).toHaveText("Approved");
    expect(await page.locator(".area", { hasText: /^Variations/ }).count()).toBe(0);
    // D3: the job is under way — present tense.
    await expect(page.getByRole("heading", { name: "Who's at your home" })).toBeVisible();

    // Who's at your home: first name only.
    await expect(page.getByText("Marco", { exact: true })).toBeVisible();
    expect(await page.getByText("Verratti").count()).toBe(0);

    // The SENT update renders with its photos; the draft never does.
    await expect(page.getByText(/First coat on in the hallway today/)).toBeVisible();
    await expect(page.getByText("Checked and sent by the office")).toBeVisible();
    expect(await page.getByText("TOMORROW-DRAFT-MUST-NOT-RENDER").count()).toBe(0);

    // Photos: exactly the before + progress renditions — the qa photo never.
    await expect(page.locator(".pgrid img")).toHaveCount(2);
    expect(await page.getByText(/QA close-up/).count()).toBe(0);
    const src = await page.locator(".pgrid img").first().getAttribute("src");
    expect(src).toMatch(/^\/account\/photo\/[0-9a-f-]{36}\?size=thumb$/); // minted on demand (27 Oct 2026)
    const hop = await page.request.get(src!, { maxRedirects: 0 });
    expect(hop.headers()["location"]).toContain("/render/image/"); // a rendition, not the original object path

    // Quality check: the pass milestone only.
    await expect(page.getByText("Quality check passed").first()).toBeVisible();

    // Variations: pending links into the /v flow; declined stays kindly on file.
    const pending = page.locator(".card", { hasText: "Something needs your say-so" });
    await expect(pending).toContainText("$340.00");
    await expect(pending.getByRole("link", { name: "Review & approve" })).toHaveAttribute("href", `/v/e2evt${run}`);
    await expect(page.getByText("You said no thanks")).toBeVisible();

    // Milestones.
    await expect(page.getByText("Deposit received — you're booked")).toBeVisible();
    await expect(page.getByText("We're underway")).toBeVisible();

    // D4: the entry says how many photos; the lightbox opens a larger rendition, steps
    // between the photos of that entry with the area label and "n of m", and closes.
    await expect(page.getByTestId("photo-count").first()).toContainText(/2 photos/);
    await page.locator(".pgrid img").first().click();
    await expect(page.locator(".lightbox img")).toBeVisible();
    await expect(page.getByTestId("lightbox-position")).toHaveText("1 of 2");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("lightbox-position")).toHaveText("2 of 2");
    await page.getByRole("button", { name: "Next photo" }).click();
    await expect(page.getByTestId("lightbox-position")).toHaveText("1 of 2");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".lightbox")).toHaveCount(0);

    // D1: two jobs → the switcher; the signed-off one reads in the past tense (D3).
    await expect(page.getByTestId("project-chip")).toHaveCount(2);
    await page.getByTestId("project-chip").filter({ hasText: "7 Oak Ct" }).click();
    await expect(page).toHaveURL(new RegExp(`project=${fixture2!.workOrderId}`));
    await expect(page.getByText("7 Oak Court")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who painted your home" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who looked after your job" })).toBeVisible();
    await page.goto("/account/project");

    // The eyeball artefact (phone frame).
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({ path: "test-results/look-portal/phone-project.png", fullPage: true });
    await page.screenshot({ path: "docs/briefs/portal-ux-light-screens/project-phone.png", fullPage: true });
  });
});
