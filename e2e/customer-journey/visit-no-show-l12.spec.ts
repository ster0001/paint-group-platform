import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, signIn, test } from "../helpers";

/**
 * Lead L12 (17 Nov 2026): staff mark a visit No show on the customer's
 * record, and the customer is texted once — "we missed each other at …
 * today. Rebook here: <their range page>" — or the text is held for quiet
 * hours. The key ships OFF: the spec switches it on and puts settings back.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const freshMobile = () => `04${String(parseInt(randomBytes(4).toString("hex"), 16)).padStart(8, "0").slice(0, 8)}`;
const KEY = "visit_no_show";

test.describe("Visit no-show text (L12)", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!staff, "set E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD");
  let saved: Record<string, unknown> | null = null;
  let touched = false;
  const made: { accountId?: string; estId?: string; visitId?: string } = {};

  test.afterAll(async () => {
    if (!db) return;
    if (touched) {
      if (saved === null) await db.from("settings").delete().eq("key", "messaging");
      else await db.from("settings").upsert({ key: "messaging", value: saved }, { onConflict: "key" });
    }
    if (made.visitId) { await db.from("automation_claims").delete().eq("entity_id", made.visitId); }
    if (made.estId) {
      await db.from("automation_holds").delete().eq("estimate_id", made.estId);
      await db.from("messages").delete().eq("estimate_id", made.estId);
      await db.from("crm_events").delete().eq("estimate_id", made.estId);
    }
    if (made.visitId) await db.from("visits").delete().eq("id", made.visitId);
    if (made.estId) await db.from("estimates").delete().eq("id", made.estId);
    if (made.accountId) { await db.from("crm_events").delete().eq("account_id", made.accountId); await db.from("accounts").delete().eq("id", made.accountId); }
  });

  test("No show on the record texts the customer the rebook link, once", async ({ page }) => {
    test.setTimeout(180_000);
    const { data, error } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    if (error) throw new Error(error.message);
    saved = (data as { value: Record<string, unknown> } | null)?.value ?? null;
    const base = saved ?? {};
    const up = await db!.from("settings").upsert({ key: "messaging", value: {
      ...base, enabled: [...new Set([...((base.enabled as string[] | undefined) ?? []), KEY])],
      disabled: ((base.disabled as string[] | undefined) ?? []).filter((k) => k !== KEY),
    } }, { onConflict: "key" });
    if (up.error) throw new Error(up.error.message);
    touched = true;

    const phone = freshMobile();
    const acc = await db!.from("accounts").insert({ email: `noshow.${run}@visit-no-show.invalid`, name: `NoShow${run} Tester`, phone }).select("id").single();
    if (acc.error) throw new Error(acc.error.message);
    made.accountId = acc.data.id as string;
    const token = `noshow${run}${randomBytes(12).toString("hex")}`;
    const est = await db!.from("estimates").insert({
      title: "7 Show Street", status: "draft", source: "customer_intake", level_of_finish: 3, share_token: token, account_id: made.accountId,
      builder_state: { blocks: [], modSel: {}, materials: {}, contact: { name: `NoShow${run} Tester`, phone } },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    made.estId = est.data.id as string;
    const start = new Date(Date.now() + 3 * 3_600_000);
    const visit = await db!.from("visits").insert({
      account_id: made.accountId, estimate_id: made.estId, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
      kind: "quote", status: "booked", source: "staff", customer_name: `NoShow${run} Tester`, customer_phone: phone, address: "7 Show Street, Fairfield VIC 3078",
    }).select("id").single();
    if (visit.error) throw new Error(visit.error.message);
    made.visitId = visit.data.id as string;

    await signIn(page, staff!, /\/(dashboard|crm|estimates|pc)/);
    await page.goto(`/crm/customers/${made.accountId}`);
    const card = page.getByTestId(`record-visit-${made.visitId}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole("button", { name: "No show" }).click();
    await expect(page.getByText("No show recorded")).toBeVisible({ timeout: 30_000 });

    // Sent now, or held for quiet hours — exactly one, with the line and the link.
    const { data: sms, error: e1 } = await db!.from("messages").select("body").eq("estimate_id", made.estId).eq("channel", "sms").eq("direction", "out");
    const { data: held, error: e2 } = await db!.from("automation_holds").select("sms_body").eq("estimate_id", made.estId).eq("automation_key", KEY);
    if (e1 || e2) throw new Error((e1 ?? e2)!.message);
    const bodies = [...(sms ?? []).map((m) => m.body as string), ...(held ?? []).map((h) => h.sms_body as string)];
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(`Hi NoShow${run}, we missed each other at 7 Show Street today. Rebook here:`);
    expect(bodies[0]).toContain(`/e/${token}`);
    const { count } = await db!.from("automation_claims").select("entity_id", { count: "exact", head: true }).eq("automation_key", KEY).eq("entity_id", made.visitId);
    expect(count).toBe(1);
  });
});
