import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Session 4 of the messaging brief (20 Sep 2026) — `contractor_offer_reminder`,
 * decision D7, driven through the real half-hour sweep route.
 *
 *   an offer 13 h old with no answer → the 12 h rung fires once (one claim,
 *   one recorded text) · the same half hour again → nothing new · the offer
 *   is accepted and the 20 h rung comes due → nothing fires and nothing is
 *   claimed: an answered offer cancels its reminders.
 *
 * `?force=1` steps past the 22:00–04:59 Melbourne night window so the spec
 * is not time-of-day dependent; the window itself is unit-tested with a
 * fixed clock (lib/automations/sweeps/moneySignoff.test.ts).
 *
 * Teardown (CLAUDE.md): everything this spec creates it removes — the claims
 * and holds keyed on the offer and the job, the recorded messages, the fixture
 * chain — and it puts the contractor's phone back the way it found it.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";
const KEY = "contractor_offer_reminder";

let f: LoopFixture | null = null;
let contractorId = "";
let offerId = "";
let phoneBefore: string | null | undefined;

const cleanup = async () => {
  if (!db || process.env.E2E_KEEP) return;
  if (offerId) await db.from("automation_claims").delete().eq("entity_id", offerId);
  if (f) {
    await db.from("automation_holds").delete().eq("work_order_id", f.workOrderId);
    await db.from("messages").delete().eq("work_order_id", f.workOrderId);
    await db.from("automation_claims").delete().eq("entity_id", f.workOrderId);
  }
  if (contractorId && phoneBefore !== undefined) {
    await db.from("contractors").update({ phone: phoneBefore }).eq("id", contractorId);
  }
  if (f) await destroyLoopFixture(db, f);
};

test.describe("offer reminders to the painter", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db || !SECRET, "set SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    expect(contractorId, "the E2E contractor needs a contractors row").toBeTruthy();
    // A mobile on the painter's profile, so the text has somewhere to go
    // (no Twilio in the test app: it is recorded as not_configured, which is
    // still one `messages` row). Restored in cleanup.
    const { data: c, error: cErr } = await db!.from("contractors").select("phone").eq("id", contractorId).single();
    if (cErr) throw cErr;
    phoneBefore = (c as { phone: string | null }).phone;
    if (!phoneBefore) {
      const { error } = await db!.from("contractors").update({ phone: "0400 000 000" }).eq("id", contractorId);
      if (error) throw error;
    }

    f = await createLoopFixture(db!, contractorId, [{ heading: "Living", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ stage: "offered", status: "issued", contractor_id: null }).eq("id", f.workOrderId);
    const sent = await rpcAs(staff!, "send_offer", {
      p_work_order_id: f.workOrderId, p_contractor_id: contractorId,
      p_start: new Date(Date.now() + 70 * 86_400_000).toISOString().slice(0, 10), p_end: null, p_note: "",
    });
    expect(sent, "send_offer").toMatch(/^ok/);
    const { data: offer, error: oErr } = await db!.from("booking_offers").select("id, expires_at")
      .eq("work_order_id", f.workOrderId).eq("state", "offered").single();
    if (oErr) throw oErr;
    offerId = (offer as { id: string }).id;
    // The offer-time text itself (contractor_offer) is not under test here.
    await db!.from("messages").delete().eq("work_order_id", f.workOrderId);
  });
  test.afterAll(cleanup);

  const sweep = async (request: Parameters<Parameters<typeof test>[2]>[0]["request"]) => {
    const res = await request.get("/api/cron/campaign-sweep?only=reminders&force=1", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.ok()).toBe(true);
    return (await res.json()) as { reminders: { offerReminders: { fired: number; stopped: number; held: number } } };
  };
  const recorded = async () => {
    const [{ data: msgs, error: mErr }, { data: holds, error: hErr }] = await Promise.all([
      db!.from("messages").select("id, body").eq("work_order_id", f!.workOrderId).filter("meta->>automation", "eq", KEY),
      db!.from("automation_holds").select("id").eq("work_order_id", f!.workOrderId).eq("automation_key", KEY),
    ]);
    if (mErr) throw mErr;
    if (hErr) throw hErr;
    return { msgs: msgs ?? [], holds: holds ?? [] };
  };
  const claims = async () => {
    const { data, error } = await db!.from("automation_claims").select("rung").eq("automation_key", KEY).eq("entity_id", offerId);
    if (error) throw error;
    return (data ?? []).map((c) => (c as { rung: string }).rung).sort();
  };

  test("13 h after the offer, the first reminder goes once; the same half hour again sends nothing new", async ({ request }) => {
    // Fresh offer, 6 h old: nothing due yet.
    await db!.from("booking_offers").update({ offered_at: new Date(Date.now() - 6 * 3_600_000).toISOString() }).eq("id", offerId);
    const early = await sweep(request);
    expect(await claims()).toEqual([]);
    expect(early.reminders.offerReminders.fired).toBe(0);

    // 13 h old, still live (expires_at is ~24 h out from send_offer): the 12 h rung is due.
    const { error } = await db!.from("booking_offers").update({ offered_at: new Date(Date.now() - 13 * 3_600_000).toISOString() }).eq("id", offerId);
    if (error) throw error;
    const first = await sweep(request);
    expect(first.reminders.offerReminders.fired).toBe(1);
    expect(await claims()).toEqual(["first"]);
    const r1 = await recorded();
    expect(r1.msgs.length + r1.holds.length).toBe(1);
    if (r1.msgs.length) {
      const body = String((r1.msgs[0] as { body: string }).body);
      expect(body).toMatch(/still waiting/);
      expect(body).toMatch(/expires at \d{1,2}:\d{2} [ap]m/);
      expect(body).toMatch(/\/portal\/requests/);
    }

    // Same half hour again: the rung is claimed, nothing new.
    const again = await sweep(request);
    expect(again.reminders.offerReminders.fired).toBe(0);
    expect(await claims()).toEqual(["first"]);
    const r2 = await recorded();
    expect(r2.msgs.length + r2.holds.length).toBe(1);
  });

  test("an accepted offer cancels the second reminder", async ({ request }) => {
    // 21 h old: the 20 h rung would be due — but the painter has answered.
    const { error } = await db!.from("booking_offers").update({ offered_at: new Date(Date.now() - 21 * 3_600_000).toISOString() }).eq("id", offerId);
    if (error) throw error;
    const accepted = await rpcAs(contractor!, "respond_to_offer", { p_offer_id: offerId, p_action: "accept", p_note: "" });
    expect(accepted, "respond_to_offer").toMatch(/accepted/);

    const after = await sweep(request);
    expect(after.reminders.offerReminders.fired).toBe(0);
    expect(await claims()).toEqual(["first"]);
    const r = await recorded();
    expect(r.msgs.length + r.holds.length).toBe(1);
  });
});
