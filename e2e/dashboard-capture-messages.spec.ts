import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Home dashboard v2 · session 0b — capture on messaging (B4).
 *
 * The account is the thread. This proves, from the customer's side of the
 * screen, what the dashboard's "customers awaiting reply" will read:
 *   · a customer message on the token chat is an inbound row from the
 *     customer, and the account's last_inbound_at moves;
 *   · an automated chase after it is `system` — outbound, not a reply — so
 *     the account is STILL awaiting reply (the brief's own test case);
 *   · a person's reply (the portal thread, mirrored into messages) is `staff`
 *     and last_staff_reply_at catches up;
 *   · the customer opening the thread again marks that reply read, with the
 *     source recorded as the portal.
 * The service client seeds and reads back; the customer drives /e/<token>
 * anonymously. Everything made here is deleted in afterAll.
 */
const db = serviceClient();

const SNAPSHOT_BASE = {
  version: 1,
  company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: "Thread Customer", contactEmail: "", jobTitle: "Interior repaint", gstRatePct: 10, depositPct: 10,
  lineItems: [], options: [], paints: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 100000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
};

test.describe("dashboard 0b · capture on messaging", () => {
  test.skip(!db, "needs the service client");
  const run = randomBytes(3).toString("hex");
  let accountId = ""; let estimateId = ""; let token = "";

  const facts = async () => {
    const r = await db!.from("crm_account_facts").select("last_inbound_at, last_staff_reply_at").eq("account_id", accountId).maybeSingle();
    if (r.error) throw new Error(r.error.message);
    return (r.data ?? { last_inbound_at: null, last_staff_reply_at: null }) as { last_inbound_at: string | null; last_staff_reply_at: string | null };
  };
  const awaiting = async () => {
    const f = await facts();
    return Boolean(f.last_inbound_at) && (!f.last_staff_reply_at || f.last_inbound_at! > f.last_staff_reply_at);
  };
  const rows = async () => {
    const r = await db!.from("messages").select("direction, sender_role, provider, read_at, meta, body").eq("account_id", accountId).order("occurred_at");
    if (r.error) throw new Error(r.error.message);
    return r.data as { direction: string; sender_role: string; provider: string; read_at: string | null; meta: Record<string, unknown>; body: string }[];
  };

  test.beforeAll(async () => {
    const acct = await db!.from("accounts").insert({ email: `pg.e2e.msg-${run}@example.com`, name: `Thread ${run}` }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id as string;
    token = `msg${randomBytes(18).toString("base64url")}`;
    const est = await db!.from("estimates").insert({
      status: "sent", source: "manual", level_of_finish: 3, title: `Thread ${run}`, account_id: accountId, lead_source: "unknown",
      sent_at: new Date().toISOString(), share_token: token, total_cents: 110000, subtotal_cents: 100000,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
      sent_snapshot: { ...SNAPSHOT_BASE, estRef: token.slice(0, 8).toUpperCase(), jobAddress: `1 Thread St ${run}` },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;
  });
  test.afterAll(async () => {
    if (!db) return;
    if (accountId) await db.from("messages").delete().eq("account_id", accountId);
    if (estimateId) await db.from("estimates").delete().eq("id", estimateId);
    if (accountId) await db.from("crm_events").delete().eq("account_id", accountId);
    if (accountId) await db.from("accounts").delete().eq("id", accountId);
  });

  test("a customer message waits through an automated chase, until a person replies and the customer reads it", async ({ browser }) => {
    expect(await facts()).toEqual({ last_inbound_at: null, last_staff_reply_at: null });

    // 1 · the customer writes in, on the token chat, signed out.
    const anon = await browser.newContext();
    const page = await anon.newPage();
    try {
      await page.goto(`/e/${token}#chat`);
      await page.getByPlaceholder("Type your message…").fill(`Can you do the ceilings too? ${run}`);
      await page.getByRole("button", { name: "Send message" }).click();
      await expect.poll(async () => (await rows()).length, { timeout: 15_000 }).toBe(1);
      const [inbound] = await rows();
      expect(inbound).toMatchObject({ direction: "in", sender_role: "customer", provider: "portal", read_at: null });
      await expect.poll(awaiting, { timeout: 15_000 }).toBe(true);
    } finally {
      await anon.close();
    }
    const afterCustomer = await facts();

    // 2 · an automation chases — outbound, `system`, NOT a reply.
    const chase = await db!.from("messages").insert({
      account_id: accountId, estimate_id: estimateId, channel: "sms", direction: "out", provider: "twilio", status: "sent",
      body: "Just checking you got our quote", meta: { automation: "quote_followup_1", kind: "estimate" },
    });
    expect(chase.error).toBeNull();
    expect((await rows()).map((r) => r.sender_role)).toEqual(["customer", "system"]);
    expect(await facts()).toEqual(afterCustomer);   // the reply clock did not move
    expect(await awaiting()).toBe(true);

    // 3 · a person replies on the thread (the builder's Chat tab writes this row).
    const reply = await db!.from("estimate_messages").insert({ estimate_id: estimateId, direction: "staff", body: `Yes — ceilings are in. ${run}`, author_name: "Sarah" });
    expect(reply.error).toBeNull();
    await expect.poll(async () => (await rows()).map((r) => r.sender_role), { timeout: 15_000 }).toEqual(["customer", "system", "staff"]);
    expect(await awaiting()).toBe(false);
    const f = await facts();
    expect(f.last_staff_reply_at! >= f.last_inbound_at!).toBe(true);
    expect((await rows())[2].read_at).toBeNull();

    // 4 · the customer opens the thread again: the reply is read, by the portal.
    const again = await browser.newContext();
    const page2 = await again.newPage();
    try {
      await page2.goto(`/e/${token}#chat`);
      await expect(page2.getByText(`Yes — ceilings are in. ${run}`)).toBeVisible();
      await expect.poll(async () => (await rows())[2].read_at, { timeout: 15_000 }).not.toBeNull();
      const staffRow = (await rows())[2];
      expect(staffRow.meta.readSource).toBe("portal");
      // The customer's own message and the chase are untouched.
      expect((await rows()).slice(0, 2).map((r) => r.read_at)).toEqual([null, null]);
    } finally {
      await again.close();
    }
  });

  test("a failed send is not a reply either", async () => {
    const failed = await db!.from("messages").insert({
      account_id: accountId, channel: "email", direction: "out", provider: "resend", status: "failed",
      body: "bounced", meta: { kind: "chat_reply", error: "mailbox full" },
    });
    expect(failed.error).toBeNull();
    const before = await facts();
    const late = await db!.from("estimate_messages").insert({ estimate_id: estimateId, direction: "customer", body: `Still there? ${run}` });
    expect(late.error).toBeNull();
    await expect.poll(async () => (await facts()).last_inbound_at, { timeout: 15_000 }).not.toBe(before.last_inbound_at);
    expect((await facts()).last_staff_reply_at).toBe(before.last_staff_reply_at);
    expect(await awaiting()).toBe(true);
  });
});
