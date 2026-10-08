import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { credentials, drawSignature, missingCreds, signIn } from "./helpers";

/**
 * Tom, 8 Oct 2026 — two things in the variation flow.
 *
 * 1. "When a customer approves a variation, please can we send a notification
 *    via email to confirm it has been approved."
 *    → the ANONYMOUS customer signs on /v/<token>; a confirmation email is
 *      sent to the estimate's contact, and the job's record says what it came
 *      to (sent, or skipped with the reason) — never "sent" over nothing.
 *
 * 2. "In variations (PC Command), a button needs to be added to reject a
 *    variation, with a reply box which sends a message back to the contractor."
 *    → staff press Reject on a painter's raised variation in PC Command's
 *      "Variations for approval", write a reply and send it: the row is
 *      declined through wo_office_reject_variation (staff-only, 'raised' only),
 *      the painter's message outcome is recorded, and the painter sees
 *      "Not going ahead" with the office's reply on their job page.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");

const CUSTOMER_EMAIL = `variation-confirm-${process.pid}@example.com`;
const REPLY = "Thanks — the gate was already in the original scope, so no variation for this one.";

let fixture: LoopFixture | null = null;
let offerToken = "";
let pricedId = "";
let raisedId = "";

test.describe.configure({ mode: "serial" });

test.describe("variation approved email + office reject", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!contractor, missingCreds("CONTRACTOR"));

  test.beforeAll(async () => {
    const sb = db!;
    const cid = await contractorIdForEmail(sb, contractor!.email);
    if (!cid) throw new Error(`no contractors row for ${contractor!.email}`);
    const { data: crow, error: cErr } = await sb.from("contractors").select("profile_id").eq("id", cid).single();
    if (cErr) throw new Error(`contractor profile: ${cErr.message}`);
    const painterProfileId = (crow as { profile_id: string }).profile_id;

    fixture = await createLoopFixture(sb, cid, [{ heading: "Front", labels: ["Fence"] }]);
    const { error: estErr } = await sb.from("estimates").update({
      title: "Variation confirm e2e",
      builder_state: { contact: { first_name: "Vera", email: CUSTOMER_EMAIL } },
    }).eq("id", fixture.estimateId);
    if (estErr) throw new Error(`fixture contact: ${estErr.message}`);

    // A priced change with the customer (the offer token is the link).
    offerToken = randomBytes(24).toString("base64url");
    const { data: priced, error: pErr } = await sb.from("wo_variations").insert({
      work_order_id: fixture.workOrderId, raised_kind: "staff", category: "extra_scope",
      comment: "Paint the side gate", status: "priced", est_hours: 0,
      price_cents: 33000, customer_token: offerToken,
    }).select("id").single();
    if (pErr) throw new Error(`fixture priced: ${pErr.message}`);
    pricedId = (priced as { id: string }).id;

    // The painter's own request, waiting on the office.
    const { data: raised, error: rErr } = await sb.from("wo_variations").insert({
      work_order_id: fixture.workOrderId, raised_by: painterProfileId, raised_kind: "contractor",
      category: "extra_scope", comment: "Side gate needs two coats as well", status: "raised", est_hours: 2,
    }).select("id").single();
    if (rErr) throw new Error(`fixture raised: ${rErr.message}`);
    raisedId = (raised as { id: string }).id;
  });

  test.afterAll(async () => {
    if (!db || !fixture) return;
    const { error } = await db.from("messages").delete().eq("estimate_id", fixture.estimateId);
    if (error) throw new Error(`messages cleanup: ${error.message}`);
    await destroyLoopFixture(db, fixture);
  });

  test("the anonymous customer signs → a confirmation email, and the record says what it came to", async ({ page }) => {
    await page.goto(`/v/${offerToken}`);
    await page.getByTestId("approve-variation").click();
    await drawSignature(page);
    await page.getByTestId("sign-name").fill("Vera Customer");
    await page.getByTestId("confirm-sign").click();
    await expect(page.getByTestId("variation-outcome")).toContainText("Approved");

    const { data: v, error } = await db!.from("wo_variations").select("status").eq("id", pricedId).single();
    expect(error).toBeNull();
    expect(["customer_approved", "contractor_accepted"]).toContain((v as { status: string }).status);

    // Exactly one outcome on the job's record for this offer.
    const outcomes = async () => {
      const { data: ev, error: evErr } = await db!.from("wo_events").select("type, meta")
        .eq("work_order_id", fixture!.workOrderId)
        .in("type", ["variation_approval_confirmed", "variation_approval_confirmation_skipped"]);
      if (evErr) throw new Error(evErr.message);
      return (ev ?? []) as { type: string; meta: { offer_token?: string; reason?: string; to?: string } }[];
    };
    await expect.poll(async () => (await outcomes()).length, { timeout: 15_000 }).toBe(1);
    const [one] = await outcomes();
    expect(one.meta.offer_token).toBe(offerToken);
    if (one.type === "variation_approval_confirmation_skipped") expect(one.meta.reason).toBeTruthy();
    else expect(one.meta.to).toBe(CUSTOMER_EMAIL);

    // The email itself is on the CRM record, addressed to the estimate's contact.
    const { data: msgs, error: mErr } = await db!.from("messages").select("to_address, subject, channel")
      .eq("estimate_id", fixture!.estimateId).filter("meta->>kind", "eq", "variation_approved");
    expect(mErr).toBeNull();
    expect(msgs).toHaveLength(1);
    const m = (msgs ?? [])[0] as { to_address: string; subject: string; channel: string };
    expect(m.channel).toBe("email");
    expect(m.to_address).toBe(CUSTOMER_EMAIL);
    expect(m.subject).toMatch(/approved/i);

    // Re-opening the link never sends a second one.
    await page.goto(`/v/${offerToken}`);
    await expect(page.getByTestId("variation-outcome")).toContainText("Approved");
    expect(await outcomes()).toHaveLength(1);
  });

  test("the office rejects the painter's request from PC Command with a reply", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const row = page.getByTestId(`variation-approval-${raisedId}`);
    await expect(row).toBeVisible();
    await row.getByTestId(`reject-variation-${raisedId}`).click();
    await page.getByTestId(`reject-reply-${raisedId}`).fill(REPLY);
    await page.getByTestId(`reject-send-${raisedId}`).click();
    await expect(page.getByTestId(`reject-outcome-${raisedId}`)).toContainText(/Rejected/);

    const { data: v, error } = await db!.from("wo_variations")
      .select("status, declined_reason, office_rejected_at, office_reject_note").eq("id", raisedId).single();
    expect(error).toBeNull();
    const row2 = v as { status: string; declined_reason: string; office_rejected_at: string | null; office_reject_note: string };
    expect(row2.status).toBe("declined");
    expect(row2.office_rejected_at).not.toBeNull();
    expect(row2.office_reject_note).toBe(REPLY);
    expect(row2.declined_reason).toBe(REPLY);

    // The painter's message: notified on a channel, or skipped WITH the reason.
    const { data: ev, error: evErr } = await db!.from("wo_events").select("type, meta")
      .eq("work_order_id", fixture!.workOrderId)
      .in("type", ["variation_office_rejected", "variation_rejected_notified", "variation_rejected_notified_skipped"]);
    expect(evErr).toBeNull();
    const types = ((ev ?? []) as { type: string }[]).map((e) => e.type);
    expect(types).toContain("variation_office_rejected");
    const told = ((ev ?? []) as { type: string; meta: { variation_id: string; reason?: string; channels?: string[] } }[])
      .filter((e) => e.type !== "variation_office_rejected");
    expect(told).toHaveLength(1);
    expect(told[0].meta.variation_id).toBe(raisedId);
    if (told[0].type === "variation_rejected_notified_skipped") expect(told[0].meta.reason).toBeTruthy();
    else expect(told[0].meta.channels?.length).toBeGreaterThan(0);

    // Off the list once answered.
    await page.reload();
    await expect(page.getByTestId(`variation-approval-${raisedId}`)).toHaveCount(0);
  });

  test("the reject is staff-only and only for a request still with the office", async () => {
    expect(await rpcAs(contractor!, "wo_office_reject_variation", { p_variation_id: pricedId, p_note: "nope nope" })).toBe("error:not_staff");
    expect(await rpcAs(staff!, "wo_office_reject_variation", { p_variation_id: pricedId, p_note: "too late now" })).toBe("error:not_raised");
    expect(await rpcAs(staff!, "wo_office_reject_variation", { p_variation_id: raisedId, p_note: "again" })).toBe("ok:already");
  });

  test("the painter sees it is not going ahead, with the office's reply", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    const card = page.getByTestId(`variation-${raisedId}`);
    await expect(card).toContainText("Not going ahead");
    await expect(page.getByTestId(`office-rejected-${raisedId}`)).toContainText(REPLY);
  });
});
