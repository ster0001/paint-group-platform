import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * The two consent doors: the one-click unsubscribe page, and the SMS STOP
 * webhook. Both write marketing_unsubscribed_at — the flag every campaign
 * guard checks first — so both are exercised as the OUTSIDE world reaches
 * them: an unauthenticated browser, and a signed (or forged) Twilio POST.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missing = !url || !serviceKey;

// Mirrors lib/campaigns/send.ts — the secret falls back to the service key.
const unsubToken = (accountId: string) =>
  `${accountId}.${createHmac("sha256", process.env.MARKETING_UNSUBSCRIBE_SECRET || serviceKey!)
    .update(accountId).digest("base64url").slice(0, 32)}`;

test.describe("consent", () => {
  test.skip(missing, "Needs the test project's SUPABASE_SERVICE_ROLE_KEY (see .env.test.local)");

  const db = missing ? null : createClient(url!, serviceKey!);
  let accountId = "";
  const email = `e2e-consent-${Date.now()}@example.com`;
  const phone = "0400 555 666";

  test.beforeAll(async () => {
    const { data, error } = await db!.from("accounts")
      .insert({ email, name: "Consent Probe", phone }).select("id").single();
    if (error) throw new Error(`could not seed the consent account: ${error.message}`);
    accountId = data.id as string;
  });

  test.afterAll(async () => {
    if (db && accountId) await db.from("accounts").delete().eq("id", accountId);
  });

  test("the unsubscribe link works signed-out, in one click, and says so", async ({ page }) => {
    await page.goto(`/u/${unsubToken(accountId)}`);
    await expect(page.getByText(/you.re unsubscribed/i)).toBeVisible();

    const { data } = await db!.from("accounts")
      .select("marketing_unsubscribed_at").eq("id", accountId).single();
    expect(data!.marketing_unsubscribed_at, "the click must write the flag").not.toBeNull();
  });

  test("a token with the account id swapped unsubscribes nobody", async ({ page }) => {
    // The attack the signature exists for: edit the id in the URL.
    const forged = `${"11111111-1111-1111-1111-111111111111"}.${unsubToken(accountId).split(".")[1]}`;
    await page.goto(`/u/${forged}`);
    await expect(page.getByText(/didn.t work/i)).toBeVisible();
  });

  test("texting STOP writes the flag; an unsigned POST cannot", async ({ request }) => {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    test.skip(!authToken, "Needs TWILIO_AUTH_TOKEN in the e2e env so the spec can sign like Twilio");

    // Reset the flag the first test set, so STOP has something to do.
    await db!.from("accounts").update({ marketing_unsubscribed_at: null }).eq("id", accountId);

    const publicUrl = `${(process.env.NEXT_PUBLIC_SITE_URL || "https://paint-group-platform.vercel.app").replace(/\/$/, "")}/api/sms/inbound`;
    const params: Record<string, string> = { From: "+61400555666", Body: "STOP", MessageSid: `SM-e2e-${Date.now()}` };
    const sign = (p: Record<string, string>) =>
      createHmac("sha1", authToken!)
        .update(Buffer.from(publicUrl + Object.keys(p).sort().map((k) => k + p[k]).join(""), "utf-8"))
        .digest("base64");

    // Forged first: anyone can POST to a public route, and this one's only
    // power is writing consent flags.
    const forged = await request.post("/api/sms/inbound", { form: params });
    expect(forged.status(), "an unsigned POST must be refused").toBe(403);

    const real = await request.post("/api/sms/inbound", {
      form: params,
      headers: { "X-Twilio-Signature": sign(params) },
    });
    expect(real.status()).toBe(200);
    expect(await real.text()).toContain("unsubscribed");

    const { data } = await db!.from("accounts")
      .select("marketing_unsubscribed_at").eq("id", accountId).single();
    expect(data!.marketing_unsubscribed_at, "STOP must write the flag").not.toBeNull();
  });
});
