import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { deleteUserByEmail, magicLinkFor, openMagicLink } from "./fixtures/portal";

/**
 * Work order UX Step 3 — the 40% check-in (Trigger B) and the defect-day note
 * (Trigger C), drafted by the half-hour sweep onto the Customer updates queue.
 *
 * A five-day job with today as day 3: both notes are due (the check-in at or
 * past 40%, the defect day two working days before the last). A two-day job
 * ending today: the defect-day note only (R11), no check-in (R10). The sweep is
 * idempotent — a second run drafts nothing more. With the switch on, the sweep
 * sends both at once and the customer reads them on the timeline with the
 * sender line; the check-in never leaves the timeline.
 */

const painter = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";

let five: LoopFixture | null = null;
let two: LoopFixture | null = null;
let contractorId = "";
let contractorBefore: { works_saturday: boolean | null; works_sunday: boolean | null } | null = null;
let messagingBefore: unknown = null;
let accountId = "";
const run = randomBytes(4).toString("hex");
const portalEmail = `pg.e2e.notes.${run}@example.com`;

const melb = (offsetDays: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(Date.now() + offsetDays * 86_400_000));

type Row = { id: string; kind: string; status: string; draft_text: string; sender_name: string | null };
async function notes(workOrderId: string): Promise<Row[]> {
  const { data, error } = await db!.from("wo_updates").select("id, kind, status, draft_text, sender_name")
    .eq("work_order_id", workOrderId).in("kind", ["checkin_40", "defect_day"]).order("kind");
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

async function setQueue(patch: { mode?: "auto" | "approve" }) {
  const { data } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
  const saved = (data?.value as Record<string, unknown> | null) ?? {};
  const controls = { ...((saved.controls as Record<string, Record<string, unknown>>) ?? {}) };
  controls.customer_updates_queue = { ...(controls.customer_updates_queue ?? {}), ...patch };
  // Drafted at any hour for the run; sent at any hour too (D1 is the office's rule, not the test's).
  const value = { ...saved, controls, customerCheckinTime: "00:00", customerDefectDayTime: "00:00",
    quietHours: { weekday: [0, 24], saturday: [0, 24], sunday: [0, 24] } };
  const { error } = await db!.from("settings").upsert({ key: "messaging", value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

test.describe("customer notes — 40% check-in and defect day", () => {
  test.skip(!painter || !staff, missingCreds("STAFF"));
  test.skip(!db || !SECRET, "set SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, painter!.email))!;
    expect(contractorId).toBeTruthy();
    const { data: c } = await db!.from("contractors").select("works_saturday, works_sunday").eq("id", contractorId).single();
    contractorBefore = c as typeof contractorBefore;
    // Works every day for the run, so "two days ago → two days on" is five booked days whatever the weekday.
    await db!.from("contractors").update({ works_saturday: true, works_sunday: true }).eq("id", contractorId);
    const { data: m } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    messagingBefore = m ? (m as { value: unknown }).value : null;
    await setQueue({ mode: "approve" });

    const acct = await db!.from("accounts").insert({ email: portalEmail, name: "Raj Patel" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id;

    five = await createLoopFixture(db!, contractorId, [{ heading: "Bed 1", labels: ["Walls"] }]);
    await db!.from("estimates").update({ accepted_name: "Raj Patel", account_id: accountId, title: "22 Bell St" }).eq("id", five.estimateId);
    await db!.from("work_orders").update({ start_date: melb(-2), end_date: melb(2) }).eq("id", five.workOrderId);

    two = await createLoopFixture(db!, contractorId, [{ heading: "Hall", labels: ["Walls"] }]);
    await db!.from("estimates").update({ accepted_name: "Sophie Lin" }).eq("id", two.estimateId);
    await db!.from("work_orders").update({ start_date: melb(-1), end_date: melb(0) }).eq("id", two.workOrderId);
  });

  test.afterAll(async () => {
    if (messagingBefore === null) await db!.from("settings").delete().eq("key", "messaging");
    else await db!.from("settings").upsert({ key: "messaging", value: messagingBefore }, { onConflict: "key" });
    if (contractorBefore) await db!.from("contractors").update(contractorBefore).eq("id", contractorId);
    await destroyLoopFixture(db!, five);
    await destroyLoopFixture(db!, two);
    if (accountId) {
      await db!.from("account_users").delete().eq("account_id", accountId);
      await db!.from("accounts").delete().eq("id", accountId);
    }
    await deleteUserByEmail(db!, portalEmail);
  });

  test("the sweep drafts both notes on the five-day job and only the defect day on the two-day job — once", async ({ request }) => {
    const res = await request.get("/api/cron/campaign-sweep?only=updates", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.status()).toBe(200);
    const body = await res.json() as { customerNotes?: { checkins: number; defectDays: number }; customerUpdates?: { on: boolean; sent: number } };
    expect(body.customerNotes!.checkins).toBeGreaterThanOrEqual(1);
    expect(body.customerNotes!.defectDays).toBeGreaterThanOrEqual(2);
    expect(body.customerUpdates!.on).toBe(false);

    const a = await notes(five!.workOrderId);
    expect(a.map((r) => r.kind)).toEqual(["checkin_40", "defect_day"]);
    expect(a.every((r) => r.status === "drafted")).toBe(true);
    expect(a[0].draft_text).toBe("Hi Raj, just touching base to see how you're finding things so far. Happy with the progress? Anything at all, reply here and we'll sort it.");
    expect(a[1].draft_text).toMatch(/^Hi Raj, we've started going over the job today/);

    const b = await notes(two!.workOrderId);
    expect(b.map((r) => r.kind)).toEqual(["defect_day"]);
    expect(b[0].draft_text).toMatch(/^Hi Sophie, /);

    // Idempotent: a second run adds nothing.
    const again = await request.get("/api/cron/campaign-sweep?only=updates", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    const body2 = await again.json() as { customerNotes?: { checkins: number; defectDays: number } };
    expect(body2.customerNotes).toMatchObject({ checkins: 0, defectDays: 0 });
    expect(await notes(five!.workOrderId)).toHaveLength(2);
    expect(await notes(two!.workOrderId)).toHaveLength(1);
  });

  test("PC sees both kinds on the queue", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/updates");
    const [checkin, defect] = await notes(five!.workOrderId);
    await expect(page.getByTestId(`kind-${checkin.id}`)).toHaveText("40% check-in");
    await expect(page.getByTestId(`kind-${defect.id}`)).toHaveText("Defect day");
    await expect(page.getByTestId(`to-${checkin.id}`)).toContainText("To Raj Patel · from ");
  });

  test("with the switch on, the sweep sends both at once; the customer reads them with the sender line", async ({ request, page }) => {
    await setQueue({ mode: "auto" });
    const res = await request.get("/api/cron/campaign-sweep?only=updates", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    const body = await res.json() as { customerUpdates?: { on: boolean; sent: number } };
    expect(body.customerUpdates!.on).toBe(true);
    expect(body.customerUpdates!.sent).toBeGreaterThanOrEqual(3);
    const rows = await notes(five!.workOrderId);
    expect(rows.every((r) => r.status === "sent" && (r.sender_name ?? "").length > 0)).toBe(true);
    // The check-in went to the timeline only: no email or text was recorded against the job for it.
    const { data: msgs } = await db!.from("messages").select("id").eq("work_order_id", five!.workOrderId);
    expect(msgs ?? []).toEqual([]);

    await openMagicLink(page, await magicLinkFor(db!, portalEmail));
    await page.goto("/account/project");
    await expect(page.getByText(/Just touching base to see how you're finding things so far/)).toBeVisible();
    await expect(page.getByText(/We've started going over the job today/)).toBeVisible();
    await expect(page.locator(".tl-item h3", { hasText: `${rows[0].sender_name}, ` }).first()).toBeVisible();
    await expect(page.getByTestId("message-coordinator")).toHaveCount(1);
    await expect(page.getByTestId("message-coordinator")).toHaveText(`Reply to ${rows[0].sender_name}`);
  });
});
