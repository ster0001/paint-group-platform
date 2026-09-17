import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  serviceClient, rpcAs, setVariationRelease, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 17 Sep 2026 — two things from the 1/41 Devoy Street test:
 *
 *   1. "the variation email or text message didn't come through." The sender
 *      read the contact from builder_state ONLY; every other customer send
 *      reads the sent snapshot too. This fixture puts the email in the
 *      snapshot and nowhere else, then sends the link from the PC console.
 *   2. "allow for pc command to confirm a variation on behalf of the customer
 *      with verbal approval, which sends a confirmation to the customer."
 *      The office confirms from the console; the customer's own /v page (as
 *      an anonymous visitor) says approved by phone; the confirmation is on
 *      the message record; a second confirm is refused.
 */

const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

const SNAPSHOT_EMAIL = "e2e-devoy-street@example.com";

let fixture: LoopFixture | null = null;
let variationId = "";
let token = "";
let releaseBefore: "auto" | "pc" = "auto";

test.describe.configure({ mode: "serial" });

test.describe("a variation sent from the console, then confirmed on the customer's behalf", () => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    releaseBefore = await setVariationRelease(db!, "auto");
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    if (!contractorId) throw new Error(`no contractors row for ${contractor!.email}`);
    fixture = await createLoopFixture(db!, contractorId, [
      { heading: "Front", labels: ["Fascia", "Gutters"] },
    ]);

    // The Devoy Street shape: a contact in the SENT SNAPSHOT, none in the
    // builder state. Before the fix this estimate had "no email" for variations.
    const { error: estErr } = await db!.from("estimates").update({
      builder_state: { contact: { first_name: "", email: "", phone: "" } },
      sent_snapshot: { contactEmail: SNAPSHOT_EMAIL, contactName: "Devoy Customer", jobAddress: "1/41 Devoy St" },
    }).eq("id", fixture.estimateId);
    if (estErr) throw new Error(`fixture contact: ${estErr.message}`);

    const { data: photo, error: photoErr } = await db!.from("wo_photos").insert({
      work_order_id: fixture.workOrderId, kind: "variation",
      storage_path: `wo/${fixture.workOrderId}/seeded-verbal.jpg`,
    }).select("id").single();
    if (photoErr) throw new Error(`fixture photo: ${photoErr.message}`);

    const { data: seeded, error: vErr } = await db!.from("wo_variations").insert({
      work_order_id: fixture.workOrderId,
      category: "damage",
      comment: "Gutter bracket snapped — replace and repaint the run.",
      est_hours: 2,
      status: "raised",
    }).select("id").single();
    if (vErr) throw new Error(`fixture variation: ${vErr.message}`);
    variationId = (seeded as { id: string }).id;
    await db!.from("wo_photos").update({ variation_id: variationId }).eq("id", (photo as { id: string }).id);

    const priced = await rpcAs(staff!, "wo_price_variation", {
      p_variation_id: variationId,
      p_price_cents: 56_000,
      p_inputs: { hours: 2, chargeOutCents: 28000, type: "Exterior" },
      p_priced_lines: [{ label: "Labour — 2 hr", cents: 56_000 }],
      p_hours: 2,
    });
    expect(priced).toMatch(/^ok:/);
    token = priced.slice(3);
  });

  test.afterAll(async () => {
    // messages.estimate_id only nulls on delete — what this run wrote, this run removes.
    if (fixture) {
      const { error } = await db!.from("messages").delete().eq("estimate_id", fixture.estimateId);
      if (error) throw new Error(`messages leak: ${error.message}`);
    }
    await destroyLoopFixture(db!, fixture);
    await setVariationRelease(db!, releaseBefore);
  });

  test("the signing link finds the snapshot email the console used to miss", async ({ page }) => {
    await signIn(page, staff!, /\/(quote|estimates|pc|crm)/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);
    await expect(page.getByTestId(`awaiting-${variationId}`)).toContainText("$560.00");

    await page.getByTestId(`send-email-${variationId}`).click();
    const msg = page.getByTestId(`variation-msg-${variationId}`);
    await expect(msg).toBeVisible();
    // Never the old dead end. Either the email went, or the server says
    // plainly that email isn't configured here — both are recorded below.
    await expect(msg).not.toContainText("No email");
    await expect(msg).toContainText(/emailed|isn't configured/);

    const { data: rows, error } = await db!.from("messages")
      .select("to_address, subject, status, meta")
      .eq("estimate_id", fixture!.estimateId)
      .eq("channel", "email");
    expect(error).toBeNull();
    const link = (rows ?? []).find((r) => (r as { subject: string | null }).subject?.includes("signature"));
    expect(link, "the signing link was recorded against the estimate").toBeTruthy();
    expect((link as { to_address: string }).to_address).toBe(SNAPSHOT_EMAIL);
  });

  test("the office confirms it on the customer's behalf; the confirmation goes to the same address", async ({ page }) => {
    await signIn(page, staff!, /\/(quote|estimates|pc|crm)/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);

    // Two prompts — who gave the OK, then a note — the Mark-paid pattern.
    const answers = ["Devoy Customer", "Phoned 17 Sep, happy to go ahead"];
    page.on("dialog", (d) => d.accept(answers.shift() ?? ""));
    await page.getByTestId(`verbal-confirm-${variationId}`).click();

    const msg = page.getByTestId(`variation-msg-${variationId}`);
    await expect(msg).toContainText("Recorded as approved by phone");
    await expect(msg).toContainText(/Confirmation: email (sent|not configured)/);

    const { data, error } = await db!.from("wo_variations")
      .select("status, customer_responded_at, signed_name, signed_at, signature, verbal_confirmed_at, verbal_note, released_at")
      .eq("id", variationId).single();
    expect(error).toBeNull();
    const v = data as {
      status: string; customer_responded_at: string | null; signed_name: string | null; signed_at: string | null;
      signature: string | null; verbal_confirmed_at: string | null; verbal_note: string; released_at: string | null;
    };
    expect(v.status).toBe("customer_approved");
    expect(v.customer_responded_at).not.toBeNull();
    expect(v.signed_name).toBe("Devoy Customer");
    expect(v.signature).toBeNull();
    expect(v.signed_at).toBeNull();
    expect(v.verbal_confirmed_at).not.toBeNull();
    expect(v.verbal_note).toBe("Phoned 17 Sep, happy to go ahead");
    // Auto-release (the default) treats a verbal approval like a signed one.
    expect(v.released_at).not.toBeNull();

    const { data: events } = await db!.from("wo_events")
      .select("type, actor_kind, meta").eq("work_order_id", fixture!.workOrderId).eq("type", "variation_customer_approved");
    const ev = (events ?? []) as { actor_kind: string; meta: { verbal?: boolean; signed?: boolean } }[];
    expect(ev).toHaveLength(1);
    expect(ev[0].actor_kind).toBe("staff");
    expect(ev[0].meta.verbal).toBe(true);
    expect(ev[0].meta.signed).toBe(false);

    const { data: rows } = await db!.from("messages")
      .select("to_address, subject, meta").eq("estimate_id", fixture!.estimateId).eq("channel", "email");
    const conf = (rows ?? []).find((r) => (r as { meta: { kind?: string } }).meta?.kind === "variation_confirmed");
    expect(conf, "the confirmation was recorded against the estimate").toBeTruthy();
    expect((conf as { to_address: string }).to_address).toBe(SNAPSHOT_EMAIL);
    expect((conf as { subject: string }).subject).toContain("Confirmed");
  });

  test("the customer's own link says approved by phone — no signature asked for", async ({ page }) => {
    await page.goto(`/v/${token}`);
    await expect(page.getByTestId("variation-outcome")).toContainText("Approved");
    await expect(page.getByTestId("variation-signedby")).toContainText("by phone");
    await expect(page.getByTestId("variation-signedby")).toContainText("Devoy Customer");
    await expect(page.getByTestId("approve-variation")).toHaveCount(0);
    // The contractor's side is still nowhere in what the customer sees.
    expect(await page.content()).not.toContain("12000");
  });

  test("confirming twice is refused; confirming an unpriced one is refused", async () => {
    const again = await rpcAs(staff!, "wo_staff_confirm_variation", {
      p_variation_id: variationId, p_confirmed_with: "Devoy Customer", p_note: "",
    });
    expect(again).toBe("error:already_customer_approved");

    const { data: raw } = await db!.from("wo_variations").insert({
      work_order_id: fixture!.workOrderId, category: "extra_scope", comment: "unpriced", status: "raised",
    }).select("id").single();
    const unpriced = await rpcAs(staff!, "wo_staff_confirm_variation", {
      p_variation_id: (raw as { id: string }).id, p_confirmed_with: "Devoy Customer", p_note: "",
    });
    expect(unpriced).toBe("error:not_priced");
  });

  test("the console shows the verbal approval, not a signature", async ({ page }) => {
    await signIn(page, staff!, /\/(quote|estimates|pc|crm)/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);
    const line = page.getByTestId(`variation-signed-${variationId}`);
    await expect(line).toContainText("Approved by phone");
    await expect(line).toContainText("Devoy Customer");
    await expect(line).not.toContainText("Signed by");
  });
});
