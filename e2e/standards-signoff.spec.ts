import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, rpcAsJson, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Finish standards, Step 2: the sign-off, the offers gate and the reminders.
 *
 * AS A NEW PAINTER (a real invite): joining lands on the sign-off with no tab
 * bar — the gate applies from the first second — and six ticks later the
 * confirmation screen, six ack rows, the confirmed event and the document.
 * AS AN EXISTING PAINTER (the e2e contractor): the office invites them, the
 * grace period runs, the reminder sweep claims day 2, they confirm, and the
 * sweep sends nothing more. AS PC: the list says who has signed; an offer to a
 * blocked painter fails AT THE RPC with `error:standards_not_signed` and the
 * trigger refuses a direct insert too; the queue card appears after day 7.
 * Everything made here is removed, and the e2e contractor is left confirmed.
 */

const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";

const run = Date.now().toString(36);
const newbie = { email: `pg.e2e.standards.${run}@example.com`, password: `Standards-${run}-pw!`, name: "Standards Newbie" };
let newbieUserId: string | null = null;
let newbieContractorId: string | null = null;
let e2eContractorId = "";
let job: LoopFixture | null = null;
let savedCols: { standards_invited_at: string | null; standards_grace_until: string | null } | null = null;

const SECTIONS = ["levels", "rules", "time", "interior", "exterior", "defect"] as const;

async function statusOf(id: string): Promise<string> {
  return String(await rpcAs(staff!, "standards_status", { p_contractor_id: id }));
}

async function tickAll(page: Page) {
  for (let i = 0; i < 6; i++) {
    await expect(page.getByTestId("signoff-section")).toHaveAttribute("data-section", SECTIONS[i]);
    await expect(page.getByTestId("signoff-next")).toBeDisabled();
    await page.getByTestId("signoff-tick").click();
    await page.getByTestId("signoff-next").click();
  }
  await expect(page.getByTestId("signoff-done")).toBeVisible({ timeout: 20_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("finish standards — sign-off, offers gate, reminders", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeAll(async () => {
    e2eContractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    // The run leaves the e2e contractor CONFIRMED (the state every other spec
    // wants); only the invite columns are put back.
    const { data: cols } = await db!.from("contractors").select("standards_invited_at, standards_grace_until").eq("id", e2eContractorId).single();
    savedCols = cols as typeof savedCols;
    job = await createLoopFixture(db!, e2eContractorId, [{ heading: "Front", labels: ["Walls"] }]);
    // The gate needs an ISSUED job nobody has been offered yet.
    await db!.from("work_orders").update({ stage: "offered", status: "issued", contractor_id: null }).eq("id", job.workOrderId);
  });

  test.afterAll(async () => {
    if (!db) return;
    await destroyLoopFixture(db, job);
    if (newbieUserId) {
      await db.from("contractors").delete().eq("profile_id", newbieUserId);
      await db.from("profiles").delete().eq("id", newbieUserId);
      await db.auth.admin.deleteUser(newbieUserId);
    }
    await db.from("contractor_invites").delete().eq("email", newbie.email);
    // The e2e contractor: confirmed (as every other spec expects), invite columns as found.
    if (savedCols) await db.from("contractors").update(savedCols).eq("id", e2eContractorId);
    await db.from("automation_claims").delete().eq("automation_key", "contractor_standards_reminder").like("entity_id", `${e2eContractorId}@%`);
    await db.from("contractor_events").delete().eq("contractor_id", e2eContractorId).in("type", ["standards_invited", "standards_invite_sent", "standards_reminder_sent"]);
  });

  test("a new painter joins and is on the sign-off at once, full screen, no offers until all six are ticked", async ({ page }) => {
    test.setTimeout(180_000);
    const token = await rpcAs(staff!, "create_contractor_invite", {
      p_email: newbie.email, p_name: newbie.name, p_company: "Newbie Painting", p_tier: null, p_days: 7,
    });
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    const made = await db!.auth.admin.createUser({ email: newbie.email, password: newbie.password, email_confirm: true, user_metadata: { name: newbie.name } });
    expect(made.error?.message ?? "").toBe("");
    newbieUserId = made.data.user!.id;

    await page.goto(`/join/${token}`);
    await page.getByPlaceholder("Josef Kovac").fill(newbie.name);
    await page.getByPlaceholder("At least 8 characters").fill(newbie.password);
    await page.locator('input[type="password"]').nth(1).fill(newbie.password);
    await page.getByTestId("join-mobile").fill("0400 123 456");
    await page.getByRole("button", { name: /create my account/i }).click();
    // Home redirects to the sign-off: the gate applies from the first second.
    await expect(page).toHaveURL(/\/portal\/standards\/confirm/, { timeout: 30_000 });
    await expect(page.getByTestId("signoff-intro")).toBeVisible();
    await expect(page.locator(".pt .tabs")).toHaveCount(0);

    newbieContractorId = await contractorIdForEmail(db!, newbie.email);
    expect(newbieContractorId).toBeTruthy();
    expect(await statusOf(newbieContractorId!)).toBe("blocked");
    const list = await rpcAsJson<{ contractor_id: string; status: string }[]>(staff!, "standards_statuses", {});
    expect(list.find((x) => x.contractor_id === newbieContractorId)?.status).toBe("blocked");

    await page.getByTestId("signoff-start").click();
    await tickAll(page);
    await expect(page.getByTestId("signoff-done")).toContainText("6 of 6 sections confirmed");

    const { data: acks } = await db!.from("standards_acks").select("section_key, version_id").eq("contractor_id", newbieContractorId!);
    expect((acks ?? []).map((a: { section_key: string }) => a.section_key).sort()).toEqual([...SECTIONS].sort());
    expect(new Set((acks ?? []).map((a: { version_id: string }) => a.version_id)).size).toBe(1);
    const { data: ev } = await db!.from("contractor_events").select("type, detail").eq("contractor_id", newbieContractorId!).eq("type", "standards_confirmed");
    expect(ev).toHaveLength(1);
    expect((ev![0] as { detail: { version_no: number } }).detail.version_no).toBe(1);
    expect(await statusOf(newbieContractorId!)).toBe("confirmed");

    // Ruling S8: the PDF copy lands in their documents (generated in the background).
    await expect.poll(async () => {
      const { data } = await db!.from("contractor_documents").select("id, kind, name").eq("contractor_id", newbieContractorId!).eq("kind", "standards");
      return (data ?? []).length;
    }, { timeout: 90_000, message: "the standards PDF document row" }).toBe(1);

    // Back on Home the tab bar is back and the standards card says confirmed.
    await page.getByTestId("signoff-home").click();
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.locator(".pt .tabs")).toBeVisible();
    await expect(page.getByTestId("home-standards-confirmed")).toContainText("Version 1");
  });

  test("an existing painter: invited by the office, offers keep flowing during grace, stop after it, resume once confirmed", async () => {
    test.setTimeout(120_000);
    // Start them unsigned and uninvited.
    await db!.from("standards_acks").delete().eq("contractor_id", e2eContractorId);
    await db!.from("contractors").update({ standards_invited_at: null, standards_grace_until: null }).eq("id", e2eContractorId);
    expect(await statusOf(e2eContractorId)).toBe("not_invited");

    // Not invited: offers are untouched (launch is Tom's call).
    const start = "2026-12-07";
    const offer1 = await rpcAs(staff!, "send_offer", { p_work_order_id: job!.workOrderId, p_contractor_id: e2eContractorId, p_start: start, p_end: start, p_note: "" });
    expect(offer1).toBe("ok:offered");
    await db!.from("booking_offers").delete().eq("work_order_id", job!.workOrderId);
    await db!.from("work_orders").update({ contractor_id: null }).eq("id", job!.workOrderId);

    // The office invites them: grace starts.
    const invited = String(await rpcAs(staff!, "standards_invite", { p_contractor_id: e2eContractorId }));
    expect(invited).toMatch(/^ok:/);
    expect(await statusOf(e2eContractorId)).toBe("grace");
    const offer2 = await rpcAs(staff!, "send_offer", { p_work_order_id: job!.workOrderId, p_contractor_id: e2eContractorId, p_start: start, p_end: start, p_note: "" });
    expect(offer2).toBe("ok:offered");
    await db!.from("booking_offers").delete().eq("work_order_id", job!.workOrderId);
    await db!.from("work_orders").update({ contractor_id: null }).eq("id", job!.workOrderId);

    // Grace over: the RPC refuses, and so does the table itself.
    await db!.from("contractors").update({ standards_grace_until: new Date(Date.now() - 60_000).toISOString() }).eq("id", e2eContractorId);
    expect(await statusOf(e2eContractorId)).toBe("blocked");
    const offer3 = await rpcAs(staff!, "send_offer", { p_work_order_id: job!.workOrderId, p_contractor_id: e2eContractorId, p_start: start, p_end: start, p_note: "" });
    expect(offer3).toBe("error:standards_not_signed");
    const direct = await db!.from("booking_offers").insert({ work_order_id: job!.workOrderId, contractor_id: e2eContractorId, start_date: start, end_date: start });
    expect(direct.error?.message ?? "").toMatch(/standards_not_signed/);

    // They confirm — six ticks through the RPC, as their own session.
    for (const s of SECTIONS) {
      const r = String(await rpcAs(contractor!, "standards_ack_section", { p_section: s }));
      expect(r).toMatch(s === "defect" ? /^ok:confirmed$/ : /^ok:\d$/);
    }
    expect(await statusOf(e2eContractorId)).toBe("confirmed");
    const offer4 = await rpcAs(staff!, "send_offer", { p_work_order_id: job!.workOrderId, p_contractor_id: e2eContractorId, p_start: start, p_end: start, p_note: "" });
    expect(offer4).toBe("ok:offered");
  });

  test("the reminder sweep claims day 2 after an invite, and nothing once confirmed", async ({ request }) => {
    test.skip(!SECRET, "set CRON_SECRET to run the sweep");
    test.setTimeout(240_000);
    // Unsigned again, invited 2½ days ago: the day-2 rung is due.
    await db!.from("standards_acks").delete().eq("contractor_id", e2eContractorId);
    const invitedAt = new Date(Date.now() - 2.5 * 86_400_000);
    await db!.from("contractors").update({ standards_invited_at: invitedAt.toISOString(), standards_grace_until: new Date(Date.now() + 5 * 86_400_000).toISOString() }).eq("id", e2eContractorId);
    const entity = `${e2eContractorId}@${invitedAt.toISOString()}`;

    const res = await request.get("/api/cron/campaign-sweep?only=standards", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.ok()).toBeTruthy();
    const { data: claims } = await db!.from("automation_claims").select("rung").eq("automation_key", "contractor_standards_reminder").eq("entity_id", entity);
    expect((claims ?? []).map((c: { rung: string }) => c.rung)).toEqual(["day2"]);
    const { data: sent } = await db!.from("contractor_events").select("detail").eq("contractor_id", e2eContractorId).eq("type", "standards_reminder_sent");
    expect((sent ?? []).length).toBeGreaterThanOrEqual(1);

    // Confirmed: a second sweep (with day 4 now due) sends nothing more.
    for (const s of SECTIONS) await rpcAs(contractor!, "standards_ack_section", { p_section: s });
    await db!.from("contractors").update({ standards_invited_at: new Date(Date.now() - 4.5 * 86_400_000).toISOString() }).eq("id", e2eContractorId);
    const before = (sent ?? []).length;
    const res2 = await request.get("/api/cron/campaign-sweep?only=standards", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res2.ok()).toBeTruthy();
    const { data: sent2 } = await db!.from("contractor_events").select("id").eq("contractor_id", e2eContractorId).eq("type", "standards_reminder_sent");
    expect((sent2 ?? []).length).toBe(before);
    expect(await statusOf(e2eContractorId)).toBe("confirmed");
  });

  test("PC: the list says who has signed, and a painter past the grace period is a card with one action", async ({ page }) => {
    test.setTimeout(120_000);
    // The newbie, un-confirmed again and invited 8 days ago past grace: a card.
    await db!.from("standards_acks").delete().eq("contractor_id", newbieContractorId!);
    await db!.from("contractors").update({
      standards_invited_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      standards_grace_until: new Date(Date.now() - 86_400_000).toISOString(),
    }).eq("id", newbieContractorId!);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/contractors");
    const row = page.getByTestId(`standards-${newbieContractorId}`);
    await expect(row).toHaveAttribute("data-status", "blocked");
    await expect(row).toContainText(/no job offers/i);
    await expect(page.getByTestId(`standards-${e2eContractorId}`)).toHaveAttribute("data-status", "confirmed");

    await page.goto(`/contractors/${newbieContractorId}`);
    await expect(page.getByTestId("standards-row")).toHaveAttribute("data-status", "blocked");
    await expect(page.getByTestId("standards-line")).toContainText(/grace ended/);

    await page.goto("/pc");
    const card = page.locator(`[data-testid^="standards-standards_unsigned:contractor:${newbieContractorId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("has not signed the finish standards");
    await expect(card).toContainText("No job offers until they confirm");
    await card.locator('[data-testid^="standards-remind-"]').click();
    // The test stack has no text sender: the button either reads "Text sent" or
    // says plainly that it was not — never silence. Either way the attempt is
    // on the painter's record with the dispatcher's outcome.
    await expect(card.locator('[data-testid^="standards-reminded-"]').or(card.getByText(/Reminder not sent/))).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const { data: reminded } = await db!.from("contractor_events").select("detail").eq("contractor_id", newbieContractorId!).eq("type", "standards_reminder_sent");
      return (reminded ?? []).some((e: { detail: { rung?: string } }) => e.detail?.rung === "office");
    }, { timeout: 20_000 }).toBe(true);
  });
});
