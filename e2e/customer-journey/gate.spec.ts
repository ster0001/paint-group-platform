import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../fixtures/woLoop";
import { driveNoPlanWizard, openQuickLook, quickNext } from "./drive";
import { userIdFor } from "../helpers";
import { loginStaff, RUN, staffEmail } from "./visitHelpers";

/**
 * Visit booking addendum A · S6 — the gate, as an ANONYMOUS customer.
 *
 *   · details first (R5): the last question is the gate, with the mockup's
 *     wording; the range follows; the session records version, gate shown,
 *     gate completed, range shown; the account exists; the range screen shows
 *     the R24 options in order with "Tighten my price" as the hero and no
 *     "Keep this estimate"; the chosen option is recorded
 *   · at the API: the range cannot be fetched without a completed gate (409),
 *     and the two-estimates limit per email still holds (429 on the third)
 *   · range first (R6/R7): the range shows with no details, and Tighten asks
 *     for them before going further; the session says range_first
 *   · a session keeps its version after the switch is changed
 *   · the dashboard's gate report counts these sessions per version
 *
 * The rule is put back to what it was in afterAll.
 */
const db: SupabaseClient | null = serviceClient();

test.describe("S6 — the gate", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staffEmail, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_EMAIL");
  let rulesBefore: Record<string, unknown> = {};
  let limitsBefore: Record<string, unknown> | null = null;
  const emails: string[] = [];
  const setOrder = async (gateOrder: "details_first" | "range_first") => {
    await db!.from("settings").upsert({ key: "visit_booking_rules", value: { ...rulesBefore, gateOrder } }, { onConflict: "key" });
  };

  test.beforeAll(async () => {
    const { data } = await db!.from("settings").select("value").eq("key", "visit_booking_rules").maybeSingle();
    rulesBefore = (data?.value ?? {}) as Record<string, unknown>;
    const { data: lim } = await db!.from("settings").select("value").eq("key", "wizard_limits").maybeSingle();
    limitsBefore = (lim?.value as Record<string, unknown> | undefined) ?? null;
  });
  test.afterAll(async () => {
    await db!.from("settings").upsert({ key: "visit_booking_rules", value: rulesBefore }, { onConflict: "key" });
    if (limitsBefore) await db!.from("settings").upsert({ key: "wizard_limits", value: limitsBefore }, { onConflict: "key" });
    else await db!.from("settings").delete().eq("key", "wizard_limits");
    for (const email of emails) {
      const { data: acc } = await db!.from("accounts").select("id").eq("email", email).maybeSingle();
      if (acc) {
        await db!.from("estimates").update({ account_id: null, property_id: null }).eq("account_id", acc.id);
        await db!.from("properties").delete().eq("account_id", acc.id);
        await db!.from("accounts").delete().eq("id", acc.id);
      }
    }
  });

  test("details first: the gate is the last question, then the range; the session and the account record it", async ({ page }) => {
    await setOrder("details_first");
    const email = `gate.df.${RUN}@example.com`;
    emails.push(email);
    await driveNoPlanWizard(page, { stopAtGate: true, suburb: `Gatedf${RUN}` });
    const gate = page.locator("[data-quick-step='gate']");
    await expect(gate).toBeVisible();
    await expect(gate.getByText("Last question")).toBeVisible();
    await expect(gate.getByRole("heading", { name: "Where shall we send your estimate?" })).toBeVisible();
    await expect(gate.getByText("Enter your details to see your guide price. We will save your estimate so you can come back to it.")).toBeVisible();
    await expect(gate.getByTestId("gate-marketing").locator("input")).not.toBeChecked();
    const go = gate.getByRole("button", { name: "Show my guide price" });
    await expect(go).toBeVisible();
    // Nothing without the details.
    await go.click();
    await expect(page.locator(".wz-err")).toContainText("Please fill in your name, email and mobile number.");
    await page.getByTestId("gate-name").fill("Gate Tester");
    await page.getByTestId("gate-email").fill(email);
    await page.getByTestId("gate-mobile").fill("0400 123 456");
    await go.click();
    await expect(page.getByTestId("reveal")).toBeVisible({ timeout: 90_000 });

    // R24: the options, in order; Tighten is the hero; no "Keep this estimate".
    const doors = page.locator(".wz-doors [data-testid^='door-']");
    const ids = await doors.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(ids[0]).toBe("door-tighten");
    expect(ids).toEqual(ids.filter((i) => i !== "door-keep"));
    expect(ids.indexOf("door-book")).toBeGreaterThan(ids.indexOf("door-tighten"));
    expect(ids.indexOf("door-message")).toBeGreaterThan(ids.indexOf("door-book"));
    if (ids.includes("door-speak")) expect(ids.indexOf("door-speak")).toBe(1);
    await expect(page.getByTestId("door-tighten")).toHaveAttribute("data-hero", "1");
    await expect(page.getByTestId("door-tighten")).toContainText("Tighten my price");
    await expect(page.getByTestId("door-tighten")).toContainText("Get a more accurate quote now");
    expect(await page.locator("body").innerText()).not.toContain("Request a quote");

    const { data: draft } = await db!.from("wizard_drafts").select("gate_version, gate_shown_at, gate_completed_at, range_shown_at, range_option, email, estimate_id").ilike("suburb", `Gatedf${RUN}`).order("started_at", { ascending: false }).limit(1).single();
    expect(draft?.gate_version).toBe("details_first");
    expect(draft?.gate_shown_at).not.toBeNull();
    expect(draft?.gate_completed_at).not.toBeNull();
    expect(draft?.range_shown_at).not.toBeNull();
    expect(draft?.range_option).toBeNull();
    const { data: acc } = await db!.from("accounts").select("id, name").eq("email", email).maybeSingle();
    expect(acc?.name).toBe("Gate Tester");

    // The chosen option is recorded.
    await page.getByTestId("door-tighten").click();
    await page.waitForURL((u) => u.pathname === "/estimate/scope");
    await expect.poll(async () => (await db!.from("wizard_drafts").select("range_option").ilike("suburb", `Gatedf${RUN}`).order("started_at", { ascending: false }).limit(1).single()).data?.range_option, { timeout: 10_000 }).toBe("tighten");
  });

  test("at the API: no range without a completed gate (details first), and the two-estimates limit still holds", async ({ page }) => {
    await setOrder("details_first");
    const email = `gate.api.${RUN}@example.com`;
    emails.push(email);
    await driveNoPlanWizard(page, { stopAtGate: true, suburb: `Gateapi${RUN}` });
    // The body the BROWSER posts (the derived state), captured as the gate is answered, then replayed.
    await page.getByTestId("gate-name").fill("Api Tester");
    await page.getByTestId("gate-email").fill(email);
    await page.getByTestId("gate-mobile").fill("0400 222 333");
    const submitReq = page.waitForRequest((r) => r.url().includes("/api/wizard/submit") && r.method() === "POST");
    await page.locator("[data-quick-step='gate']").getByRole("button", { name: "Show my guide price" }).click();
    const posted = (await submitReq).postDataJSON() as { state: Record<string, unknown> & { contact: { name: string; email: string; phone: string } } };
    await expect(page.getByTestId("reveal")).toBeVisible({ timeout: 90_000 }); // estimate 1 for this email
    // The test project raises the visitor cap for the volume runs; the replays need the real default
    // (2 per 24 h). Lowered only NOW: the cap counts by email OR by IP, and in a full run every earlier
    // spec came from this IP, so lowering it before the walk refused estimate 1 itself ("Looks like
    // you're busy"). The gate check runs before the cap in the route, so the 409 below is unaffected.
    await db!.from("settings").upsert({ key: "wizard_limits", value: { ...(limitsBefore ?? {}), maxEstimatesPerVisitor: 2 } }, { onConflict: "key" });
    const state = posted.state;
    const noContact = { ...state, contact: { name: "", email: "", phone: "" } };
    const refused = await page.request.post("/api/wizard/submit", { data: { state: noContact } });
    expect(refused.status(), await refused.text()).toBe(409);
    expect((await refused.json()).code).toBe("gate_required");
    const withContact = { ...state, contact: { name: "Api Tester", email, phone: "0400 222 333" } };
    // The cap (2 per 24 h) counts by email OR by IP, and every test in this run comes from one IP —
    // so the refusal may come on the first replay or the second. It must come within the cap.
    const statuses: number[] = [];
    for (let i = 0; i < 3 && !statuses.includes(429); i++) {
      const r = await page.request.post("/api/wizard/submit", { data: { state: withContact } });
      statuses.push(r.status());
      if (r.status() !== 200 && r.status() !== 429) throw new Error(`submit ${r.status()}: ${await r.text()}`);
    }
    expect(statuses, statuses.join(",")).toContain(429);
    expect(statuses.length).toBeLessThanOrEqual(3);
    if (limitsBefore) await db!.from("settings").upsert({ key: "wizard_limits", value: limitsBefore }, { onConflict: "key" });
  });

  test("range first: the range shows with no details; Tighten asks for them before going further", async ({ page }) => {
    await setOrder("range_first");
    const email = `gate.rf.${RUN}@example.com`;
    emails.push(email);
    await driveNoPlanWizard(page, { stopAtReveal: true, suburb: `Gaterf${RUN}` });
    expect(await page.locator("[data-quick-step='gate']").count()).toBe(0);
    await expect(page.getByTestId("reveal-range")).toBeVisible();
    await expect(page.getByTestId("door-keep")).toBeVisible();
    await page.getByTestId("door-tighten").click();
    await expect(page.getByTestId("talk-sheet")).toBeVisible();
    await expect(page.getByText("We will save your estimate so you can come back to it.")).toBeVisible();
    await page.getByTestId("talk-name").fill("Range First");
    await page.getByTestId("talk-email").fill(email);
    await page.getByTestId("talk-mobile").fill("0400 333 444");
    await page.getByTestId("talk-go").click();
    await page.waitForURL((u) => u.pathname === "/estimate/scope", { timeout: 60_000 });
    const { data: draft } = await db!.from("wizard_drafts").select("gate_version, gate_completed_at, range_shown_at, range_option").ilike("suburb", `Gaterf${RUN}`).order("started_at", { ascending: false }).limit(1).single();
    expect(draft?.gate_version).toBe("range_first");
    expect(draft?.range_shown_at).not.toBeNull();
    expect(draft?.gate_completed_at).not.toBeNull();
    expect(draft?.range_option).toBe("tighten");
    const { data: acc } = await db!.from("accounts").select("name").eq("email", email).maybeSingle();
    expect(acc?.name).toBe("Range First");
  });

  test("a session keeps its version after the switch is changed", async ({ page }) => {
    await setOrder("details_first");
    const suburb = `Gatekeep${RUN}`;
    await openQuickLook(page);
    await page.getByPlaceholder(/Your address/).fill("3 Keep Street, Kew");
    await page.getByPlaceholder("Suburb").fill(suburb);
    await page.getByPlaceholder("Postcode").fill("3101");
    await quickNext(page);
    await expect.poll(async () => (await db!.from("wizard_drafts").select("gate_version").ilike("suburb", suburb).order("started_at", { ascending: false }).limit(1).maybeSingle()).data?.gate_version, { timeout: 15_000 }).toBe("details_first");
    await setOrder("range_first");
    // Carry on: another answer, another save — and a reload, which rebuilds the steps from the saved state.
    await quickNext(page);
    await page.reload();
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await page.waitForTimeout(3_500);
    const { data: draft } = await db!.from("wizard_drafts").select("gate_version, state").ilike("suburb", suburb).order("started_at", { ascending: false }).limit(1).single();
    expect(draft?.gate_version).toBe("details_first");
    expect((draft?.state as { gateVersion?: string }).gateVersion).toBe("details_first");
  });

  test("the dashboard's gate report counts the sessions per version", async ({ page }) => {
    // The dashboard needs a role; the master login (profiles.is_owner) holds them all. Put back afterwards.
    const masterId = (await userIdFor({ email: staffEmail, password: process.env.E2E_STAFF_PASSWORD ?? "" })) ?? "";
    if (!masterId) throw new Error("e2e staff login not found");
    const { data: prof } = await db!.from("profiles").select("is_owner").eq("id", masterId).single();
    const wasOwner = prof?.is_owner === true;
    if (!wasOwner) await db!.from("profiles").update({ is_owner: true }).eq("id", masterId);
    try {
    await loginStaff(page);
    await page.goto("/home");
    const gateTable = page.getByTestId("funnel-gate");
    await expect(gateTable).toBeVisible();
    const df = Number(await gateTable.getByTestId("funnel-gate-details_first").getByTestId("gate-sessions").innerText());
    const rf = Number(await gateTable.getByTestId("funnel-gate-range_first").getByTestId("gate-sessions").innerText());
    expect(df).toBeGreaterThanOrEqual(2);
    expect(rf).toBeGreaterThanOrEqual(1);
    const csv = await page.request.get("/api/reporting/export?metric=funnel.gate_sessions&preset=month");
    expect(csv.status()).toBe(200);
    const text = await csv.text();
    expect(text).toContain("details_first");
    expect(text).toContain("range_first");
    } finally {
      if (!wasOwner) await db!.from("profiles").update({ is_owner: false }).eq("id", masterId);
    }
  });
});
