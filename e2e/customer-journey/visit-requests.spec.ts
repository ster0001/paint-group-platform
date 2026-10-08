import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../fixtures/woLoop";
import { gotoTodayWith } from "../helpers";
import { openQuickLook, quickNext } from "./drive";
import { cleanupCustomers, ensureEstimator, fillDetailsIfAsked, loginStaff, RUN, staffEmail, startCustomer, type Customer } from "./visitHelpers";
import { melbourneParts } from "../../lib/time/businessHours";

/**
 * Visit booking addendum A · S4 — requests, pre-arranged and out of area, as
 * an ANONYMOUS customer, then staff answering on the real screens.
 *
 *   · Sorrento never sees the calendar: the request-a-time screen, chips,
 *     "Thank you, we have your request"; the row, its due time, the Today card
 *   · Werribee: the out-of-area screen, the message step; the message is in the
 *     estimate chat ONCE (a retry with the same client id is not a second one),
 *     emailed, and the customer is saved as a lead
 *   · a visit requested at step 2 of the wizard: all four contact fields on
 *     the row, nothing booked; a message before the range asks for details
 *     first and lands in the website chat with a handoff
 *   · Speak with us: shown inside the phone range, absent outside it; the API
 *     refuses a call request outside it (section 8, test 16)
 *   · staff offer a time: the visit is booked, the request answered, the
 *     customer told; an overdue request reads as overdue
 */

const db: SupabaseClient | null = serviceClient();

test.describe("S4 — requests, pre-arranged, out of area, Speak with us, messages", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staffEmail, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_EMAIL");
  const customers: Customer[] = [];
  let restore: () => Promise<void> = async () => undefined;
  let rulesBefore: unknown = null;
  let sorrentoRequestId = "";
  let sorrentoName = "";

  test.beforeAll(async () => {
    restore = (await ensureEstimator(db!)).restore;
    const { data: r } = await db!.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
    rulesBefore = r?.value ?? null;
  });
  test.afterAll(async () => {
    await cleanupCustomers(db!, customers);
    if (rulesBefore) await db!.from("settings").upsert({ key: "visit_booking_rules", value: rulesBefore }, { onConflict: "key" });
    await restore();
  });

  test("Sorrento never sees the calendar; the time request lands on Today, due the end of the next working day", async ({ browser, page }) => {
    const c = await startCustomer(browser, "sorrento", "Sorrento", "3943");
    customers.push(c);
    await c.page.getByTestId("door-book").click();
    await c.page.waitForURL((u) => u.pathname === "/estimate/visit");
    await fillDetailsIfAsked(c, "Pat Shore");
    await expect(c.page.getByTestId("visit-request")).toBeVisible();
    await expect(c.page.getByRole("heading", { name: "We visit Sorrento by arrangement" })).toBeVisible();
    await expect(c.page.getByText("Tell us which days suit you and we will confirm a time with you.")).toBeVisible();
    await expect(c.page.getByTestId("visit-calendar")).toHaveCount(0);
    await c.page.getByTestId("visit-day-1").click();
    await c.page.getByTestId("visit-day-3").click();
    await c.page.getByTestId("visit-part-morning").click();
    await c.page.getByTestId("visit-request-send").click();
    await expect(c.page.getByTestId("visit-request-sent")).toBeVisible();
    await expect(c.page.getByRole("heading", { name: "Thank you, we have your request" })).toBeVisible();
    await expect(c.page.getByText("We will be in touch within one working day to arrange your site visit.")).toBeVisible();

    const { data: req } = await db!.from("visit_requests").select("id, kind, zone, suburb, preferred_days, time_of_day, due_at, name, email, mobile, answered_at").eq("estimate_id", c.estimateId).single();
    expect(req).toMatchObject({ kind: "time", zone: "pre_arranged", suburb: "Sorrento", preferred_days: [1, 3], time_of_day: "morning", answered_at: null });
    sorrentoName = req!.name as string;
    sorrentoRequestId = req!.id as string;
    const due = melbourneParts(new Date(req!.due_at as string));
    expect(due.h).toBe(17);
    expect(due.weekday).toBeGreaterThanOrEqual(1);
    expect(due.weekday).toBeLessThanOrEqual(5);
    expect(new Date(req!.due_at as string).getTime()).toBeGreaterThan(Date.now());
    const { data: v } = await db!.from("visits").select("id").eq("estimate_id", c.estimateId);
    expect(v?.length).toBe(0);
    const { data: mail } = await db!.from("messages").select("id").eq("to_address", c.email).ilike("body", "%we have your request%");
    expect(mail?.length).toBeGreaterThan(0);

    await loginStaff(page);
    const card = page.getByText(`Offer a visit time — ${sorrentoName}`).first();
    await gotoTodayWith(page, "/crm/today?f=followups", card);
    await expect(card).toBeVisible();
  });

  test("Werribee: out of area, a message into the estimate chat once, emailed, the lead saved", async ({ browser }) => {
    const c = await startCustomer(browser, "werribee", "Werribee", "3030");
    customers.push(c);
    await c.page.getByTestId("door-book").click();
    await expect(c.page.getByRole("heading", { name: "We don’t currently visit Werribee" })).toBeVisible();
    await expect(c.page.getByText("We are sorry, this address is outside the area we cover for site visits. You are welcome to send us a message and we will let you know if we can help.")).toBeVisible();
    await c.page.getByTestId("visit-message-go").click();
    // Details first if we hold none (range first); straight to the box when the gate took them.
    const details = c.page.getByTestId("visit-details");
    await expect(details.or(c.page.getByTestId("visit-message"))).toBeVisible();
    if (await details.count()) {
      await c.page.getByTestId("visit-name").fill("Wes West");
      await c.page.getByTestId("visit-email").fill(c.email);
      await c.page.getByTestId("visit-mobile").fill(c.mobile);
      await c.page.getByTestId("visit-details-go").click();
    }
    await expect(c.page.getByTestId("visit-message")).toBeVisible();
    await expect(c.page.getByText("Tell us a little about your project and we will reply by email or phone.")).toBeVisible();
    const text = `Can you do a weatherboard place in Werribee? ${RUN}`;
    await c.page.getByTestId("visit-message-text").fill(text);
    await c.page.getByTestId("visit-message-send").click();
    await expect(c.page.getByRole("heading", { name: "Thank you, your message is with us" })).toBeVisible({ timeout: 45_000 });
    await expect(c.page.getByText("We will reply within one working day.")).toBeVisible();

    const { data: chat } = await db!.from("estimate_messages").select("id, body, direction").eq("estimate_id", c.estimateId);
    expect(chat?.length).toBe(1);
    expect(chat![0]).toMatchObject({ direction: "customer", body: text });
    // One email to the office with the customer copied (R35). Since 29 Sep a multi-address
    // send logs ONE row: `to_address` is the first address (the office), the rest ride
    // `meta.alsoTo` — so the customer's copy is looked for in both.
    const { data: mail } = await db!.from("messages").select("id, to_address, meta").ilike("body", `%${RUN}%`).eq("channel", "email");
    expect(mail?.length).toBeGreaterThan(0);
    const addressed = (m: { to_address: string | null; meta: unknown }) =>
      [m.to_address ?? "", ...(((m.meta as { alsoTo?: string[] } | null)?.alsoTo) ?? [])].map((a) => a.toLowerCase());
    expect(mail!.some((m) => addressed(m as { to_address: string | null; meta: unknown }).includes(c.email.toLowerCase())),
      "the customer is on the email, as the first address or a copy").toBe(true);
    const { data: acc } = await db!.from("accounts").select("id, name").eq("email", c.email).maybeSingle();
    expect(acc?.name).toBeTruthy();

    // Section 8, test 17: the same message retried is one message.
    const { data: rcpt } = await db!.from("customer_message_receipts").select("client_id").eq("estimate_id", c.estimateId).single();
    const again = await c.page.request.post("/api/visits/message", { data: { estimateId: c.estimateId, clientId: rcpt!.client_id, body: text } });
    expect(again.status()).toBe(200);
    expect((await again.json()).repeated).toBe(true);
    const { data: chat2 } = await db!.from("estimate_messages").select("id").eq("estimate_id", c.estimateId);
    expect(chat2?.length).toBe(1);
  });

  test("before the range: a visit requested at step 2 has all four fields and books nothing; a message asks for details first and reaches the website chat", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openQuickLook(page);
    await page.getByPlaceholder(/Your address/).fill("9 Request Road, Kew");
    await page.getByPlaceholder("Suburb").fill("Kew");
    await page.getByPlaceholder("Postcode").fill("3101");
    await quickNext(page);
    // Step 2: the three options are there.
    await expect(page.getByTestId("ql-talk")).toContainText("Would you rather talk it through?");
    await expect(page.getByTestId("ql-book")).toHaveText("Request a site visit");
    await expect(page.getByTestId("ql-message")).toHaveText("Send a message");
    const email = `visit.prerange.${RUN}@example.com`, mobile = "0412 000 777";
    await page.getByTestId("ql-book").click();
    await expect(page.getByTestId("talk-sheet")).toBeVisible();
    await expect(page.getByText("Tell us where the property is and how to reach you, and we will arrange a visit.")).toBeVisible();
    await page.getByTestId("talk-name").fill("Early Bird");
    // The address is asked only when the estimate has none (TalkSheet `needAddress`); step 1
    // already took it, so the box may be absent — the saved request must still carry it (below).
    const talkAddress = page.getByTestId("talk-address");
    if (await talkAddress.count()) await expect(talkAddress).toHaveValue(/Request Road/);
    await page.getByTestId("talk-email").fill(email);
    await page.getByTestId("talk-mobile").fill(mobile);
    await page.getByTestId("talk-note").fill("Two bedrooms and the hall.");
    await page.getByTestId("talk-go").click();
    await expect(page.getByTestId("talk-sent")).toHaveText("We will be in touch within one working day to arrange your site visit.");
    const { data: req } = await db!.from("visit_requests").select("id, kind, name, email, mobile, address, note, estimate_id, zone").eq("email", email).single();
    expect(req).toMatchObject({ kind: "visit", name: "Early Bird", mobile: "+61412000777", estimate_id: null, zone: "zone_1" });
    expect(req!.address as string).toMatch(/Request Road/);
    expect(req!.note).toBe("Two bedrooms and the hall.");
    const { count } = await db!.from("visits").select("id", { count: "exact", head: true }).eq("customer_phone", "+61412000777");
    expect(count).toBe(0);
    await page.getByTestId("talk-close").click();

    // A message before the range: details first, then the box; it lands in the website chat with a handoff.
    await page.getByTestId("ql-message").click();
    await expect(page.getByRole("heading", { name: "A few details first" })).toBeVisible();
    await page.getByTestId("talk-name").fill("Early Bird");
    await page.getByTestId("talk-email").fill(email);
    await page.getByTestId("talk-mobile").fill(mobile);
    await page.getByTestId("talk-go").click();
    await expect(page.getByRole("heading", { name: "Send us a message" })).toBeVisible();
    const msg = `Do you paint ceilings too? ${RUN}`;
    await page.getByTestId("talk-message").fill(msg);
    await page.getByTestId("talk-send").click();
    await expect(page.getByTestId("talk-sent")).toHaveText("We will reply within one working day.");
    const { data: am } = await db!.from("agent_messages").select("conversation_id, role, content").eq("content", msg);
    expect(am?.length).toBe(1);
    expect(am![0].role).toBe("user");
    const { data: ho } = await db!.from("agent_handoffs").select("status").eq("conversation_id", am![0].conversation_id as string);
    expect(ho?.length).toBe(1);
    const { data: acc } = await db!.from("accounts").select("id").eq("email", email).maybeSingle();
    expect(acc).not.toBeNull();
    customers.push({ page, estimateId: "", mobile, email });
    await db!.from("agent_handoffs").delete().eq("conversation_id", am![0].conversation_id as string);
    await db!.from("agent_messages").delete().eq("conversation_id", am![0].conversation_id as string);
    await db!.from("agent_conversations").delete().eq("id", am![0].conversation_id as string);
  });

  test("Speak with us shows inside the phone range and is absent outside it; the API refuses a call outside it (test 16)", async ({ browser }) => {
    const { data: r } = await db!.from("settings").select("value").eq("key", "visit_booking_rules").single();
    const rules = r!.value as Record<string, unknown>;
    // Inside: caps far above any guide range.
    await db!.from("settings").upsert({ key: "visit_booking_rules", value: { ...rules, speakInteriorCapCents: 99_000_000, speakExteriorCapCents: 99_000_000 } }, { onConflict: "key" });
    const a = await startCustomer(browser, "speak-in");
    customers.push(a);
    await expect(a.page.getByTestId("door-speak")).toBeVisible();
    await expect(a.page.getByTestId("door-speak")).toContainText("Request a call to finalise your booking");
    await expect(a.page.getByTestId("door-message")).toContainText("Ask a question about your estimate");
    await a.page.getByTestId("door-speak").click();
    await a.page.getByTestId("talk-name").fill("Cal Lee");
    await a.page.getByTestId("talk-email").fill(a.email);
    await a.page.getByTestId("talk-mobile").fill(a.mobile);
    await a.page.getByTestId("talk-go").click();
    await expect(a.page.getByRole("heading", { name: "Thank you, we will call you" })).toBeVisible();
    await expect(a.page.getByTestId("talk-sent")).toContainText(`We will call you on ${a.mobile} within one working day to finalise your booking.`);
    const { data: req } = await db!.from("visit_requests").select("kind").eq("estimate_id", a.estimateId);
    expect(req).toEqual([{ kind: "call" }]);
    // Outside: caps of one cent.
    await db!.from("settings").upsert({ key: "visit_booking_rules", value: { ...rules, speakInteriorCapCents: 1, speakExteriorCapCents: 1 } }, { onConflict: "key" });
    const b = await startCustomer(browser, "speak-out");
    customers.push(b);
    await expect(b.page.getByTestId("door-book")).toBeVisible();
    await expect(b.page.getByTestId("door-speak")).toHaveCount(0);
    const refused = await b.page.request.post("/api/visits/request", { data: { estimateId: b.estimateId, kind: "call", name: "Cal Out", email: b.email, mobile: b.mobile } });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).code).toBe("outside_phone_range");
    await db!.from("settings").upsert({ key: "visit_booking_rules", value: rules }, { onConflict: "key" });
  });

  test("staff offer a time: the visit is booked, the request answered, the customer told; an overdue request reads as overdue", async ({ page }) => {
    test.skip(!sorrentoRequestId, "needs the Sorrento request from the first test");
    await loginStaff(page);
    await page.goto(`/crm/visit-requests/${sorrentoRequestId}`);
    await expect(page.getByTestId("visit-request")).toBeVisible();
    await expect(page.getByTestId("request-prefs")).toContainText("Mon, Wed · morning");
    const slot = page.getByTestId("request-slot").first();
    const startsAt = await slot.getAttribute("data-starts-at");
    await slot.click();
    await expect(page.getByTestId("request-done")).toContainText("Booked");
    const { data: req } = await db!.from("visit_requests").select("answered_at, visit_id, answer").eq("id", sorrentoRequestId).single();
    expect(req?.answered_at).not.toBeNull();
    expect(req?.answer).toBe("Time offered");
    const { data: visit } = await db!.from("visits").select("id, status, source, starts_at, zone, customer_name").eq("id", req!.visit_id as string).single();
    expect(visit).toMatchObject({ status: "booked", source: "staff", customer_name: sorrentoName });
    expect(new Date(visit!.starts_at as string).toISOString()).toBe(new Date(startsAt!).toISOString());
    const sorrento = customers.find((c) => c.email.startsWith("visit.sorrento."))!;
    const { data: texts } = await db!.from("messages").select("body").eq("to_address", `+61${sorrento.mobile.slice(1)}`).ilike("body", "%we have booked your site visit%");
    expect(texts?.length).toBe(1);
    await page.reload();
    await expect(page.getByTestId("request-answered")).toContainText("Time offered");
    // The card is gone from Today.
    await page.goto("/crm/today?f=followups");
    await expect(page.getByText(`Offer a visit time — ${sorrentoName}`)).toHaveCount(0);

    // Overdue: a request whose due time has passed reads as overdue.
    const werribee = customers.find((c) => c.email.startsWith("visit.werribee."))!;
    const { data: late } = await db!.from("visit_requests").insert({ kind: "time", estimate_id: werribee.estimateId, zone: "out_of_area", suburb: "Werribee", postcode: "3030", name: "Late Lane", email: werribee.email, mobile: `+61${werribee.mobile.slice(1)}`, due_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }).select("id").single();
    await page.goto(`/crm/visit-requests/${late!.id}`);
    await expect(page.getByTestId("request-due")).toContainText("overdue");
    const card = page.getByText("Offer a visit time — Late Lane").first();
    await gotoTodayWith(page, "/crm/today?f=followups", card);
    await expect(card).toBeVisible();
  });
});
