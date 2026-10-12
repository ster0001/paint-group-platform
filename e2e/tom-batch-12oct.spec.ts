import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { followupSentDates, prestartWindows } from "../lib/automations/sweeps/officeDigests";

/**
 * Tom, 12 Oct 2026 — five things, as he asked for them.
 *
 *  1. Estimates: a sent estimate that needs a visit shows how many times the
 *     customer opened it ("Viewed 3×"); "Needs a visit" is a chip under the title.
 *  2. Home: a "need you today" card can be closed off from Home and is gone
 *     after the refresh; the heading counts every card, not the cap.
 *  3–5. The half-hour sweep's office reminders, through the real route in
 *     preview (`?only=office&force=1&dry=1` — nothing sent, nothing claimed,
 *     so the test project never emails Tom or texts the office):
 *     "Today's follow ups" lists an estimate sent three days ago, and the
 *     pre-start reminders count a job starting next business day with no
 *     pre-start list.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";
const run = randomBytes(3).toString("hex");

test.describe("Tom batch 12 Oct", () => {
  test.skip(!staff || !db, missingCreds("STAFF") + " + service key");

  test("1 · estimates list: the view count stays; needs a visit moves under the title", async ({ page }) => {
    const title = `Visit views ${run}`;
    const est = await db!.from("estimates").insert({
      status: "sent", source: "manual", level_of_finish: 3, title, builder_state: { blocks: [] },
      sent_at: new Date(Date.now() - 3_600_000).toISOString(), viewed_at: new Date(Date.now() - 3_000_000).toISOString(),
      share_token: `bt12${randomBytes(18).toString("base64url")}`, total_cents: 100_000, subtotal_cents: 90_909,
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    const id = est.data.id as string;
    try {
      const req = await db!.from("confirmation_requests").insert({ estimate_id: id, requested_by: "customer", kind: "visit", status: "requested", suggested_action: "visit" });
      if (req.error) throw new Error(req.error.message);
      const views = await db!.from("estimate_views").insert([1, 2, 3].map((n) => ({ estimate_id: id, session_id: randomUUID(), dwell_ms: 1_000 * n })));
      if (views.error) throw new Error(views.error.message);

      await signIn(page, staff!, /\/(home|estimates)/);
      await page.goto(`/estimates?status=all&q=${encodeURIComponent(title)}`);
      const pill = page.getByTestId(`estimate-pill-${id}`);
      await expect(pill).toBeVisible({ timeout: 30_000 });
      await expect(pill).toHaveAttribute("data-state", "sent_visit");
      await expect(pill).toContainText("Viewed 3×");
      await expect(pill).not.toContainText(/needs a visit/i);
      await expect(page.getByTestId(`estimate-flag-${id}`)).toHaveText("Needs a visit");
    } finally {
      await db!.from("estimates").delete().eq("id", id);   // cascades the request and the views
    }
  });

  test("2 · home: a card closes off from Home and stays closed", async ({ page }) => {
    // A sales login sees follow-ups; the account name sorts its card first.
    const email = `pg.e2e.home12.${run}@example.com`;
    const made = await db!.auth.admin.createUser({ email, password: "painttest123", email_confirm: true });
    if (made.error) throw new Error(made.error.message);
    const userId = made.data.user!.id;
    const name = `000 Batch12 ${run}`;
    let accountId = "";
    try {
      const prof = await db!.from("profiles").upsert({ id: userId, role: "staff", name: `sales ${run}`, is_owner: false, staff_access: {}, staff_roles: ["sales"] }, { onConflict: "id" });
      if (prof.error) throw new Error(prof.error.message);
      const acc = await db!.from("accounts").insert({ name, email: `batch12.${run}@example.com`, followup_due_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), followup_note: "ring about colours" }).select("id").single();
      if (acc.error) throw new Error(acc.error.message);
      accountId = acc.data.id as string;

      await signIn(page, { email, password: "painttest123" }, /\/(home|estimates|crm)/);
      await page.goto("/home");
      const strip = page.getByTestId("needs-doing");
      await expect(strip).toBeVisible({ timeout: 60_000 });
      const count = Number(((await page.getByTestId("needs-doing-count").textContent()) ?? "").match(/\d+/)?.[0]);
      expect(count).toBeGreaterThanOrEqual(await page.getByTestId("needs-doing-card").count());

      const card = page.getByTestId("needs-doing-card").filter({ hasText: name });
      await expect(card).toBeVisible();
      await card.getByTestId("strip-not-now").click();
      await card.getByRole("button", { name: "For good" }).click();
      await card.getByTestId("strip-dismiss-reason").fill("e2e: closed from Home");
      await card.getByTestId("strip-dismiss-go").click();
      await expect(page.getByTestId("needs-doing-card").filter({ hasText: name })).toHaveCount(0, { timeout: 30_000 });
      await page.reload();
      await expect(page.getByTestId("needs-doing")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("needs-doing-card").filter({ hasText: name })).toHaveCount(0);
    } finally {
      if (accountId) {
        await db!.from("work_item_dismissals").delete().eq("account_id", accountId);
        await db!.from("crm_events").delete().eq("account_id", accountId);
        await db!.from("accounts").delete().eq("id", accountId);
      }
      await db!.auth.admin.deleteUser(userId);
    }
  });

  test("3–5 · the office reminders, previewed through the real sweep route", async ({ request }) => {
    test.skip(!SECRET, "CRON_SECRET not set");
    test.skip(!contractor, missingCreds("CONTRACTOR"));
    const now = new Date();
    const sentDates = followupSentDates(now);
    const windows = prestartWindows(now, new Set());

    let estimateId = "";
    let job: LoopFixture | null = null;
    try {
      if (sentDates) {
        const est = await db!.from("estimates").insert({
          status: "sent", source: "manual", level_of_finish: 3, title: `Follow up ${run}`,
          sent_at: `${sentDates[sentDates.length - 1]}T02:00:00Z`,   // midday-ish Melbourne on the day
          share_token: `bt12f${randomBytes(18).toString("base64url")}`, total_cents: 50_000, subtotal_cents: 45_455,
          builder_state: { blocks: [], contact: { name: `Jo Follow ${run}`, phone: "0400 000 012" }, jobAddress: { address: `12 Batch St ${run}`, city: "Richmond" } },
        }).select("id").single();
        if (est.error) throw new Error(est.error.message);
        estimateId = est.data.id as string;
      }
      if (windows) {
        const contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
        job = await createLoopFixture(db!, contractorId, [{ heading: "Living", labels: ["Walls"] }]);
        const upd = await db!.from("work_orders").update({ stage: "pre_start", start_date: windows[0].through }).eq("id", job.workOrderId);
        if (upd.error) throw new Error(upd.error.message);
        const del = await db!.from("wo_checklist_items").delete().eq("work_order_id", job.workOrderId).eq("phase", "pre_start");
        if (del.error) throw new Error(del.error.message);
      }

      const res = await request.get("/api/cron/campaign-sweep?only=office&force=1&dry=1", { headers: { authorization: `Bearer ${SECRET}` } });
      expect(res.status()).toBe(200);
      const body = await res.json() as { office: {
        followups: { outcome: string; rows?: { customer: string; address: string; phone: string; link: string }[] };
        prestart: string | { which: string; count: number; outcome: string; workOrderIds?: string[]; subject?: string }[];
      } };

      if (sentDates) {
        expect(body.office.followups.outcome).toBe("dry");
        const row = body.office.followups.rows?.find((r) => r.link.endsWith(`/quote?id=${estimateId}`));
        expect(row).toMatchObject({ customer: `Jo Follow ${run}`, phone: "0400 000 012" });
        expect(row?.address).toContain(`12 Batch St ${run}`);
      } else {
        expect(body.office.followups.outcome).toBe("not_now");   // Saturday / Sunday
      }

      if (windows) {
        const list = body.office.prestart as Exclude<typeof body.office.prestart, string>;
        const final = list.find((p) => p.which === "final");
        expect(final?.outcome).toBe("dry");
        expect(final?.workOrderIds).toContain(job!.workOrderId);
        expect(final?.subject).toMatch(/^FINAL reminder: \d+ jobs? starts? next business day/);
        expect(list.find((p) => p.which === "two_days")?.workOrderIds ?? []).not.toContain(job!.workOrderId);
      } else {
        expect(body.office.prestart).toBe("not_now");
      }
    } finally {
      if (estimateId) await db!.from("estimates").delete().eq("id", estimateId);
      await destroyLoopFixture(db!, job);
    }
  });
});
