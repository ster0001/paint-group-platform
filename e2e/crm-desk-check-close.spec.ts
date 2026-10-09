import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, signIn, gotoTodayWith } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 8 Oct — "Fix the price without a visit" on CRM Today.
 *
 *   1. Once an estimate has been SENT for that customer, the card goes by
 *      itself. Work items are derived, so the rule lives in the derivation
 *      (lib/crm/work-queue.ts buildDeskCheckItems), not in a stored dismissal.
 *   2. "Not this one" on that card just closes it — one tap, no presets, no
 *      reason box — and it stays closed after a reload.
 *
 * Staff-only screen: there is no customer view of CRM Today to drive, so
 * these run as staff (the customer side of a desk check is covered by the
 * customer-journey specs, which this change does not touch).
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(4).toString("hex");

const room = (id: number, name: string) => ({
  id, kind: "area", name, type: "Interior", areaType: "room", roomType: "bedroom", L: 4, W: 3.5, H: 2.4, isOption: false,
  description: "", open: false, media: [], origin: "customer_stated", confidence: 0.9, assumedFields: [], extractionSourceId: null,
  surfaces: [{ id: id * 10, code: "Walls", internalLabel: "Walls", clientLabel: "Walls", count: 1, coats: 2, prepHr: 0, crewNote: "", origin: "customer_stated", confidence: 0.9, assumedFields: [] }],
});

const accounts: string[] = [];
const estimates: string[] = [];

async function seedAccount(tag: string): Promise<string> {
  const { data, error } = await db!.from("accounts")
    .insert({ email: `pg.e2e.deskclose.${tag}.${run}@example.com`, name: `Desk Close ${tag} ${run}`, account_type: "residential" })
    .select("id").single();
  if (error) throw new Error(`account insert: ${error.message}`);
  accounts.push(data.id as string);
  return data.id as string;
}

/** A wizard estimate whose customer asked us to fix the price without a visit. */
async function seedAsk(accountId: string, title: string): Promise<string> {
  const est = await db!.from("estimates").insert({
    title, status: "draft", source: "customer_intake", total_cents: 300_000, account_id: accountId,
    builder_state: { blocks: [room(1, "Bed 1")], aiDeferred: [], modSel: {}, materials: {} },
  }).select("id").single();
  if (est.error) throw new Error(`estimate insert: ${est.error.message}`);
  const id = est.data.id as string;
  estimates.push(id);
  const cr = await db!.from("confirmation_requests").insert({
    estimate_id: id, requested_by: "customer", kind: "remote", status: "requested", suggested_action: "fix",
    requested_at: new Date(Date.now() - 60 * 60_000).toISOString(), pack: { totalCents: 300_000 },
  });
  if (cr.error) throw new Error(`confirmation insert: ${cr.error.message}`);
  return id;
}

/** What send_estimate leaves behind: status, sent_at, and the 'sent' event. */
async function markSent(estimateId: string): Promise<void> {
  const up = await db!.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", estimateId);
  if (up.error) throw new Error(`mark sent: ${up.error.message}`);
  const ev = await db!.from("estimate_events").insert({ estimate_id: estimateId, type: "sent", payload: { by: null } });
  if (ev.error) throw new Error(`sent event: ${ev.error.message}`);
}

const TODAY = "/crm/today?who=all&f=approvals";
const card = (page: Page, title: string) => page.locator(".qitem", { hasText: `Fix the price without a visit — ${title}` });

test.describe("CRM Today · fix the price without a visit (Tom, 8 Oct)", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staff, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  test.afterAll(async () => {
    const sb = db!;
    for (const id of estimates) await sb.from("work_item_dismissals").delete().like("item_key", `%:estimate:${id}:%`);
    for (const id of estimates) await sb.from("estimates").delete().eq("id", id);
    for (const id of accounts) {
      await sb.from("work_item_dismissals").delete().eq("account_id", id);
      await sb.from("crm_events").delete().eq("account_id", id);
      await sb.from("accounts").delete().eq("id", id);
    }
  });

  test("sending the estimate takes the card off Today by itself", async ({ page }) => {
    test.setTimeout(180_000);
    const accountId = await seedAccount("own");
    const title = `Desk close own ${run}`;
    const id = await seedAsk(accountId, title);

    await signIn(page, staff!, /home|estimates|today|quote|crm/);
    expect(await gotoTodayWith(page, TODAY, card(page, title)), "the ask is on Today before the send").toBeGreaterThan(0);

    await markSent(id);
    expect(await gotoTodayWith(page, TODAY, card(page, title)), "sent → no longer on Today").toBe(0);
  });

  test("another estimate sent to the same customer after the ask also clears it", async ({ page }) => {
    test.setTimeout(180_000);
    const accountId = await seedAccount("acct");
    const title = `Desk close acct ${run}`;
    await seedAsk(accountId, title);

    await signIn(page, staff!, /home|estimates|today|quote|crm/);
    expect(await gotoTodayWith(page, TODAY, card(page, title))).toBeGreaterThan(0);

    // The estimator built the price on a fresh estimate for the same customer and sent that.
    const other = await db!.from("estimates").insert({
      title: `Desk close other ${run}`, status: "draft", source: "manual", total_cents: 310_000, account_id: accountId,
      builder_state: { blocks: [room(1, "Bed 1")], aiDeferred: [], modSel: {}, materials: {} },
    }).select("id").single();
    if (other.error) throw new Error(other.error.message);
    estimates.push(other.data.id as string);
    await markSent(other.data.id as string);

    expect(await gotoTodayWith(page, TODAY, card(page, title)), "a sent estimate for the customer → gone").toBe(0);
  });

  test("“Not this one” just closes it — no form — and it stays closed", async ({ page }) => {
    test.setTimeout(180_000);
    const accountId = await seedAccount("dismiss");
    const title = `Desk close dismiss ${run}`;
    const id = await seedAsk(accountId, title);

    await signIn(page, staff!, /home|estimates|today|quote|crm/);
    const c = card(page, title);
    expect(await gotoTodayWith(page, TODAY, c)).toBeGreaterThan(0);

    await c.getByRole("button", { name: "Not this one" }).click();
    // No presets, no "why?" box — the card simply goes.
    await expect(page.locator(".qdreason")).toHaveCount(0);
    await expect(c).toHaveCount(0, { timeout: 15_000 });

    expect(await gotoTodayWith(page, TODAY, card(page, title)), "still closed after a reload").toBe(0);

    const { data, error } = await db!.from("work_item_dismissals").select("item_key, until, reason")
      .eq("item_key", `desk_check:estimate:${id}:confirm`);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect(data![0].until).toBeNull();
    expect(String(data![0].reason)).not.toBe("");
  });
});
