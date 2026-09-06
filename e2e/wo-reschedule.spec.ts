import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Approving a proposed start date moves the WHOLE booking (migration 20270110).
 *
 * Found 6 Sep running the scheduling help capture: an offer for D–D+4 with the
 * final walkthrough confirmed on D+4 at 15:00; the painter asked for D+7; staff
 * approved. start_date moved, end_date did not (the painter's card read
 * "FRI 11 – TUE 8"), and the walkthrough stayed on D+4 — before the job now
 * started. Both a reschedule of an accepted booking and a first-time proposal
 * are covered, and the refuse branch is checked to have moved nothing.
 *
 * Headless on purpose: every step is the RPC the button calls, driven as the
 * role that presses it, and the assertions read the tables the screens read.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const iso = (daysOut: number) => new Date(Date.now() + daysOut * 86_400_000).toISOString().slice(0, 10);

const offerDates = async (workOrderId: string) => {
  const { data } = await db!.from("booking_offers").select("id, state, start_date, end_date")
    .eq("work_order_id", workOrderId).in("state", ["offered", "proposed", "accepted"])
    .order("offered_at", { ascending: false }).limit(1).single();
  return data as { id: string; state: string; start_date: string; end_date: string | null };
};
const woDates = async (workOrderId: string) => {
  const { data } = await db!.from("work_orders").select("start_date, end_date").eq("id", workOrderId).single();
  return data as { start_date: string | null; end_date: string | null };
};
const finals = async (workOrderId: string) => {
  const { data } = await db!.from("wo_walkthroughs").select("scheduled_date, scheduled_time, status, note")
    .eq("work_order_id", workOrderId).eq("kind", "final").order("created_at", { ascending: true });
  return (data ?? []) as { scheduled_date: string; scheduled_time: string | null; status: string; note: string }[];
};

/** An issued, unassigned job in the tray — the state a drag-to-offer starts from. */
async function trayJob(): Promise<LoopFixture> {
  const contractorId = await contractorIdForEmail(db!, contractor!.email);
  if (!contractorId) throw new Error("no contractors row for the e2e contractor");
  const job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
  await db!.from("work_orders").update({
    stage: "offered", status: "issued", contractor_id: null, start_date: null, end_date: null,
  }).eq("id", job.workOrderId);
  return job;
}

test.describe.configure({ mode: "serial" });

test.describe("approving a new start date moves the end date and the walkthrough with it", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  let job: LoopFixture | null = null;
  let contractorId = "";
  let offerId = "";
  // Far out so the fixture cannot land on a real booking (wo-booking.spec's lesson).
  const D = 60;

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email)) ?? "";
    job = await trayJob();
  });
  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("offer D–D+4 with the final walkthrough confirmed on the last day, and the painter accepts", async () => {
    const sent = await rpcAs(staff!, "send_offer", {
      p_work_order_id: job!.workOrderId, p_contractor_id: contractorId,
      p_start: iso(D), p_end: iso(D + 4), p_note: "",
    });
    expect(sent).toMatch(/^ok|offered/);
    // What the offer sheet does server-side after "Send offer" (actions.ts).
    const booked = await rpcAs(staff!, "wo_book_walkthrough", {
      p_work_order_id: job!.workOrderId, p_kind: "final", p_date: iso(D + 4), p_time: "15:00",
      p_note: "Confirmed with the client at booking",
    });
    expect(booked).toMatch(/^ok:/);

    const offer = await offerDates(job!.workOrderId);
    offerId = offer.id;
    const accepted = await rpcAs(contractor!, "respond_to_offer", {
      p_offer_id: offerId, p_action: "accept", p_note: "", p_proposed_start: null, p_decline_reason: "",
    });
    expect(accepted).toMatch(/accepted|^ok/);
    expect(await offerDates(job!.workOrderId)).toMatchObject({ state: "accepted", start_date: iso(D), end_date: iso(D + 4) });
  });

  test("the painter asks to start a week later; approving shifts start, end AND the walkthrough by 7 days", async () => {
    const asked = await rpcAs(contractor!, "request_reschedule", {
      p_offer_id: offerId, p_new_start: iso(D + 7), p_note: "Running behind on the job before",
    });
    expect(asked).toBe("proposed");
    // Nothing has moved yet — the original booking stands until staff decide.
    expect(await offerDates(job!.workOrderId)).toMatchObject({ state: "proposed", start_date: iso(D), end_date: iso(D + 4) });

    const decided = await rpcAs(staff!, "resolve_proposed_offer", { p_offer_id: offerId, p_approve: true });
    expect(decided).toBe("accepted");

    // The offer — what the painter's Requests card and calendar read.
    expect(await offerDates(job!.workOrderId)).toMatchObject({ state: "accepted", start_date: iso(D + 7), end_date: iso(D + 11) });
    // The work order — what the board block, the console and the customer read.
    expect(await woDates(job!.workOrderId)).toEqual({ start_date: iso(D + 7), end_date: iso(D + 11) });

    // The walkthrough rides with the job: old row cancelled, new one on the
    // new last day, the client-confirmed TIME carried across.
    const rows = await finals(job!.workOrderId);
    expect(rows.map((r) => [r.scheduled_date, r.status])).toEqual([
      [iso(D + 4), "cancelled"],
      [iso(D + 11), "booked"],
    ]);
    expect(rows[1].scheduled_time?.slice(0, 5)).toBe("15:00");
    expect(rows[1].note).toMatch(/approved start date/i);

    // Auditable: the move is on the event log with where it came from.
    const { data: ev } = await db!.from("wo_events").select("meta").eq("work_order_id", job!.workOrderId)
      .eq("type", "walkthrough_booked").order("created_at", { ascending: false }).limit(1).single();
    expect((ev as { meta: { via?: string; delta_days?: number } }).meta).toMatchObject({ via: "reschedule_approved", delta_days: 7 });
  });

  test("a refused reschedule moves nothing — dates and walkthrough exactly as approved", async () => {
    const asked = await rpcAs(contractor!, "request_reschedule", {
      p_offer_id: offerId, p_new_start: iso(D + 10), p_note: "",
    });
    expect(asked).toBe("proposed");
    const decided = await rpcAs(staff!, "resolve_proposed_offer", { p_offer_id: offerId, p_approve: false });
    expect(decided).toBe("kept_original");

    expect(await offerDates(job!.workOrderId)).toMatchObject({ state: "accepted", start_date: iso(D + 7), end_date: iso(D + 11) });
    expect(await woDates(job!.workOrderId)).toEqual({ start_date: iso(D + 7), end_date: iso(D + 11) });
    const rows = await finals(job!.workOrderId);
    expect(rows.filter((r) => r.status === "booked").map((r) => r.scheduled_date)).toEqual([iso(D + 11)]);
  });
});

test.describe("a FIRST-TIME proposal approved from the tray moves the span too", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  let job: LoopFixture | null = null;
  const D = 80;

  test.beforeAll(async () => { job = await trayJob(); });
  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("offered D–D+2, painter proposes D+3, staff approve → D+3–D+5 and the walkthrough on D+5", async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    const sent = await rpcAs(staff!, "send_offer", {
      p_work_order_id: job!.workOrderId, p_contractor_id: contractorId,
      p_start: iso(D), p_end: iso(D + 2), p_note: "",
    });
    expect(sent).toMatch(/^ok|offered/);
    expect(await rpcAs(staff!, "wo_book_walkthrough", {
      p_work_order_id: job!.workOrderId, p_kind: "final", p_date: iso(D + 2), p_time: "10:30", p_note: "",
    })).toMatch(/^ok:/);

    const offer = await offerDates(job!.workOrderId);
    const proposed = await rpcAs(contractor!, "respond_to_offer", {
      p_offer_id: offer.id, p_action: "propose", p_note: "Could start the Monday after",
      p_proposed_start: iso(D + 3), p_decline_reason: "",
    });
    expect(proposed).toMatch(/proposed|^ok/);

    expect(await rpcAs(staff!, "resolve_proposed_offer", { p_offer_id: offer.id, p_approve: true })).toBe("accepted");
    expect(await offerDates(job!.workOrderId)).toMatchObject({ state: "accepted", start_date: iso(D + 3), end_date: iso(D + 5) });
    expect(await woDates(job!.workOrderId)).toEqual({ start_date: iso(D + 3), end_date: iso(D + 5) });
    const rows = await finals(job!.workOrderId);
    expect(rows.map((r) => [r.scheduled_date, r.status, r.scheduled_time?.slice(0, 5) ?? null])).toEqual([
      [iso(D + 2), "cancelled", "10:30"],
      [iso(D + 5), "booked", "10:30"],
    ]);
  });
});
