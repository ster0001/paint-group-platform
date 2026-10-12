import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";
import { cleanupPaymentsJobs, isoDay, makePaymentsJob, type PaymentsJob } from "./fixtures/paymentsJobs";

/**
 * Payments merge, Step 4 — message follow-up (docs/briefs/claude-code-brief-payments-merge.md §4.4).
 *
 *  · Message opens the customer's chat in the dock with the right template
 *    written in — Overdue pre-selected on an overdue invoice — and the pay
 *    link filled by the server.
 *  · Nothing is posted until a person presses Send.
 *  · The sent message is in the chat thread AND on the invoice's events; the
 *    row then says "messaged today".
 *  · A template edited in Settings is what the next Message writes.
 *  · A customer can't log a message against an invoice.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const stamp = `PM4${Date.now().toString(36).slice(-5).toUpperCase()}`;
const PAGE = "/invoicing/payments";
const made: PaymentsJob[] = [];

const card = (page: Page, j: PaymentsJob) => page.locator(".pm .job", { hasText: j.address });
const staffLines = async (estimateId: string) => {
  const { data, error } = await db!.from("estimate_messages").select("body").eq("estimate_id", estimateId).eq("direction", "staff");
  if (error) throw error;
  return (data ?? []).map((m) => (m as { body: string }).body);
};

test.describe("Payments → Message — a customer can't log one", () => {
  test("an anonymous session is refused", async () => {
    const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await visitor.auth.signInAnonymously()).error).toBeNull();
    const { data, error } = await visitor.rpc("invoice_log_message", { p_invoice_id: "00000000-0000-4000-8000-000000000000", p_template: "overdue" });
    expect(error?.code === "42501" || data === "error:not_staff", JSON.stringify(data ?? error)).toBe(true);
  });
});

test.describe("Payments → Message — as staff", () => {
  test.setTimeout(180_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture jobs");

  let savedMessaging: unknown = null;
  test.afterAll(async () => {
    if (!db) return;
    // Put Settings back exactly as found.
    if (savedMessaging !== null) await db.from("settings").update({ value: savedMessaging }).eq("key", "messaging");
    if (!process.env.E2E_KEEP) await cleanupPaymentsJobs(db, made);
  });

  test("the draft is written for you, Overdue first; nothing posts until Send; then the thread, the invoice and the row show it", async ({ page }) => {
    const j = await makePaymentsJob(db!, contractor!.email, stamp, "Overdue", {
      contractCents: 400_000, stage: "in_progress", startDate: isoDay(-5),
      invoices: [
        { kind: "deposit", status: "paid", total: 200_000, due: isoDay(-20), paid: true },
        { kind: "progress", status: "sent", total: 100_000, due: isoDay(-4) },
      ],
    });
    made.push(j);
    const { data: inv } = await db!.from("invoices").select("id, token").eq("estimate_id", j.f.estimateId).eq("kind", "progress").single();
    const invoice = inv as { id: string; token: string };

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`${PAGE}?q=${encodeURIComponent(j.address)}`);
    await card(page, j).getByRole("button", { name: "Message" }).click();

    const dock = page.getByTestId("staff-dock");
    await expect(dock).toHaveAttribute("data-open", "1", { timeout: 20_000 });
    const chips = dock.getByTestId("dock-templates");
    await expect(chips.getByRole("button")).toHaveText(["Friendly reminder", "Overdue", "Payment received"]);
    await expect(chips.getByRole("button", { name: "Overdue" })).toHaveAttribute("aria-pressed", "true");
    const box = dock.getByTestId("dock-input");
    await expect(box).toHaveValue(/^Hello Overdue, I hope you are well\. Our records show the invoice of \$1,000\.00 for .+ fell due on .+ and is still outstanding\./);
    await expect(box).toHaveValue(new RegExp(`/i/${invoice.token}`));         // the pay link, from the server

    // Nothing has been posted yet.
    expect(await staffLines(j.f.estimateId)).toEqual([]);

    // A chip swaps the draft; staff edit it; Send posts it.
    await chips.getByRole("button", { name: "Friendly reminder" }).click();
    await expect(box).toHaveValue(/thank you again for having us at/);
    await box.fill("Hello Overdue, just checking the progress invoice reached you. Many thanks, Paint Group");
    await dock.getByTestId("dock-send").click();
    await expect.poll(() => staffLines(j.f.estimateId), { timeout: 20_000 }).toEqual(["Hello Overdue, just checking the progress invoice reached you. Many thanks, Paint Group"]);

    const { data: ev } = await db!.from("invoice_events").select("type, meta").eq("invoice_id", invoice.id).eq("type", "nudge_sent");
    expect(ev ?? []).toHaveLength(1);
    expect((ev![0] as { meta: { template: string; via: string } }).meta).toMatchObject({ template: "reminder", via: "chat" });

    await page.reload();
    await expect(card(page, j)).toContainText("messaged today");
  });

  test("a template edited in Settings is what the next Message writes", async ({ page }) => {
    const { data: row } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    savedMessaging = (row as { value: unknown } | null)?.value ?? {};
    const edited = `Hello {{first_name}}, edited ${stamp}: {{amount}} for {{address}} is overdue. {{pay_link}}`;
    await db!.from("settings").upsert({ key: "messaging", value: { ...(savedMessaging as object), paymentMsgOverdue: edited } });

    const j = await makePaymentsJob(db!, contractor!.email, stamp, "Edited", {
      contractCents: 300_000, stage: "pre_start", startDate: isoDay(2),
      invoices: [{ kind: "deposit", status: "sent", total: 150_000, due: isoDay(-3) }],
    });
    made.push(j);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`${PAGE}?q=${encodeURIComponent(j.address)}`);
    await card(page, j).getByRole("button", { name: "Message" }).click();
    const dock = page.getByTestId("staff-dock");
    await expect(dock.getByTestId("dock-templates").getByRole("button")).toHaveText(["Deposit reminder", "Overdue", "Payment received"]);
    await expect(dock.getByTestId("dock-input")).toHaveValue(new RegExp(`^Hello Edited, edited ${stamp}: \\$1,500\\.00 for `));
  });
});
