import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { credentials, missingCreds } from "./helpers";
import { notifyOfficeOfAcceptance } from "../lib/estimate/acceptedNotify";

/**
 * Tom, 4 Sep 2026: "send an email to info@paintgroup.com.au when an estimate
 * is approved." The notifier runs server-side after every acceptance path;
 * this pins it against the test stack: once per estimate, honours the
 * Automations switch, and records what it did on estimate_events.
 */
const db: SupabaseClient | null = serviceClient();
const contractor = credentials("CONTRACTOR");

let fixture: LoopFixture | null = null;
let messagingBefore: unknown = null;

test.describe("estimate accepted → the office is told", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!contractor, missingCreds("CONTRACTOR"));

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    if (!contractorId) throw new Error(`no contractors row for ${contractor!.email}`);
    fixture = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    await db!.from("estimates").update({ accepted_name: "Office Test", accepted_at: new Date().toISOString(), accepted_total_cents: 123_400, title: "Office accept fixture" }).eq("id", fixture.estimateId);
    const { data: m } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    messagingBefore = m?.value ?? null;
  });
  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
    if (messagingBefore) await db!.from("settings").upsert({ key: "messaging", value: messagingBefore }, { onConflict: "key" });
    else await db!.from("settings").delete().eq("key", "messaging");
  });

  test("sends once, records it, and a second call is a no-op", async () => {
    expect(await notifyOfficeOfAcceptance(db!, fixture!.estimateId)).toBe("sent");
    const { data: ev } = await db!.from("estimate_events").select("type, payload").eq("estimate_id", fixture!.estimateId).eq("type", "office_accept_notified");
    expect(ev).toHaveLength(1);
    const payload = (ev![0] as { payload: { to: string; outcome: string } }).payload;
    expect(payload.to).toBe("info@paintgroup.com.au");
    expect(["sent", "not_configured"]).toContain(payload.outcome);
    expect(await notifyOfficeOfAcceptance(db!, fixture!.estimateId)).toBe("already");
  });

  test("switched off on Settings → Automations, nothing goes out", async () => {
    await db!.from("estimate_events").delete().eq("estimate_id", fixture!.estimateId).eq("type", "office_accept_notified");
    const cur = ((messagingBefore as Record<string, unknown> | null) ?? {});
    await db!.from("settings").upsert({ key: "messaging", value: { ...cur, disabled: ["office_estimate_accepted"] } }, { onConflict: "key" });
    expect(await notifyOfficeOfAcceptance(db!, fixture!.estimateId)).toBe("skipped");
    const { data: ev } = await db!.from("estimate_events").select("id").eq("estimate_id", fixture!.estimateId).eq("type", "office_accept_notified");
    expect(ev).toHaveLength(0);
  });

  test("an estimate that is not accepted is left alone", async () => {
    await db!.from("estimates").update({ status: "draft" }).eq("id", fixture!.estimateId);
    expect(await notifyOfficeOfAcceptance(db!, fixture!.estimateId)).toBe("not_accepted");
  });
});
