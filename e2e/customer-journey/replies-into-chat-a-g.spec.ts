import { expect, type APIRequestContext } from "@playwright/test";
import { createHmac, randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { test } from "../helpers";

/**
 * Automations ruling A‑G (Tom, 11 Nov 2026): a customer's email or text reply
 * lands in the estimate chat, so their page and the office read ONE thread.
 *
 *  1. We emailed the customer about their estimate (a chat reply, with a
 *     reply token). They answer by email → the reply is on the chat their
 *     ANONYMOUS page shows, without the quoted history; the CRM holds it once
 *     (no second "portal" copy); a retried webhook posts it once.
 *  2. We texted them about it. They answer by text → on the same chat.
 *  3. The office's chat ALERT is answered by email from a staff address →
 *     it posts as the office's reply (this path needed messages.meta.kind:
 *     the route selected a `kind` column that does not exist, so it never ran).
 */
const db = serviceClient();
const run = randomBytes(4).toString("hex");
const INBOUND_SECRET = process.env.MESSAGES_INBOUND_SECRET ?? "whsec_dGVzdC1tZXNzYWdlcy1zZWNyZXQtMTIzNDU2Nzg5MA==";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const SITE = process.env.E2E_BASE_URL ?? "http://localhost:3103";
const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL ?? "";
const DIGITS = String(parseInt(run.slice(0, 6), 16)).padStart(8, "0").slice(0, 8);
const MOBILE = `+614${DIGITS}`;
const EMAIL = `pg.e2e.ag.${run}@example.com`;

const SNAPSHOT = {
  version: 1, estRef: `EST-G${run}`,
  company: { name: "Paint Group Pty Ltd", addressLine1: "1 Example St", addressLine2: "Melbourne VIC", phone: "(03) 9000 0000", abn: "11 222 333 444", email: "hello@example.com", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: "Gita Replies", contactEmail: EMAIL, jobTitle: "Interior repaint", jobAddress: "7 Reply Street, Fairfield VIC 3078",
  gstRatePct: 10, depositPct: 10, lineItems: [], options: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 200000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 200000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
  paints: [],
};

function svixHeaders(payload: string, id: string): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const key = Buffer.from(INBOUND_SECRET.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${sig}`, "content-type": "application/json" };
}
const postEmail = (request: APIRequestContext, e: { from: string; to: string; text: string; messageId: string }) => {
  const payload = JSON.stringify({ type: "email.received", data: { message_id: e.messageId, from: e.from, to: [e.to], subject: "Re: your estimate", text: e.text } });
  return request.post("/api/inbound/messages", { data: payload, headers: svixHeaders(payload, `msg_${e.messageId}`) });
};

test.describe("Replies land in the estimate chat (A‑G)", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db, "service key needed");
  let estId = "";
  const token = `ag${run}${randomBytes(10).toString("hex")}`;

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Replies ${run}`, status: "sent", source: "manual", level_of_finish: 3, share_token: token,
      sent_at: new Date(Date.now() - 3_600_000).toISOString(), total_cents: 220000,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {}, contact: { name: "Gita Replies", email: EMAIL, phone: MOBILE } }, sent_snapshot: SNAPSHOT,
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estId = est.data.id as string;
    // What we sent them: the chat-reply email (reply token) and a text, both about this estimate.
    const out = await db!.from("messages").insert([
      { channel: "email", direction: "out", subject: "A reply on your estimate", body: "We replied.", provider: "resend", provider_message_id: `re_ag_${run}`, status: "sent", reply_token: `agtok${run}`, to_address: EMAIL, estimate_id: estId, meta: { kind: "chat_reply" } },
      { channel: "sms", direction: "out", body: "We replied — see your estimate.", provider: "twilio", provider_message_id: `SMout${run}`, status: "sent", to_address: MOBILE, estimate_id: estId, meta: { kind: "chat_reply" } },
      { channel: "email", direction: "out", subject: "Chat from Gita", body: "Alert.", provider: "resend", provider_message_id: `re_agalert_${run}`, status: "sent", reply_token: `agalert${run}`, to_address: STAFF_EMAIL || "office@example.com", estimate_id: estId, meta: { kind: "staff_alert" } },
    ]);
    if (out.error) throw new Error(out.error.message);
  });
  test.afterAll(async () => {
    if (!db || !estId) return;
    await db.from("estimate_messages").delete().eq("estimate_id", estId);
    await db.from("estimate_events").delete().eq("estimate_id", estId);
    await db.from("messages").delete().eq("estimate_id", estId);
    await db.from("messages").delete().like("provider_message_id", `%${run}%`);
    await db.from("crm_events").delete().eq("estimate_id", estId);
    await db.from("estimates").delete().eq("id", estId);
  });

  test("an email reply is on the customer's chat, once, without the quoted history", async ({ request, browser }) => {
    const text = `Can we do the hallway too? ${run}\n\nOn Tue, 10 Nov 2026 at 9:00 am Paint Group <hello@example.com> wrote:\n> We replied.`;
    const res = await postEmail(request, { from: EMAIL, to: `reply+agtok${run}@reply.c1.test`, text, messageId: `ag-in1-${run}@mail` });
    expect(res.status()).toBe(200);
    expect((await res.json()).chat).toBe("ok");
    // Resend retries: the same message again posts nothing new.
    const again = await postEmail(request, { from: EMAIL, to: `reply+agtok${run}@reply.c1.test`, text, messageId: `ag-in1-${run}@mail` });
    expect(again.status()).toBe(200);

    const { data: rows, error } = await db!.from("estimate_messages").select("direction, body, via").eq("estimate_id", estId);
    if (error) throw new Error(error.message);
    expect(rows).toEqual([{ direction: "customer", body: `Can we do the hallway too? ${run}`, via: "email" }]);
    // The CRM keeps the email once — no "portal" mirror of the same words.
    const { count, error: cErr } = await db!.from("messages").select("id", { count: "exact", head: true }).eq("estimate_id", estId).eq("direction", "in");
    if (cErr) throw new Error(cErr.message);
    expect(count).toBe(1);

    // The customer, anonymous, on their estimate: the chat shows it as theirs.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/e/${token}#chat`);
    const pop = page.getByTestId("chat-pop");
    await expect(pop).toBeVisible({ timeout: 30_000 });
    await expect(pop.locator(".chatrow.mine .chatbody")).toHaveText([`Can we do the hallway too? ${run}`]);
    await ctx.close();
  });

  test("a text reply goes on the chat of the estimate we last texted them about", async ({ request, browser }) => {
    test.skip(!TWILIO_TOKEN, "needs TWILIO_AUTH_TOKEN to sign");
    const url = `${SITE}/api/sms/inbound`;
    const params = { From: MOBILE, To: "+61485065878", Body: `Thursday suits ${run}`, MessageSid: `SMag${run}` };
    const data = url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("");
    const sig = createHmac("sha1", TWILIO_TOKEN).update(data).digest("base64");
    const res = await request.post(url, { form: params, headers: { "x-twilio-signature": sig } });
    expect(res.status()).toBe(200);
    await expect.poll(async () => {
      const { data: rows, error } = await db!.from("estimate_messages").select("body, via").eq("estimate_id", estId).eq("via", "sms");
      if (error) throw new Error(error.message);
      return rows?.map((r) => r.body) ?? [];
    }, { timeout: 15_000 }).toEqual([`Thursday suits ${run}`]);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/e/${token}#chat`);
    await expect(page.getByTestId("chat-pop").locator(".chatrow.mine .chatbody").last()).toHaveText(`Thursday suits ${run}`, { timeout: 30_000 });
    await ctx.close();
  });

  test("the office answering its chat alert by email posts the office's reply", async ({ request, browser }) => {
    test.skip(!STAFF_EMAIL, "needs E2E_STAFF_EMAIL (a staff login's address)");
    const res = await postEmail(request, { from: STAFF_EMAIL, to: `reply+agalert${run}@reply.c1.test`, text: `Yes, hallway added ${run}\n\n> Chat from Gita`, messageId: `ag-in3-${run}@mail` });
    expect(res.status()).toBe(200);
    expect((await res.json()).chatReply).toBe(true);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/e/${token}#chat`);
    await expect(page.getByTestId("chat-pop").locator(".chatrow.theirs .chatbody")).toContainText(`Yes, hallway added ${run}`, { timeout: 30_000 });
    await ctx.close();
  });
});
