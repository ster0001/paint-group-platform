import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { test } from "../helpers";

/**
 * E9–E12 (17 Nov 2026).
 *
 *   1 · E11: a customer who declined without a reason gets the four chips on
 *       their chat. As an anonymous customer they open "Timing", tap the one
 *       button, and the decline reads "Postponing". A second chip never
 *       overwrites it; an unknown token is a 404.
 *   2 · E10: a quote past its valid-until day gets "your quote has lapsed" on
 *       its chat. A second sweep sends nothing new.
 * The keys ship OFF: the spec switches them on and puts the settings back.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");
const SECRET = process.env.CRON_SECRET ?? "";
const KEYS = ["estimate_expiry_warning", "estimate_expired_chat", "estimate_declined_reason", "estimate_declined_timing"];
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ymdAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

test.describe("Estimate end E9–E12", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!SECRET, "set CRON_SECRET");
  let saved: Record<string, unknown> | null = null;
  let touched = false;
  const ests: string[] = [];

  test.beforeAll(async () => {
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
  });
  test.afterAll(async () => {
    if (!db) return;
    if (touched) {
      if (saved === null) await db.from("settings").delete().eq("key", "messaging");
      else await db.from("settings").upsert({ key: "messaging", value: saved }, { onConflict: "key" });
    }
    if (ests.length) {
      await db.from("automation_claims").delete().in("entity_id", ests);
      await db.from("automation_holds").delete().in("estimate_id", ests);
      await db.from("estimate_messages").delete().in("estimate_id", ests);
      await db.from("messages").delete().in("estimate_id", ests);
      await db.from("crm_events").delete().in("estimate_id", ests);
      await db.from("estimates").delete().in("id", ests);
    }
  });

  const seed = async (tag: string, over: Record<string, unknown>) => {
    const token = `eend${tag}${run}${randomBytes(12).toString("hex")}`;
    const r = await db!.from("estimates").insert({
      title: `${tag} End Street`, source: "manual", level_of_finish: 3, share_token: token, total_cents: 640_000,
      builder_state: { blocks: [], modSel: {}, materials: {}, contact: { name: `End${tag} Tester`, email: `end${tag}.${run}@estimate-end.invalid` } },
      sent_snapshot: { version: 1, contactName: `End${tag} Tester`, jobAddress: `${tag} End Street, Fairfield VIC 3078`, company: { name: "Paint Group" } },
      ...over,
    }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    ests.push(r.data.id as string);
    return { id: r.data.id as string, token };
  };
  const sweep = (request: import("@playwright/test").APIRequestContext) =>
    request.get("/api/cron/campaign-sweep?only=estimates", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 200_000 });

  test("1 · E11: the chips on the chat, one tap records the reason once", async ({ request, browser }) => {
    test.setTimeout(240_000);
    const d = await seed("D", { status: "declined", sent_at: ago(72), declined_at: ago(2), declined_reason: null });
    const res = await sweep(request);
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { estimates: { error?: string } }).estimates.error).toBeUndefined();
    const chat = await db!.from("estimate_messages").select("body").eq("estimate_id", d.id);
    if (chat.error) throw chat.error;
    expect(chat.data).toHaveLength(1);
    const body = (chat.data![0] as { body: string }).body;
    expect(body).toContain("Thanks for letting us know, EndD. So we can improve, which was it?");
    expect(body).toContain(`/e/${d.token}/reason?r=timing`);

    // The customer, on their own phone, with no session.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    expect((await page.goto(`/e/${"x".repeat(40)}/reason?r=timing`))?.status()).toBe(404);
    await page.goto(`/e/${d.token}/reason?r=timing`);
    await expect(page.getByTestId("decline-reason")).toContainText("timing");
    // Opening the page records nothing.
    expect(((await db!.from("estimates").select("declined_reason").eq("id", d.id).single()).data as { declined_reason: string | null }).declined_reason).toBeNull();
    await page.getByTestId("reason-confirm").click();
    await expect(page.getByTestId("reason-done")).toBeVisible({ timeout: 20_000 });
    expect(((await db!.from("estimates").select("declined_reason").eq("id", d.id).single()).data as { declined_reason: string | null }).declined_reason).toBe("Postponing");
    // A second chip never overwrites it.
    await page.goto(`/e/${d.token}/reason?r=price`);
    await page.getByTestId("reason-confirm").click();
    await expect(page.getByTestId("reason-done")).toBeVisible({ timeout: 20_000 });
    expect(((await db!.from("estimates").select("declined_reason").eq("id", d.id).single()).data as { declined_reason: string | null }).declined_reason).toBe("Postponing");
    await ctx.close();
  });

  test("2 · E10: a lapsed quote gets the refresh offer on its chat, once", async ({ request }) => {
    test.setTimeout(240_000);
    const x = await seed("X", { status: "sent", sent_at: ago(24 * 30), valid_until: ymdAgo(2) });
    expect((await sweep(request)).status()).toBe(200);
    const chat = await db!.from("estimate_messages").select("body").eq("estimate_id", x.id);
    if (chat.error) throw chat.error;
    expect(chat.data).toHaveLength(1);
    expect((chat.data![0] as { body: string }).body).toContain("Hi EndX, your quote for X End Street has lapsed.");
    expect((await sweep(request)).status()).toBe(200);
    expect((await db!.from("estimate_messages").select("id").eq("estimate_id", x.id)).data).toHaveLength(1);
  });
});
