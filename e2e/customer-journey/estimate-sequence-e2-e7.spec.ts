import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { test } from "../helpers";

/**
 * E2–E7 (17 Nov 2026): a sent quote nobody opened gets E2's text at 2 days;
 * one opened 2 days ago and quiet gets E4 on its own chat (with the email).
 * A second sweep sends nothing new. The keys ship OFF: the spec switches them
 * on and puts the settings back.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");
const SECRET = process.env.CRON_SECRET ?? "";
const KEYS = ["estimate_unopened", "estimate_unopened_again", "estimate_viewed_any_q", "estimate_viewed_worth", "estimate_viewed_held"];
const days = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const freshMobile = () => `04${String(parseInt(randomBytes(4).toString("hex"), 16)).padStart(8, "0").slice(0, 8)}`;

test.describe("Estimate sequence E2–E7", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!SECRET, "set CRON_SECRET");
  let saved: Record<string, unknown> | null = null;
  let touched = false;
  const ests: string[] = [];

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

  test("E2 texts the unopened quote at 2 days; E4 writes on the opened one's chat", async ({ request }) => {
    test.setTimeout(240_000);
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

    const seed = async (tag: string, sentDaysAgo: number) => {
      const token = `eseq${tag}${run}${randomBytes(12).toString("hex")}`;
      const phone = freshMobile();
      const r = await db!.from("estimates").insert({
        title: `${tag} Quote Street`, status: "sent", source: "manual", level_of_finish: 3, share_token: token,
        sent_at: days(sentDaysAgo), total_cents: 640_000, valid_until: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
        builder_state: { blocks: [], modSel: {}, materials: {}, contact: { name: `Quote${tag} Tester`, email: `quote${tag}.${run}@estimate-sequence.invalid`, phone } },
        sent_snapshot: { contactName: `Quote${tag} Tester`, jobAddress: `${tag} Quote Street, Fairfield VIC 3078` },
      }).select("id").single();
      if (r.error) throw new Error(r.error.message);
      ests.push(r.data.id as string);
      return { id: r.data.id as string, token, phone };
    };
    const a = await seed("A", 2.1);       // sent 2.1 days ago, never opened → E2
    const b = await seed("B", 4);         // sent 4 days ago, opened 2.1 days ago → E4
    const ev = await db!.from("crm_events").insert({ estimate_id: b.id, type: "estimate_viewed", source: "customer", payload: {}, occurred_at: days(2.1), dedupe_key: `e2e-eseq-b-${run}` });
    if (ev.error) throw ev.error;

    const sweep = () => request.get("/api/cron/campaign-sweep?only=estimates", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 200_000 });
    const res = await sweep();
    expect(res.status()).toBe(200);
    const body = await res.json() as { estimates: { error?: string } };
    expect(body.estimates.error).toBeUndefined();

    const textFor = async (id: string) => {
      const { data: sms, error: e1 } = await db!.from("messages").select("body").eq("estimate_id", id).eq("channel", "sms").eq("direction", "out");
      const { data: held, error: e2 } = await db!.from("automation_holds").select("sms_body").eq("estimate_id", id).eq("automation_key", "estimate_unopened");
      if (e1 || e2) throw new Error((e1 ?? e2)!.message);
      return [...(sms ?? []).map((m) => m.body as string), ...(held ?? []).map((h) => h.sms_body as string)];
    };
    const e2 = await textFor(a.id);
    expect(e2).toHaveLength(1);
    expect(e2[0]).toContain("Hi QuoteA, your quote for A Quote Street is ready:");
    expect(e2[0]).toContain(`/e/${a.token}`);

    const chat = await db!.from("estimate_messages").select("body, direction").eq("estimate_id", b.id);
    if (chat.error) throw chat.error;
    expect(chat.data).toHaveLength(1);
    expect((chat.data![0] as { body: string }).body).toContain("Hi QuoteB, I saw you've had a look at the quote for B Quote Street.");
    expect(await textFor(b.id)).toHaveLength(0);

    // Claimed: a second sweep sends nothing new.
    expect((await sweep()).status()).toBe(200);
    expect(await textFor(a.id)).toHaveLength(1);
    const again = await db!.from("estimate_messages").select("id").eq("estimate_id", b.id);
    expect(again.data).toHaveLength(1);
  });
});
