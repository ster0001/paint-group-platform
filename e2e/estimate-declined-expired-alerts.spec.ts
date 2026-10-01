import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 1 Oct 2026: "staff to receive email if an offered estimate is rejected
 * / expires". Two office alerts, proven by their once-only guard rows in
 * staff_notifications (who they reach depends on Staff logins routing — the
 * claim is the proof the path fired, the same assertion the chat alert uses).
 *
 *   1. An ANONYMOUS customer declines on /e/<token> → office_estimate_declined.
 *   2. A sent estimate past valid_until is lapsed by the CRM sweep (the cron
 *      route, with its secret) → office_estimate_expired.
 */
const db = serviceClient();
const run = randomBytes(3).toString("hex");

const SNAPSHOT = {
  version: 1,
  company: { name: "Paint Group Pty Ltd", addressLine1: "1 Example St", addressLine2: "Melbourne VIC", phone: "(03) 9000 0000", abn: "11 222 333 444", email: "hello@example.com", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: "Casey Decliner", contactEmail: "", jobTitle: "Interior repaint", jobAddress: "7 Refusal Road, Fairfield VIC 3078",
  gstRatePct: 10, depositPct: 10,
  lineItems: [], options: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 200000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 200000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
  paints: [],
};

async function sentEstimate(title: string, token: string, validUntil: string | null) {
  const r = await db!.from("estimates").insert({
    title, status: "sent", source: "manual", level_of_finish: 3, share_token: token,
    sent_at: new Date().toISOString(), total_cents: 220000, valid_until: validUntil,
    builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
    sent_snapshot: { ...SNAPSHOT, estRef: `EST-D${run}` },
  }).select("id").single();
  if (r.error) throw new Error(r.error.message);
  return r.data.id as string;
}

async function claims(key: string, estimateId: string) {
  const g = await db!.from("staff_notifications").select("id").eq("event_key", key).eq("entity_id", estimateId);
  if (g.error) throw new Error(g.error.message);
  return (g.data ?? []).length;
}

test.describe("Office alerts: estimate declined, estimate expired", () => {
  test.skip(!db, "needs the service key");
  const ids: string[] = [];

  test.afterAll(async () => {
    if (!ids.length) return;
    await db!.from("staff_notifications").delete().in("event_key", ["office_estimate_declined", "office_estimate_expired"]).in("entity_id", ids);
    await db!.from("estimate_events").delete().in("estimate_id", ids);
    await db!.from("estimates").delete().in("id", ids);
  });

  test("an anonymous customer declines → the 'Estimate declined' alert claims its guard for THAT estimate", async ({ page }) => {
    const token = `decl${run}${randomBytes(10).toString("hex")}`;
    const id = await sentEstimate(`Decline alert ${run}`, token, null);
    ids.push(id);

    await page.goto(`/e/${token}`);
    await expect(page.locator("details.room").first()).toBeVisible();
    await page.getByRole("button", { name: "Politely decline" }).click();
    await page.getByRole("button", { name: "Went with another quote", exact: true }).click();
    await page.getByLabel("Anything else (optional)").fill(`Cheaper quote ${run}`);
    await page.getByRole("button", { name: "Decline estimate" }).click();
    await expect(page.getByText("You’ve declined this estimate.")).toBeVisible();

    const { data: est } = await db!.from("estimates").select("status, declined_reason").eq("id", id).single();
    expect(est).toMatchObject({ status: "declined", declined_reason: `Went with another quote — Cheaper quote ${run}` });
    await expect.poll(() => claims("office_estimate_declined", id), { timeout: 15_000 }).toBe(1);
    // And no stray claim on the expiry event.
    expect(await claims("office_estimate_expired", id)).toBe(0);
  });

  test("the CRM sweep lapses a sent estimate past valid_until → the 'Estimate expired' alert claims its guard", async ({ request }) => {
    const secret = process.env.CRON_SECRET;
    test.skip(!secret, "CRON_SECRET not in the e2e env — the sweep route cannot be called");
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const id = await sentEstimate(`Expiry alert ${run}`, `expr${run}${randomBytes(10).toString("hex")}`, yesterday);
    ids.push(id);

    const r = await request.get("/api/cron/crm-sweep", { headers: { authorization: `Bearer ${secret}` } });
    expect(r.ok(), await r.text()).toBe(true);

    const { data: est } = await db!.from("estimates").select("status").eq("id", id).single();
    expect(est?.status).toBe("expired");
    await expect.poll(() => claims("office_estimate_expired", id), { timeout: 15_000 }).toBe(1);
    expect(await claims("office_estimate_declined", id)).toBe(0);

    // A second sweep does not tell anyone twice.
    const r2 = await request.get("/api/cron/crm-sweep", { headers: { authorization: `Bearer ${secret}` } });
    expect(r2.ok()).toBe(true);
    expect(await claims("office_estimate_expired", id)).toBe(1);
  });
});
