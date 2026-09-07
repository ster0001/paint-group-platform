import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * CRM v2 · P3 — the messaging spine, driven against the real routes and
 * screens (C1). The dev server must be started with:
 *   MESSAGES_INBOUND_SECRET, RESEND_WEBHOOK_SECRET (whsec_… the spec signs with)
 *   REPLY_DOMAIN (any value — reply routing is on), TWILIO_AUTH_TOKEN (signing)
 *
 *   · an email reply lands through the signed inbound route, matched by the
 *     sender's address, and becomes a Today item until someone answers
 *   · a reply addressed to reply+<token>@ joins the thread and the customer
 *     even from an unknown address
 *   · an unknown sender is STORED and attached to a customer by a person
 *   · Resend delivery events update the row; a bounce marks the customer
 *   · the SMS inbound route stores the text as a message row
 *   · the record's Messages section shows it all; a reply from there is
 *     recorded even when the channel is not configured on this server
 */

const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };
const INBOUND_SECRET = process.env.MESSAGES_INBOUND_SECRET ?? "whsec_dGVzdC1tZXNzYWdlcy1zZWNyZXQtMTIzNDU2Nzg5MA==";
const RESEND_SECRET = process.env.RESEND_WEBHOOK_SECRET ?? "whsec_dGVzdC1yZXNlbmQtc2VjcmV0LTEyMzQ1Njc4OTAxMg==";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const SITE = process.env.E2E_BASE_URL ?? "http://localhost:3103";

const run = randomBytes(4).toString("hex");
const DIGITS = String(parseInt(run.slice(0, 6), 16)).padStart(8, "0").slice(0, 8);
const PHONE = `04${DIGITS.slice(0, 2)} ${DIGITS.slice(2, 5)} ${DIGITS.slice(5, 8)}`;
const NAME = `Priya Messages ${run}`;
const EMAIL = `crm.p3.${run}@volume.example`;

function svixHeaders(secret: string, payload: string, id: string): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${sig}`, "content-type": "application/json" };
}

function twilioSignature(url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", TWILIO_TOKEN).update(data).digest("base64");
}

async function postInbound(request: APIRequestContext, email: { from: string; to: string; subject: string; text: string; messageId: string }) {
  const payload = JSON.stringify({ type: "email.received", data: { message_id: email.messageId, from: email.from, to: [email.to], subject: email.subject, text: email.text } });
  return request.post("/api/inbound/messages", { data: payload, headers: svixHeaders(INBOUND_SECRET, payload, `msg_${email.messageId}`) });
}

async function loginAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function findOnToday(page: Page, text: string): Promise<boolean> {
  for (let p = 1; p <= 12; p++) {
    await page.goto(`/crm/today?f=messages&page=${p}`);
    if (await page.getByText(text).count()) return true;
    if (!(await page.locator("a", { hasText: "Older →" }).count())) break;
  }
  return false;
}

test.describe("CRM v2 P3 — the messaging spine", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  let accountId = "";
  let unmatchedId = "";
  let outboundId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const acc = await sb.from("accounts").insert({ email: EMAIL, name: NAME, phone: PHONE }).select("id").single();
    if (acc.error) throw new Error(acc.error.message);
    accountId = acc.data.id as string;
    // An email we "sent" earlier, with a reply token — the thread root.
    const out = await sb.from("messages").insert({
      account_id: accountId, channel: "email", direction: "out", subject: "Your estimate", body: "Here it is.",
      provider: "resend", provider_message_id: `re_${run}`, status: "sent", reply_token: `tok${run}`, to_address: EMAIL,
    }).select("id").single();
    if (out.error) throw new Error(out.error.message);
    outboundId = out.data.id as string;
  });

  test.afterAll(async () => {
    const sb = db!;
    if (unmatchedId) await sb.from("messages").delete().eq("id", unmatchedId);
    if (accountId) {
      const { error } = await sb.from("accounts").delete().eq("id", accountId);
      if (error) throw new Error(`account delete failed: ${error.message}`);
    }
  });

  test("a customer's email reply lands, matched by sender, and Today asks for an answer", async ({ request, page }) => {
    const res = await postInbound(request, { from: EMAIL, to: "info@paintgroup.com.au", subject: `Re: quote ${run}`, text: `Can you add the ceilings? ${run}`, messageId: `in1-${run}@mail` });
    expect(res.status()).toBe(200);
    expect((await res.json()).matched).toBe(true);
    const { data: rows } = await db!.from("messages").select("id, account_id, direction, channel, status").eq("provider_message_id", `in1-${run}@mail`);
    expect(rows?.[0]).toMatchObject({ account_id: accountId, direction: "in", channel: "email", status: "received" });
    const { data: ev } = await db!.from("crm_events").select("type").eq("account_id", accountId).eq("type", "message_in");
    expect((ev ?? []).length).toBeGreaterThanOrEqual(1);

    await loginAs(page, staff);
    expect(await findOnToday(page, `${NAME} sent a email`)).toBe(true);
  });

  test("a reply to reply+<token>@ joins the thread, even from an unknown address", async ({ request }) => {
    const res = await postInbound(request, { from: `other.${run}@volume.example`, to: `reply+tok${run}@reply.c1.test`, subject: "Re: Your estimate", text: `Looks good ${run}`, messageId: `in2-${run}@mail` });
    expect(res.status()).toBe(200);
    const { data } = await db!.from("messages").select("account_id, thread_id").eq("provider_message_id", `in2-${run}@mail`).single();
    expect(data).toMatchObject({ account_id: accountId, thread_id: outboundId });
  });

  test("an unknown sender is stored, shows in Today, and a person attaches it — the address becomes a contact", async ({ request, page }) => {
    const res = await postInbound(request, { from: `stranger.${run}@volume.example`, to: "info@paintgroup.com.au", subject: `Hello ${run}`, text: `Is the quote still valid? ${run}`, messageId: `in3-${run}@mail` });
    expect((await res.json()).matched).toBe(false);
    const { data } = await db!.from("messages").select("id, account_id").eq("provider_message_id", `in3-${run}@mail`).single();
    expect(data?.account_id).toBeNull();
    unmatchedId = data!.id as string;

    await loginAs(page, staff);
    expect(await findOnToday(page, `stranger.${run}@volume.example`)).toBe(true);
    await page.goto(`/crm/messages/${unmatchedId}`);
    await expect(page.getByTestId("attach")).toBeVisible();
    await page.getByLabel("Search customers").fill(`Messages ${run}`);
    await page.getByRole("button", { name: /Attach to Priya/ }).click();
    await page.waitForURL(new RegExp(`/crm/customers/${accountId}`));
    await expect(page.getByTestId("messages")).toContainText(`Is the quote still valid? ${run}`);
    await expect(page.getByTestId("contacts")).toContainText(`stranger.${run}@volume.example`);
    unmatchedId = "";
  });

  test("delivery events from Resend update the row; a bounce marks the customer undeliverable", async ({ request }) => {
    const sign = (type: string) => {
      const payload = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: `re_${run}`, bounce: { type: "Permanent" } } });
      return request.post("/api/webhooks/resend", { data: payload, headers: svixHeaders(RESEND_SECRET, payload, `evt_${type}_${run}`) });
    };
    expect((await sign("email.delivered")).status()).toBe(200);
    let row = await db!.from("messages").select("status").eq("id", outboundId).single();
    expect(row.data?.status).toBe("delivered");
    expect((await sign("email.opened")).status()).toBe(200);
    row = await db!.from("messages").select("status").eq("id", outboundId).single();
    expect(row.data?.status).toBe("opened");
    // A late "delivered" never downgrades "opened".
    await sign("email.delivered");
    row = await db!.from("messages").select("status").eq("id", outboundId).single();
    expect(row.data?.status).toBe("opened");
    await sign("email.bounced");
    const acc = await db!.from("accounts").select("marketing_undeliverable_at").eq("id", accountId).single();
    expect(acc.data?.marketing_undeliverable_at).not.toBeNull();
  });

  test("a text from the customer is a message row, matched by the normalised phone", async ({ request }) => {
    test.skip(!TWILIO_TOKEN, "needs TWILIO_AUTH_TOKEN to sign");
    const url = `${SITE}/api/sms/inbound`;
    const params = { From: `+61${DIGITS}`.replace("+610", "+61"), To: "+61485065878", Body: `Yes please go ahead ${run}`, MessageSid: `SM${run}` };
    params.From = `+614${DIGITS.slice(0, 2)}${DIGITS.slice(2)}`;
    const res = await request.post(url, { form: params, headers: { "x-twilio-signature": twilioSignature(url, params) } });
    expect(res.status()).toBe(200);
    const { data } = await db!.from("messages").select("account_id, channel, direction, body").eq("provider_message_id", `SM${run}`).single();
    expect(data).toMatchObject({ account_id: accountId, channel: "sms", direction: "in" });
  });

  test("the record shows the conversation, and a reply from it is recorded even when the channel is not configured here", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/customers/${accountId}`);
    const list = page.getByTestId("messages");
    await expect(list).toContainText(`Can you add the ceilings? ${run}`);
    await expect(list).toContainText("Your estimate");
    // Marked read on open.
    await expect.poll(async () => {
      const { data } = await db!.from("messages").select("read_at").eq("provider_message_id", `in1-${run}@mail`).single();
      return data?.read_at != null;
    }, { timeout: 10_000 }).toBe(true);

    const box = page.getByTestId("reply-box");
    await box.getByRole("button", { name: "Text" }).click();
    await box.getByLabel("Reply").fill(`Ceilings added — new total coming ${run}`);
    await box.getByRole("button", { name: "Send text" }).click();
    await expect(list).toContainText(`Ceilings added — new total coming ${run}`);
    const { data } = await db!.from("messages").select("status, direction, channel").eq("account_id", accountId).eq("direction", "out").eq("channel", "sms").order("occurred_at", { ascending: false }).limit(1).single();
    // C1 carries test Twilio keys that the API refuses: "failed" is the honest record, and it is recorded.
    expect(["sent", "not_configured", "failed"]).toContain(data?.status);
  });
});
