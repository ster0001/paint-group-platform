import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The send layer adds the opt-out to every MARKETING send (26 Nov 2026), driven
 * through the real sendSms / sendEmail with Twilio and Resend answered here.
 * The database is a small fake: one account, which may have opted out.
 */
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
let account: Record<string, unknown> = {};
let findAccount: string | null = ACCOUNT;

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: account, error: null }) };
      return q;
    },
    rpc: async () => ({ data: findAccount, error: null }),
  }),
}));
vi.mock("./record", async (orig) => ({ ...(await orig<typeof import("./record")>()), recordMessage: vi.fn(async () => null) }));

const calls: { url: string; body: string }[] = [];
beforeEach(() => {
  account = { notify_prefs: null, permit_email: null, permit_sms: null, marketing_unsubscribed_at: null };
  findAccount = ACCOUNT;
  calls.length = 0;
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test"); vi.stubEnv("TWILIO_AUTH_TOKEN", "t"); vi.stubEnv("TWILIO_FROM", "+61400000000");
  vi.stubEnv("RESEND_API_KEY", "re_test"); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://paintgroup.com.au");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    calls.push({ url, body: init.body });
    return new Response(JSON.stringify({ sid: "SM1", id: "em1" }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("marketing sends carry their own way out", () => {
  it("a marketing text ends 'Reply STOP to opt out'; a job text does not", async () => {
    const { sendSms } = await import("./send");
    await sendSms({ to: "+61412345678", body: "Your range is saved: https://x.au/r", ctx: { automation: "lead_range_reminder", marketing: true, accountId: ACCOUNT } });
    await sendSms({ to: "+61412345678", body: "Your visit is booked for Tuesday.", ctx: { automation: "visit_booked", accountId: ACCOUNT } });
    expect(calls).toHaveLength(2);
    expect(new URLSearchParams(calls[0].body).get("Body")).toBe("Your range is saved: https://x.au/r. Reply STOP to opt out");
    expect(new URLSearchParams(calls[1].body).get("Body")).toBe("Your visit is booked for Tuesday.");
  });

  it("a marketing email carries the account's unsubscribe link and the one-click headers", async () => {
    const { sendEmail } = await import("./send");
    const r = await sendEmail({ to: "jo@example.com", subject: "Your quote", html: "<html><body><p>Hi Jo</p></body></html>", ctx: { automation: "estimate_unopened_again", marketing: true, accountId: ACCOUNT } });
    expect(r.status).toBe("sent");
    const sent = JSON.parse(calls[0].body) as { html: string; headers?: Record<string, string> };
    expect(sent.html).toMatch(new RegExp(`Unsubscribe</a>.*</body>`));
    expect(sent.html).toContain(`https://paintgroup.com.au/u/${ACCOUNT}.`);
    expect(sent.headers?.["List-Unsubscribe"]).toMatch(new RegExp(`^<https://paintgroup\\.com\\.au/u/${ACCOUNT}\\.`));
    expect(sent.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("a job email gets neither", async () => {
    const { sendEmail } = await import("./send");
    await sendEmail({ to: "jo@example.com", subject: "Invoice", html: "<p>Invoice</p>", ctx: { automation: "invoice_issued", accountId: ACCOUNT } });
    const sent = JSON.parse(calls[0].body) as { html: string; headers?: unknown };
    expect(sent.html).toBe("<p>Invoice</p>");
    expect(sent.headers).toBeUndefined();
  });

  it("a marketing email with no account to unsubscribe does not go", async () => {
    findAccount = null;
    const { sendEmail } = await import("./send");
    const r = await sendEmail({ to: "nobody@example.com", subject: "Hi", html: "<p>Hi</p>", ctx: { automation: "cold_nurture", marketing: true } });
    expect(r.status).toBe("suppressed");
    expect(calls).toHaveLength(0);
  });

  it("someone who said STOP still gets nothing", async () => {
    account = { ...account, marketing_unsubscribed_at: "2026-11-01T00:00:00Z" };
    const { sendSms } = await import("./send");
    const r = await sendSms({ to: "+61412345678", body: "A job like yours", ctx: { automation: "lead_range_last", marketing: true, accountId: ACCOUNT } });
    expect(r.status).toBe("suppressed");
    expect(calls).toHaveLength(0);
  });
});
