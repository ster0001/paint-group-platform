import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Session 1 of the messaging brief (16 Sep 2026) — "Office approves first".
 *
 *   a pending automatic message shows on Today as one card and on
 *   CRM → Messages to approve · Edit then send changes the subject and sends
 *   (recorded in `messages` with the automation key) · Skip sends nothing
 *   and says why · a held row shows its release time.
 *
 * The rows are seeded the way the dispatcher writes them (the dispatcher's
 * decision rules are pinned in lib/automations/decide.test.ts with a fixed
 * clock; this spec drives the screens a person uses).
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const made: string[] = [];

async function seedHold(status: "pending" | "held", extra: Record<string, unknown> = {}): Promise<string> {
  const stamp = Date.now().toString(36);
  const { data, error } = await db!.from("automation_holds").insert({
    automation_key: "appointment_confirmation", audience: "customer",
    to_email: `pg.e2e.hold.${stamp}@example.com`, channels: ["email"],
    subject: `E2E booking confirmed ${stamp}`,
    body_html: `<html><body><p>Hi</p><!--BODY--><p style="margin:0 0 12px">Your painting is booked in.</p><!--/BODY--><p>Paint Group</p></body></html>`,
    ctx: { kind: "appointment" }, reason: status === "pending" ? "approve" : "quiet",
    reason_detail: status === "pending" ? "Office approves first." : "Outside sending hours — held until they open.",
    release_at: status === "held" ? new Date(Date.now() + 6 * 3_600_000).toISOString() : null,
    status, ...extra,
  }).select("id").single();
  if (error) throw error;
  made.push(data!.id as string);
  return data!.id as string;
}

test.describe("messages to approve", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to seed the queue");

  test.afterAll(async () => {
    if (made.length && !process.env.E2E_KEEP) {
      await db!.from("messages").delete().like("to_address", "pg.e2e.hold.%@example.com");
      await db!.from("automation_holds").delete().in("id", made);
    }
  });

  test("a pending message is one card on Today and can be edited, sent, or skipped from the queue", async ({ page }) => {
    const toSend = await seedHold("pending");
    const toSkip = await seedHold("pending");
    const held = await seedHold("held");

    await signIn(page, staff!, /\/estimates/);
    // The test project's Today runs to several pages — walk them until the card shows.
    let found = false;
    for (let p = 1; p <= 4 && !found; p++) {
      await page.goto(`/crm/today?f=approvals&who=all&page=${p}`);
      await page.getByText(/Approvals/).first().waitFor();
      found = (await page.getByText(/job messages? waiting for approval/).count()) > 0;
    }
    expect(found, "the message_approval card is on Today").toBe(true);

    await page.goto("/crm/messages/queue");
    const card = page.getByTestId(`hold-${toSend}`);
    await expect(card).toContainText("Booking confirmed");
    await expect(card).toContainText("to approve");
    await expect(page.getByTestId(`hold-${held}`)).toContainText(/held · goes/);

    // Edit then send: the subject changes, the send goes through the one send path.
    await card.getByTestId("edit-one").click();
    await card.getByTestId("edit-subject").fill("E2E edited subject");
    await card.getByTestId("edit-send").click();
    await expect(page.getByTestId("queue-said")).toContainText(/Sent|not sent/, { timeout: 20_000 });
    await expect(page.getByTestId(`hold-${toSend}`)).toHaveCount(0);
    const { data: sentRow } = await db!.from("automation_holds").select("status, decided_by, result").eq("id", toSend).single();
    expect(sentRow!.status).toBe("sent");
    expect(sentRow!.decided_by).toBeTruthy();
    const { data: msg } = await db!.from("messages").select("subject, meta, status").eq("subject", "E2E edited subject").order("created_at", { ascending: false }).limit(1).maybeSingle();
    expect(msg).toBeTruthy();
    expect((msg!.meta as { automation?: string }).automation).toBe("appointment_confirmation");

    // Skip: nothing sent, the reason on the row.
    await page.getByTestId(`hold-${toSkip}`).getByTestId("skip-one").click();
    await expect(page.getByTestId("queue-said")).toContainText("Skipped", { timeout: 20_000 });
    const { data: skipped } = await db!.from("automation_holds").select("status, result").eq("id", toSkip).single();
    expect(skipped!.status).toBe("skipped");
    expect((skipped!.result as { reason: string }).reason).toMatch(/Skipped/);
    await expect(page.getByTestId(`done-${toSkip}`)).toContainText("skipped");

    // Switched off → a held row released later is skipped, not sent.
    const { data: m } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    const before = (m?.value as Record<string, unknown> | null) ?? null;
    const disabled = Array.isArray(before?.disabled) ? (before!.disabled as string[]) : [];
    await db!.from("settings").upsert({ key: "messaging", value: { ...(before ?? {}), disabled: [...new Set([...disabled, "appointment_confirmation"])] } }, { onConflict: "key" });
    try {
      await page.getByTestId(`hold-${held}`).getByTestId("approve-one").click();
      await expect(page.getByTestId("queue-said")).toContainText("no longer needed", { timeout: 20_000 });
      const { data: offRow } = await db!.from("automation_holds").select("status, result").eq("id", held).single();
      expect(offRow!.status).toBe("skipped");
      expect((offRow!.result as { reason: string }).reason).toMatch(/switched off/i);
    } finally {
      if (before) await db!.from("settings").upsert({ key: "messaging", value: before }, { onConflict: "key" });
      else await db!.from("settings").delete().eq("key", "messaging");
    }
  });
});
