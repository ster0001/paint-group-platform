import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * The contractor's side of the app, driven as a contractor.
 *
 * The check that matters here is the last one: contractor-facing HTML must
 * never carry customer pricing or margin. It is asserted against the raw
 * response body, not the rendered screen, because "not visible" and "not sent"
 * are different things and only the second one is a control.
 */
const creds = credentials("CONTRACTOR");

test.describe("contractor portal", () => {
  test.skip(!creds, missingCreds("CONTRACTOR"));

  test("a contractor signs in and lands in the portal", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);
    await expect(page.getByRole("link", { name: /jobs/i }).first()).toBeVisible();
  });

  test("their jobs list loads and shows only their own work", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);
    await page.goto("/portal/jobs");
    // Either real jobs or an honest empty state — never a crash, and never
    // sample data.
    await expect(page.locator("body")).toContainText(/job|nothing|no jobs|booked/i);
    await expect(page.locator("text=Error")).toHaveCount(0);
  });

  test("no customer pricing or margin reaches the contractor's browser", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);

    for (const path of ["/portal", "/portal/jobs", "/portal/requests", "/portal/money"]) {
      const response = await page.goto(path);
      const html = (await response?.text()) ?? "";

      // Match the NAMES this codebase gives customer money, not the bare word
      // "margin" — a stylesheet writes `margin:0` and the framework's own
      // inline styles are in the payload, so a loose pattern fails on CSS and
      // teaches everyone to ignore the test. (The audit hit exactly this trap.)
      //
      // Checked against the whole response, RSC payload included: data leaks
      // hide there, not in the rendered markup.
      for (const pattern of [
        /marginCents|margin_cents/i,
        /subtotalCents|subtotal_cents/i,
        /customer ?total/i,
        /marginPct/i,
      ]) {
        expect(html, `${path} leaked ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  test("the profile page is reachable and states their compliance", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);
    await page.goto("/portal/profile");
    await expect(page.getByRole("heading", { name: /my profile/i })).toBeVisible();
    await expect(page.locator("body")).toContainText(/ready for work|not yet offerable/i);
  });
});

/**
 * The privacy gate must not swing back shut on a job the painter already
 * holds. Found 6 Sep: an accepted job, full address showing, went back to
 * "SUBURB ONLY" the moment the contractor sent a "Request a new start date"
 * (the offer row is 'proposed' while staff decide, and the committed rule only
 * knew 'accepted'). The jobs list retitled it with the suburb as well.
 * Asserted on the response body, like the leak test above — "not sent" is the
 * control, not "not visible".
 */
test.describe("a reschedule request keeps the address the painter already has", () => {
  const staff = credentials("STAFF");
  const db = serviceClient();
  test.skip(!creds || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  let job: LoopFixture | null = null;
  let offerId = "";
  const STREET = "1 Test St"; // createLoopFixture's jobAddress: "1 Test St, Melbourne"
  const start = new Date(Date.now() + 70 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 72 * 86_400_000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 77 * 86_400_000).toISOString().slice(0, 10);

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, creds!.email);
    if (!contractorId) throw new Error("no contractors row for the e2e contractor");
    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    await db!.from("work_orders").update({
      stage: "offered", status: "issued", contractor_id: null, start_date: null, end_date: null,
    }).eq("id", job.workOrderId);
    const sent = await rpcAs(staff!, "send_offer", {
      p_work_order_id: job.workOrderId, p_contractor_id: contractorId, p_start: start, p_end: end, p_note: "",
    });
    if (!/^ok|offered/.test(sent)) throw new Error(`send_offer: ${sent}`);
    const { data } = await db!.from("booking_offers").select("id").eq("work_order_id", job.workOrderId).eq("state", "offered").single();
    offerId = (data as { id: string }).id;
  });
  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("offered: suburb only; accepted: the street; reschedule requested: STILL the street", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);
    const jobPage = () => page.goto(`/portal/jobs/${job!.workOrderId}`).then((r) => r?.text() ?? "");

    expect(await jobPage()).not.toContain(STREET);

    const accepted = await rpcAs(creds!, "respond_to_offer", {
      p_offer_id: offerId, p_action: "accept", p_note: "", p_proposed_start: null, p_decline_reason: "",
    });
    expect(accepted).toMatch(/accepted|^ok/);
    expect(await jobPage()).toContain(STREET);

    const asked = await rpcAs(creds!, "request_reschedule", { p_offer_id: offerId, p_new_start: later, p_note: "Running behind" });
    expect(asked).toBe("proposed");

    // The defect: this read "SUBURB ONLY" with the street gone from the body.
    const pending = await jobPage();
    expect(pending).toContain(STREET);
    expect(pending).not.toMatch(/suburb only/i);
    expect(pending).toContain("Waiting on Paint Group");
    // The header shows the booking they still hold, not "proposed start – old end".
    expect(pending).toContain("Contractor proposed a change");

    // And the list keeps the job's title rather than swapping in the suburb.
    const list = await page.goto("/portal/jobs").then((r) => r?.text() ?? "");
    expect(list).toContain("E2E tick fixture");
  });

  test("a FIRST-TIME proposal is not a commitment — still suburb only", async ({ page }) => {
    // Put the booking back and re-offer, so the painter has accepted nothing.
    expect(await rpcAs(staff!, "resolve_proposed_offer", { p_offer_id: offerId, p_approve: false })).toBe("kept_original");
    expect(await rpcAs(staff!, "cancel_booking", { p_offer_id: offerId, p_reason: "e2e: re-offer" })).toBe("cancelled");
    const contractorId = await contractorIdForEmail(db!, creds!.email);
    const sent = await rpcAs(staff!, "send_offer", {
      p_work_order_id: job!.workOrderId, p_contractor_id: contractorId, p_start: start, p_end: end, p_note: "",
    });
    expect(sent).toMatch(/^ok|offered/);
    const { data } = await db!.from("booking_offers").select("id").eq("work_order_id", job!.workOrderId).eq("state", "offered").single();
    const fresh = (data as { id: string }).id;
    expect(await rpcAs(creds!, "respond_to_offer", {
      p_offer_id: fresh, p_action: "propose", p_note: "", p_proposed_start: later, p_decline_reason: "",
    })).toMatch(/proposed|^ok/);

    await signIn(page, creds!, /\/portal/);
    const html = await page.goto(`/portal/jobs/${job!.workOrderId}`).then((r) => r?.text() ?? "");
    expect(html).not.toContain(STREET);
    expect(html).toMatch(/suburb only/i);
  });
});
