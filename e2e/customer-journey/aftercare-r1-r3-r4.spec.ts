import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "../fixtures/woLoop";
import { credentials, test } from "../helpers";
import { morningBeforeDue } from "../../lib/automations/dateOffset";
import { monthsAfter } from "../../lib/automations/sweeps/aftercare";

/**
 * After the job (17 Nov 2026). A job signed off yesterday gets R1's review
 * text with the brand's review link, and the job reads "review asked" (by
 * the automation). A job signed off a year ago today gets R3 on its chat.
 * Due from 9 am Melbourne; before then the spec checks nothing went. A second
 * sweep sends nothing new. The keys ship OFF and the review link is blank:
 * the spec sets both and puts the settings back.
 */
const db = serviceClient();
const contractor = credentials("CONTRACTOR");
const run = randomBytes(3).toString("hex");
const SECRET = process.env.CRON_SECRET ?? "";
const KEYS = ["review_request", "anniversary_12", "anniversary_24"];
const MEL = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
const today = () => MEL.format(new Date());
const yesterday = () => MEL.format(new Date(Date.parse(`${today()}T12:00:00Z`) - 86_400_000));
const freshMobile = () => `04${String(parseInt(randomBytes(4).toString("hex"), 16)).padStart(8, "0").slice(0, 8)}`;
const e164 = (m: string) => `+61${m.replace(/^0/, "")}`;
const REVIEW = `https://g.page/r/e2e-${run}`;

test.describe("After the job R1 + R3", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!SECRET, "set CRON_SECRET");
  test.skip(!contractor, "set E2E_CONTRACTOR_EMAIL / E2E_CONTRACTOR_PASSWORD");
  let saved: Record<string, unknown> | null = null;
  let touched = false;
  const jobs: { fx: LoopFixture; phone: string }[] = [];

  test.afterAll(async () => {
    if (!db) return;
    if (touched) {
      if (saved === null) await db.from("settings").delete().eq("key", "messaging");
      else await db.from("settings").upsert({ key: "messaging", value: saved }, { onConflict: "key" });
    }
    for (const j of jobs) {
      await db.from("automation_claims").delete().eq("entity_id", j.fx.workOrderId);
      await db.from("review_requests").delete().eq("work_order_id", j.fx.workOrderId);
      await db.from("warranties").delete().eq("work_order_id", j.fx.workOrderId);
      await db.from("estimate_messages").delete().eq("estimate_id", j.fx.estimateId);
      await db.from("messages").delete().eq("to_address", e164(j.phone));
      await db.from("messages").delete().eq("estimate_id", j.fx.estimateId);
      await destroyLoopFixture(db, j.fx);
    }
  });

  test("R1 the morning after sign-off; R3 a year on — once each", async ({ request }) => {
    test.setTimeout(180_000);
    const { data, error } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    if (error) throw new Error(error.message);
    saved = (data as { value: Record<string, unknown> } | null)?.value ?? null;
    const base = saved ?? {};
    const up = await db!.from("settings").upsert({ key: "messaging", value: {
      ...base, googleReviewLink: REVIEW,
      enabled: [...new Set([...((base.enabled as string[] | undefined) ?? []), ...KEYS])],
      disabled: ((base.disabled as string[] | undefined) ?? []).filter((k) => !KEYS.includes(k)),
    } }, { onConflict: "key" });
    if (up.error) throw new Error(up.error.message);
    touched = true;

    const contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    const seed = async (tag: string, signedOn: string) => {
      const fx = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls"] }]);
      const phone = freshMobile();
      jobs.push({ fx, phone });
      const e = await db!.from("estimates").update({
        title: `${tag} After Street`, share_token: `after${tag}${run}${randomBytes(12).toString("hex")}`,
        builder_state: { blocks: [], modSel: {}, materials: {}, contact: { name: `After${tag} Tester`, email: `after${tag}.${run}@aftercare.invalid`, phone } },
        sent_snapshot: { contactName: `After${tag} Tester`, jobAddress: `${tag} After Street, Fairfield VIC 3078` },
      }).eq("id", fx.estimateId);
      if (e.error) throw new Error(e.error.message);
      const w = await db!.from("warranties").insert({ work_order_id: fx.workOrderId, estimate_id: fx.estimateId, starts_on: signedOn, ends_on: monthsAfter(signedOn, 24), years: 2, signed_kind: "in_person" });
      if (w.error) throw new Error(w.error.message);
      return { fx, phone, signedOn };
    };
    const r = await seed("R", yesterday());
    const y = await seed("Y", monthsAfter(today(), -12));

    const sweep = () => request.get("/api/cron/campaign-sweep?only=aftercare", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 120_000 });
    const res = await sweep();
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { aftercare: { error?: string } }).aftercare.error).toBeUndefined();

    const now = new Date();
    const r1Due = morningBeforeDue(r.signedOn, -1, now);
    const r3Due = morningBeforeDue(today(), 0, now);
    const { data: sms } = await db!.from("messages").select("body").eq("to_address", e164(r.phone)).eq("channel", "sms").eq("direction", "out");
    const { data: asked } = await db!.from("review_requests").select("sent_via").eq("work_order_id", r.fx.workOrderId);
    if (r1Due) {
      expect(sms).toHaveLength(1);
      expect((sms![0] as { body: string }).body).toContain(`Hi AfterR, thanks for having us at R After Street. If you were happy with the work, a Google review would mean a lot: ${REVIEW}`);
      expect(asked).toEqual([{ sent_via: "automation" }]);
    } else {
      expect(sms ?? []).toHaveLength(0);
    }
    const { data: chat } = await db!.from("estimate_messages").select("body").eq("estimate_id", y.fx.estimateId);
    if (r3Due) {
      expect(chat).toHaveLength(1);
      expect((chat![0] as { body: string }).body).toContain("Hi AfterY, it's been a year since we painted Y After Street.");
    } else expect(chat ?? []).toHaveLength(0);

    expect((await sweep()).status()).toBe(200);
    expect((await db!.from("messages").select("id").eq("to_address", e164(r.phone)).eq("channel", "sms")).data ?? []).toHaveLength(r1Due ? 1 : 0);
    expect((await db!.from("estimate_messages").select("id").eq("estimate_id", y.fx.estimateId)).data ?? []).toHaveLength(r3Due ? 1 : 0);
  });
});
