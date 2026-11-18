import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, drawSignature, missingCreds, test, userIdFor } from "../helpers";
import { MONEY_RANGE, passOtpIfShown, quickNext } from "./drive";
import { requestAlertRoute } from "../../lib/staff/requestAlertRules";
import { morningBeforeDue } from "../../lib/automations/dateOffset";

/**
 * Automations brief §7 session 6: the full loop, as an ANONYMOUS customer on
 * a phone, with every message along the way checked where it lands.
 *
 *   wizard → range → L1 text → they reply on the chat → E8 alert (by the
 *   hours) → a visit request (L10 alert) → the office sends the estimate →
 *   E4 on the chat → they sign and accept → W1 welcome → W2 deposit due
 *
 * The customer's side is driven for real: the wizard, the texted code, the
 * range, the chat, the visit request and the signature. The office's side —
 * a visit marked done, the estimate sent, the deposit issued, the job booked
 * — is written through the service key, because those screens have their own
 * specs and the point here is the messages. Time is moved by backdating rows
 * (a test cannot wait two hours or two days). Every key used is switched on
 * for the run, and the settings and the staff login's routing are put back.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const SECRET = process.env.CRON_SECRET ?? "";
const suburb = `E2E FullLoop ${run}`;
const NAME = `Loop Customer ${run}`;
const EMAIL = `loop.${run}@full-loop.invalid`;
const MOBILE = `04${String(parseInt(randomBytes(4).toString("hex"), 16)).padStart(8, "0").slice(0, 8)}`;
const E164 = `+61${MOBILE.replace(/^0/, "")}`;
const KEYS = ["lead_range_reminder", "office_estimate_chat", "office_visit_request", "estimate_viewed_any_q", "customer_accepted_welcome", "deposit_due"];
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const MEL = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
const melDayPlus = (d: number) => MEL.format(new Date(Date.now() + d * 86_400_000));
const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 30_000 });

test.describe("Automations — the full loop (session 6)", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  test.skip(!SECRET, "set CRON_SECRET");
  let saved: Record<string, unknown> | null = null;
  let touched = false;
  let staffId = "";
  let savedNotify: unknown = null;
  let notifyTouched = false;
  let estimateId = "";
  let draftId = "";
  let workOrderId = "";

  test.afterAll(async () => {
    if (!db) return;
    if (touched) {
      if (saved === null) await db.from("settings").delete().eq("key", "messaging");
      else await db.from("settings").upsert({ key: "messaging", value: saved }, { onConflict: "key" });
    }
    if (notifyTouched) await db.from("profiles").update({ staff_notify: savedNotify }).eq("id", staffId);
    if (estimateId) {
      const ev = await db.from("crm_events").select("id").eq("estimate_id", estimateId);
      const msgs = await db.from("estimate_messages").select("id").eq("estimate_id", estimateId);
      const entities = [...((ev.data ?? []) as { id: string }[]), ...((msgs.data ?? []) as { id: string }[])].map((r) => r.id);
      if (entities.length) await db.from("staff_notifications").delete().in("entity_id", entities);
      const invs = await db.from("invoices").select("id").eq("estimate_id", estimateId);
      const invIds = ((invs.data ?? []) as { id: string }[]).map((r) => r.id);
      await db.from("automation_claims").delete().in("entity_id", [estimateId, draftId, workOrderId, ...invIds].filter(Boolean));
      await db.from("automation_holds").delete().eq("estimate_id", estimateId);
      await db.from("estimate_messages").delete().eq("estimate_id", estimateId);
      await db.from("messages").delete().eq("estimate_id", estimateId);
      await db.from("visit_requests").delete().eq("estimate_id", estimateId);
      await db.from("visits").delete().eq("estimate_id", estimateId);
      if (invIds.length) await db.from("payments").delete().in("invoice_id", invIds);
      await db.from("invoices").delete().eq("estimate_id", estimateId);
      await db.from("work_orders").delete().eq("estimate_id", estimateId);
      await db.from("estimate_draft_doors").delete().eq("estimate_id", estimateId);
      await db.from("follow_ups").delete().eq("estimate_id", estimateId);
      await db.from("estimate_events").delete().eq("estimate_id", estimateId);
      await db.from("crm_events").delete().eq("estimate_id", estimateId);
    }
    await db.from("messages").delete().eq("to_address", E164);
    if (draftId) { await db.from("crm_events").delete().eq("wizard_draft_id", draftId); await db.from("wizard_drafts").delete().eq("id", draftId); }
    if (estimateId) await db.from("estimates").delete().eq("id", estimateId);
    const acc = await db.from("accounts").select("id").eq("email", EMAIL);
    for (const a of (acc.data ?? []) as { id: string }[]) {
      await db.from("estimates").update({ account_id: null, property_id: null }).eq("account_id", a.id);
      await db.from("crm_events").delete().eq("account_id", a.id);
      await db.from("properties").delete().eq("account_id", a.id);
      await db.from("accounts").delete().eq("id", a.id);
    }
  });

  test("wizard → L1 → reply → E8 → visit (L10) → estimate → E4 → accept → W1 → W2", async ({ browser, baseURL, request }) => {
    test.setTimeout(600_000);

    // ---- the keys on, the staff login routed, for this run only ----
    const { data, error } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    if (error) throw new Error(error.message);
    saved = (data as { value: Record<string, unknown> } | null)?.value ?? null;
    const base = saved ?? {};
    const up = await db!.from("settings").upsert({ key: "messaging", value: {
      ...base, enabled: [...new Set([...((base.enabled as string[] | undefined) ?? []), ...KEYS])],
      disabled: ((base.disabled as string[] | undefined) ?? []).filter((k) => !KEYS.includes(k)),
    } }, { onConflict: "key" });
    if (up.error) throw new Error(up.error.message);
    touched = true;
    staffId = (await userIdFor(staff!)) ?? "";
    const prof = await db!.from("profiles").select("staff_notify").eq("id", staffId).single();
    if (prof.error) throw prof.error;
    savedNotify = (prof.data as { staff_notify: unknown }).staff_notify;
    const ticked = await db!.from("profiles").update({
      staff_notify: { ...((savedNotify as Record<string, unknown> | null) ?? {}), office_estimate_chat: ["email", "sms"], office_visit_request: ["email", "sms"] },
    }).eq("id", staffId);
    if (ticked.error) throw ticked.error;
    notifyTouched = true;
    const holidays = async () => {
      const r = await db!.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
      if (r.error) throw r.error;
      return new Set(((r.data as { value?: { publicHolidays?: string[] } } | null)?.value?.publicHolidays ?? []));
    };
    const sweep = async (only: string) => {
      const res = await request.get(`/api/cron/campaign-sweep?only=${only}`, { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 200_000 });
      expect(res.status(), `sweep ${only}`).toBe(200);
      return res.json() as Promise<Record<string, unknown>>;
    };
    /** Texts to the customer, sent or held for quiet hours. */
    const textsFor = async (key: string) => {
      const { data: sms, error: e1 } = await db!.from("messages").select("body").eq("to_address", E164).eq("channel", "sms").eq("direction", "out").eq("meta->>automation", key);
      const { data: held, error: e2 } = await db!.from("automation_holds").select("sms_body").eq("estimate_id", estimateId).eq("automation_key", key);
      if (e1 || e2) throw new Error((e1 ?? e2)!.message);
      return [...(sms ?? []).map((m) => m.body as string), ...(held ?? []).map((h) => (h.sms_body as string | null) ?? "").filter(Boolean)];
    };

    // ---- 1 · the wizard, on a phone, with no login, to the range ----
    const custCtx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const cust = await custCtx.newPage();
    cust.on("response", async (res) => {
      if (res.request().method() !== "POST" || !res.url().includes("/api/wizard/draft")) return;
      const j = await res.json().catch(() => null) as { id?: string } | null;
      if (j?.id) draftId = j.id;
    });
    const parts = new URLSearchParams({ street: "9 Loop Street", suburb, state: "VIC", postcode: "3070", address: `9 Loop Street, ${suburb} VIC 3070`, mode: "home", src: "homepage_hero", scope: "interior" });
    await cust.goto(`${baseURL}/estimate?${parts.toString()}`);
    await cust.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(cust.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await at(cust, "what");
    await cust.getByTestId("ql-jobtype-interior").tap();
    await at(cust, "property");
    await cust.getByTestId("ql-kind-house").tap();
    await at(cust, "beds");
    await cust.getByTestId("ql-bedrooms-3").click();
    await at(cust, "storeys");
    await cust.getByTestId("ql-storeys-single").click();
    await at(cust, "job");
    await cust.getByTestId("ql-scope-whole").click();
    await at(cust, "surfaces");
    await quickNext(cust);
    await at(cust, "rooms");
    await quickNext(cust);
    await at(cust, "colours");
    await cust.getByTestId("ql-colours-same").click();
    await at(cust, "condition");
    await cust.getByTestId("ql-condition-good").click();
    await at(cust, "living");
    await cust.getByTestId("ql-occupied-no").click();
    await at(cust, "details");
    await cust.getByTestId("gate-name").fill(NAME);
    await cust.getByTestId("gate-mobile").fill(MOBILE);
    await cust.getByTestId("gate-email").fill(EMAIL);
    await expect(cust.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await cust.getByTestId("ql-next").tap();
    await passOtpIfShown(cust);
    await expect(cust.getByTestId("wzm-gate")).toBeVisible({ timeout: 90_000 });
    await expect(cust.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    await expect.poll(async () => {
      const { data: d, error: e } = await db!.from("wizard_drafts").select("estimate_id").eq("id", draftId).maybeSingle();
      if (e) throw new Error(e.message);
      return (d as { estimate_id: string | null } | null)?.estimate_id ?? "";
    }, { timeout: 30_000, message: "the range wrote the lead's estimate" }).not.toBe("");
    estimateId = ((await db!.from("wizard_drafts").select("estimate_id").eq("id", draftId).single()).data as { estimate_id: string }).estimate_id;
    const tok = await db!.from("estimates").select("share_token, lead_snapshot").eq("id", estimateId).single();
    if (tok.error) throw tok.error;
    const token = (tok.data as { share_token: string }).share_token;
    expect(token, "A‑F: the lead has a range page").toBeTruthy();

    // ---- 2 · L1: two hours on, nothing done → one text with the range page ----
    const back = ago(2.2);
    const b1 = await db!.from("wizard_drafts").update({ range_shown_at: back, gate_completed_at: back, last_seen_at: back }).eq("id", draftId);
    if (b1.error) throw b1.error;
    // crm_events is append-only (no UPDATE, even for the service key), so the wizard's
    // events are moved back by re-inserting them: same rows, two hours earlier.
    const evs = await db!.from("crm_events").select("*").eq("wizard_draft_id", draftId);
    if (evs.error) throw evs.error;
    const del = await db!.from("crm_events").delete().eq("wizard_draft_id", draftId);
    if (del.error) throw del.error;
    const moved = (evs.data ?? []).map((e: Record<string, unknown>) => {
      const copy: Record<string, unknown> = { ...e, occurred_at: back };
      delete copy.id;
      return copy;
    });
    if (moved.length > 0) {
      const b2 = await db!.from("crm_events").insert(moved);
      if (b2.error) throw b2.error;
    }
    await sweep("leads");
    const l1 = await textsFor("lead_range_reminder");
    expect(l1, "L1: one text").toHaveLength(1);
    expect(l1[0]).toContain(`/e/${token}`);

    // ---- 3 · they reply on the range page's chat → E8, routed by the hours ----
    const before = requestAlertRoute(new Date(), await holidays());
    const chat = await cust.request.post("/api/estimates/chat", { data: { token, body: "Does that include the ceilings?" } });
    expect(chat.status(), await chat.text()).toBe(200);
    const after = requestAlertRoute(new Date(), await holidays());
    const msg = await db!.from("estimate_messages").select("id").eq("estimate_id", estimateId).eq("direction", "customer").single();
    if (msg.error) throw msg.error;
    const e8 = await db!.from("staff_notifications").select("recipients").eq("event_key", "office_estimate_chat").eq("entity_id", (msg.data as { id: string }).id);
    if (e8.error) throw e8.error;
    expect(e8.data, "E8: one alert").toHaveLength(1);
    const e8mine = ((e8.data![0] as { recipients: { profile_id: string; channel: string }[] }).recipients).filter((r) => r.profile_id === staffId).map((r) => r.channel);
    expect(e8mine).toContain("email");
    if (before.inHours && after.inHours) expect(e8mine, "E8 in office hours: email only").toEqual(["email"]);

    // ---- 4 · a visit request from their own phone → L10 alert ----
    const vr = await cust.request.post("/api/visits/request", { data: {
      estimateId, kind: "time", name: NAME, email: EMAIL, mobile: MOBILE, suburb, postcode: "3070", preferredDays: [2], timeOfDay: "morning",
    } });
    expect(vr.status(), await vr.text()).toBe(200);
    const vrEv = await db!.from("crm_events").select("id").eq("estimate_id", estimateId).eq("type", "visit_request_made").single();
    if (vrEv.error) throw vrEv.error;
    await expect.poll(async () => {
      const { data: n, error: e } = await db!.from("staff_notifications").select("id").eq("event_key", "office_visit_request").eq("entity_id", (vrEv.data as { id: string }).id);
      if (e) throw new Error(e.message);
      return (n ?? []).length;
    }, { timeout: 20_000, message: "L10: one staff alert" }).toBe(1);

    // ---- 5 · the office: visit done, the estimate sent four days ago, opened two days ago ----
    // The customer's question goes back before the send, as it happened in life (a chat after the
    // first open is a conversation, and a conversation rightly stops E4).
    const q = await db!.from("estimate_messages").update({ created_at: ago(24 * 5) }).eq("estimate_id", estimateId);
    if (q.error) throw q.error;
    const card = await db!.from("rate_cards").select("id, version").eq("is_active", true).single();
    if (card.error) throw new Error(`no active rate card — run scripts/c1/seed.mjs (${card.error.message})`);
    const acct = await db!.from("estimates").select("account_id").eq("id", estimateId).single();
    const sent = await db!.from("estimates").update({
      status: "sent", sent_at: ago(24 * 4), level_of_finish: 3, total_cents: 110000, rate_card_id: card.data.id, rate_card_version: card.data.version,
      valid_until: melDayPlus(26),
      sent_snapshot: {
        version: 1,
        company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
        estRef: `EST-LOOP${run}`, contactName: NAME, contactEmail: EMAIL,
        totals: { totalCents: 110000 }, depositPct: 10,
        jobAddress: `9 Loop Street, ${suburb} VIC 3070`, jobTitle: "Interior repaint", gstRatePct: 10, baseSubtotalCents: 100000,
        areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
        lineItems: [], options: [], paints: [], inclusions: [], exclusions: [],
        proof: { rating: 4.9, reviews: 100, liability: "$20m", warrantyYears: 2 }, terms: "",
      },
    }).eq("id", estimateId);
    if (sent.error) throw sent.error;
    const visit = await db!.from("visits").insert({
      account_id: (acct.data as { account_id: string | null }).account_id, estimate_id: estimateId,
      starts_at: ago(24 * 4.5), ends_at: ago(24 * 4.5 - 1), kind: "quote", status: "done", source: "staff", outcome_at: ago(24 * 4.5),
      customer_name: NAME, customer_phone: MOBILE, address: `9 Loop Street, ${suburb} VIC 3070`,
    });
    if (visit.error) throw visit.error;
    const viewed = await db!.from("crm_events").insert({ estimate_id: estimateId, type: "estimate_viewed", source: "customer", payload: {}, occurred_at: ago(24 * 2.1), dedupe_key: `e2e-loop-viewed-${run}` });
    if (viewed.error) throw viewed.error;

    // ---- 6 · E4 on their chat: anything to change or explain? ----
    await sweep("estimates");
    const e4 = await db!.from("estimate_messages").select("body").eq("estimate_id", estimateId).eq("direction", "staff");
    if (e4.error) throw e4.error;
    expect((e4.data ?? []).map((m) => (m as { body: string }).body).filter((b) => b.includes("Anything you'd like changed or explained?")), "E4: one chat line").toHaveLength(1);

    // ---- 7 · they sign and accept on their own phone → W1 welcome ----
    await cust.goto(`/e/${token}`);
    await cust.getByRole("button", { name: "Accept this estimate" }).first().click();
    await cust.getByPlaceholder("Your full name").fill(NAME);
    await cust.getByTestId("signature-canvas").scrollIntoViewIfNeeded();
    await drawSignature(cust);
    await cust.getByRole("button", { name: "Accept & continue" }).click();
    await expect(cust.locator(".resultbanner.accepted").first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const { data: w1, error: e } = await db!.from("messages").select("id").eq("estimate_id", estimateId).eq("direction", "out").eq("meta->>automation", "customer_accepted_welcome");
      if (e) throw new Error(e.message);
      return (w1 ?? []).length;
    }, { timeout: 30_000, message: "W1: the welcome went" }).toBeGreaterThan(0);

    // ---- 8 · the office books the job for three days' time; W2 says the deposit is due ----
    const dep = await db!.from("invoices").select("id").eq("estimate_id", estimateId).eq("kind", "deposit").maybeSingle();
    if (dep.error) throw dep.error;
    expect(dep.data, "acceptance drafted the deposit invoice").not.toBeNull();
    const issue = await db!.from("invoices").update({ status: "issued", number: `INV-E2E${run.slice(-4)}`, issued_on: melDayPlus(0), due_on: melDayPlus(2) }).eq("id", (dep.data as { id: string }).id);
    if (issue.error) throw issue.error;
    const start = melDayPlus(3);
    // Acceptance opens the job's work order itself (one per estimate); the office books it.
    const wo = await db!.from("work_orders").select("id").eq("estimate_id", estimateId).maybeSingle();
    if (wo.error) throw wo.error;
    expect(wo.data, "acceptance opened the work order").not.toBeNull();
    workOrderId = (wo.data as { id: string }).id;
    const booked = await db!.from("work_orders").update({ stage: "pre_start", status: "issued", issued_at: new Date().toISOString(), start_date: start }).eq("id", workOrderId);
    if (booked.error) throw booked.error;
    await sweep("reminders");
    const w2Due = morningBeforeDue(start, 3, new Date());
    const w2 = await textsFor("deposit_due");
    const w2chat = ((await db!.from("estimate_messages").select("body").eq("estimate_id", estimateId).eq("direction", "staff")).data ?? [])
      .map((m) => (m as { body: string }).body).filter((b) => b.includes("deposit of"));
    if (w2Due) {
      expect(w2, "W2: one text").toHaveLength(1);
      expect(w2[0]).toContain("deposit of");
      expect(w2chat, "W2: one chat line").toHaveLength(1);
    } else {
      // Before 9 am Melbourne the deposit text is not due yet.
      expect(w2).toHaveLength(0);
    }
    await custCtx.close();
  });
});
