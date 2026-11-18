import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, signIn, test } from "../helpers";

/**
 * A‑B (17 Nov 2026): staff write Paint Home's own wording for a message at
 * Campaigns › Automations (A‑C); a Paint Home lead then gets that text, a Paint Group
 * lead the Paint Group one. Clearing the box puts Paint Home back on the
 * Paint Group wording. L1 ships off: the spec switches it on and puts the
 * settings back.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const SECRET = process.env.CRON_SECRET ?? "";
const FIELD = "leadRangeReminderSms";
const hours = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const freshMobile = () => `04${String(parseInt(randomBytes(4).toString("hex"), 16)).padStart(8, "0").slice(0, 8)}`;

test.describe("Paint Home wording (A‑B)", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!staff, "set E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD");
  test.skip(!SECRET, "set CRON_SECRET");
  let saved: Record<string, unknown> | null = null;
  let touched = false;
  let hadRow: { body: string } | null = null;
  const leads: { estId: string; draftId: string }[] = [];

  test.afterAll(async () => {
    if (!db) return;
    if (touched) {
      if (saved === null) await db.from("settings").delete().eq("key", "messaging");
      else await db.from("settings").upsert({ key: "messaging", value: saved }, { onConflict: "key" });
    }
    if (hadRow) await db.from("automation_brand_wording").upsert({ brand: "painthome", field: FIELD, body: hadRow.body }, { onConflict: "brand,field" });
    else await db.from("automation_brand_wording").delete().eq("brand", "painthome").eq("field", FIELD);
    for (const l of leads) {
      await db.from("automation_claims").delete().eq("entity_id", l.estId);
      await db.from("automation_holds").delete().eq("estimate_id", l.estId);
      await db.from("messages").delete().eq("estimate_id", l.estId);
      await db.from("crm_events").delete().eq("estimate_id", l.estId);
      await db.from("wizard_drafts").delete().eq("id", l.draftId);
      await db.from("estimates").delete().eq("id", l.estId);
    }
  });

  test("Paint Home's own text on the screen reaches a Paint Home lead; Paint Group keeps its own", async ({ page, request }) => {
    test.setTimeout(240_000);
    const prev = await db!.from("automation_brand_wording").select("body").eq("brand", "painthome").eq("field", FIELD).maybeSingle();
    if (prev.error) throw new Error(prev.error.message);
    hadRow = prev.data as { body: string } | null;

    await signIn(page, staff!, /\/(home|estimates|dashboard|crm|pc)/);
    await page.goto("/crm/campaigns/automations");
    const row = page.getByTestId("automation-lead_range_reminder");
    await expect(row).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("edit-lead_range_reminder").click();
    await page.getByTestId("brand-tab-painthome-lead_range_reminder").click();
    const text = `Hi {{first_name}}, Paint Home here ${run} — your range: {{link}}`;
    await page.getByTestId(`ph-tpl-${FIELD}`).fill(text);
    await expect(page.getByTestId(`ph-preview-${FIELD}`)).toContainText(`Paint Home here ${run}`);
    await page.getByTestId("ph-save-lead_range_reminder").click();
    await expect(page.getByTestId("ph-said-lead_range_reminder")).toContainText("saved", { timeout: 20_000 });
    const stored = await db!.from("automation_brand_wording").select("body").eq("brand", "painthome").eq("field", FIELD).single();
    expect((stored.data as { body: string }).body).toBe(text);

    // L1 on, two leads at 2 h: one Paint Home, one Paint Group.
    const { data, error } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    if (error) throw new Error(error.message);
    saved = (data as { value: Record<string, unknown> } | null)?.value ?? null;
    const base = saved ?? {};
    const up = await db!.from("settings").upsert({ key: "messaging", value: {
      ...base, enabled: [...new Set([...((base.enabled as string[] | undefined) ?? []), "lead_range_reminder"])],
      disabled: ((base.disabled as string[] | undefined) ?? []).filter((k) => k !== "lead_range_reminder"),
    } }, { onConflict: "key" });
    if (up.error) throw new Error(up.error.message);
    touched = true;
    const seed = async (tag: string, brand: string) => {
      const phone = freshMobile();
      const snap = { version: 1, kind: "lead", rangeLoCents: 600_000, rangeHiCents: 700_000, parts: null, jobType: "interior", firstName: `Brand${tag}`, address: `${tag} Brand Street, Fairfield VIC 3078`, biggerJob: false, pricedAt: hours(2.2) };
      const est = await db!.from("estimates").insert({
        title: `${tag} Brand Street`, status: "draft", source: "customer_intake", level_of_finish: 3, brand, share_token: `brandab${tag}${run}${randomBytes(12).toString("hex")}`, lead_snapshot: snap,
        builder_state: { blocks: [], modSel: {}, materials: {}, contact: { name: `Brand${tag} Tester`, email: `brand${tag}.${run}@brand-wording.invalid`, phone } },
      }).select("id").single();
      if (est.error) throw new Error(est.error.message);
      const d = await db!.from("wizard_drafts").insert({ estimate_id: est.data.id, suburb: `E2E Brand ${run}`, job_type: "interior", mode: "home", name: `Brand${tag} Tester`,
        started_at: hours(2.5), last_seen_at: hours(2.2), gate_completed_at: hours(2.2), range_shown_at: hours(2.2) }).select("id").single();
      if (d.error) throw new Error(d.error.message);
      leads.push({ estId: est.data.id as string, draftId: d.data.id as string });
      return est.data.id as string;
    };
    const ph = await seed("H", "painthome");
    const pg = await seed("G", "paintgroup");
    const res = await request.get("/api/cron/campaign-sweep?only=leads", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 200_000 });
    expect(res.status()).toBe(200);
    const textOf = async (id: string) => {
      const { data: sms } = await db!.from("messages").select("body").eq("estimate_id", id).eq("channel", "sms").eq("direction", "out");
      const { data: held } = await db!.from("automation_holds").select("sms_body").eq("estimate_id", id).eq("automation_key", "lead_range_reminder");
      return [...(sms ?? []).map((m) => m.body as string), ...(held ?? []).map((h) => h.sms_body as string)];
    };
    const phText = await textOf(ph);
    expect(phText).toHaveLength(1);
    expect(phText[0]).toContain(`Hi BrandH, Paint Home here ${run}`);
    const pgText = await textOf(pg);
    expect(pgText).toHaveLength(1);
    expect(pgText[0]).not.toContain("Paint Home here");

    // Clearing the box removes the row: Paint Home is back on the Paint Group wording.
    await page.getByTestId(`ph-tpl-${FIELD}`).fill("");
    await page.getByTestId("ph-save-lead_range_reminder").click();
    // The status still reads "saved" from the first save, so wait on the row itself.
    await expect.poll(async () => {
      const gone = await db!.from("automation_brand_wording").select("body").eq("brand", "painthome").eq("field", FIELD).maybeSingle();
      if (gone.error) throw new Error(gone.error.message);
      return gone.data;
    }, { timeout: 20_000, message: "clearing the box removes the Paint Home row" }).toBeNull();
  });
});
