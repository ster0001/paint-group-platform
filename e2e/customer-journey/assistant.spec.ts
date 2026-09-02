import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * S4 — guided mode, as an ANONYMOUS customer (CLAUDE.md testing law).
 *
 * Runs on the C1 stack with AGENT_MODEL_STUB=1: the phrasing layer is
 * templated, everything else is real — the question graph, the tools, the
 * guards, the estimate row, RLS, the editor beside the chat.
 *
 *   1. interior 1-bed self-serve path → the range shows and the accept CTA renders
 *   2. exterior on a pre-1970 home with peeling paint → the lead script, visit tier
 *   3. abandon after the email → the sweep emits the lead event
 */

const MONEY = /\$[\d,]+\s*–\s*\$[\d,]+/;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Script = Record<string, (page: Page, root: ReturnType<Page["locator"]>) => Promise<void>>;

async function click(root: ReturnType<Page["locator"]>, name: string | RegExp) {
  await root.getByRole("button", { name, exact: typeof name === "string" }).first().click();
}

function script(over: { email: string; jobType?: "Inside" | "Outside" | "Both"; pre1970?: "Yes" | "No"; condition?: "Good" | "Weathered" | "Peeling"; bedrooms?: string }): Script {
  const flags = async (_p: Page, root: ReturnType<Page["locator"]>) => {
    for (const [flag, answer] of [["builtPre1970", over.pre1970 ?? "No"], ["heritageListed", "No"], ["bodyCorporate", "No"], ["asbestosSuspected", "No"]] as const) {
      await root.locator(`[data-flag="${flag}"]`).getByRole("button", { name: answer, exact: true }).click();
    }
    await click(root, "Done");
  };
  return {
    "q.address": async (_p, root) => {
      await root.getByLabel("Street").fill("12 Test Street");
      await root.getByLabel("Suburb").fill("Murrumbeena");
      await root.getByLabel("Postcode").fill("3163");
      await click(root, "Done");
    },
    "q.job_type": (_p, r) => click(r, over.jobType ?? "Inside"),
    "q.account_type": (_p, r) => click(r, "My home"),
    "q.property_type": (_p, r) => click(r, "House"),
    "q.property_flags": flags,
    "q.storeys": (_p, r) => click(r, "Single storey"),
    "ext.storeys": (_p, r) => click(r, "Single storey"),
    "q.timing": (_p, r) => click(r, "Soon"),
    "q.email": async (_p, r) => { await r.getByLabel("you@example.com").fill(over.email); await click(r, "Done"); },
    "job.surfaces": async (_p, r) => {
      // Walls, ceilings, skirting (preset on) — doors and architraves off: a
      // job above the $2,000 call-out floor and under the $6,000 self-serve cap.
      for (const off of ["Doors", "Architraves"]) await r.getByRole("button", { name: off, exact: true }).click();
      await click(r, "Done");
    },
    "condition.tier": (_p, r) => click(r, "Freshen up (same colour)"),
    "condition.damage": (_p, r) => click(r, "None"),
    "rooms": async (_p, r) => { await click(r, over.bedrooms ?? "2"); await click(r, "Done"); },
    "occupied": (_p, r) => click(r, "No, it'll be empty"),
    "paint.brand": async (_p, r) => { await click(r, "Dulux"); await click(r, "Done"); },
    "paint.colours": (_p, r) => click(r, "I know the colours"),
    "door_style": (_p, r) => click(r, "Flat"),
    "window_style": (_p, r) => click(r, "Casement"),
    "ceiling_height": (_p, r) => click(r, "2.4 m"),
    "ext.photos": (_p, r) => click(r, "No photos to hand"),
    "ext.substrates": async (_p, r) => { await click(r, "Weatherboards"); await click(r, "Done"); },
    "ext.painting": (_p, r) => click(r, "Done"),
    "ext.condition": (_p, r) => click(r, over.condition ?? "Good"),
    "ext.access": (_p, r) => click(r, "None"),
    "ext.cond_card": async (_p, r) => {
      await r.locator('[data-cond="cond"]').getByRole("button", { name: over.condition ?? "Good", exact: true }).click();
      await r.locator('[data-cond="rot"]').getByRole("button", { name: "No rot", exact: true }).click();
      await r.locator('[data-cond="acc"]').getByRole("button", { name: "None", exact: true }).click();
      await click(r, "Done");
    },
    "ext.freestanding": (_p, r) => click(r, "None"),
  };
}

/** Answer whatever the assistant asks, by the gap key on the chips, until
 *  the CTA appears or `stopAt` is reached. Returns the keys answered. */
async function converse(page: Page, s: Script, opts: { stopAt?: (key: string) => boolean; max?: number } = {}): Promise<string[]> {
  const answered: string[] = [];
  for (let i = 0; i < (opts.max ?? 80); i++) {
    const cta = page.getByTestId("as-cta");
    if (await cta.count()) return answered;
    const chips = page.getByTestId("as-chips");
    await expect(chips).toBeVisible({ timeout: 30_000 });
    const key = (await chips.getAttribute("data-gap")) ?? "";
    if (opts.stopAt?.(key)) return answered;
    const handler =
      s[key]
      ?? (/^room\.\d+\.size$/.test(key) ? (_p: Page, r: ReturnType<Page["locator"]>) => click(r, "Looks right") : null)
      ?? (/^room\.\d+\.(cupboards|cupboard_interiors)$/.test(key) ? (_p: Page, r: ReturnType<Page["locator"]>) => click(r, "No") : null)
      ?? (/^room\.\d+\.anything_else$/.test(key) ? (_p: Page, r: ReturnType<Page["locator"]>) => click(r, "Nothing else") : null)
      ?? (/^room\.\d+\.surfaces$/.test(key) ? (_p: Page, r: ReturnType<Page["locator"]>) => click(r, "Looks right") : null)
      ?? (/^(room\.\d+|side\.\w+)\.confirm$/.test(key) ? (_p: Page, r: ReturnType<Page["locator"]>) => click(r, "Confirm") : null)
      ?? (/^side\.\w+\.include$/.test(key) ? (_p: Page, r: ReturnType<Page["locator"]>) => click(r, "Yes") : null)
      ?? (/^side\.\w+\.size$/.test(key) ? (_p: Page, r: ReturnType<Page["locator"]>) => click(r, "Looks right") : null)
      ?? (/dw_totals$/.test(key) ? (_p: Page, r: ReturnType<Page["locator"]>) => click(r, "Yes, that's right") : null)
      ?? (/^sweep\.(missed_rooms|ext_missed)$/.test(key) ? (_p: Page, r: ReturnType<Page["locator"]>) => click(r, "Nothing missed") : null);
    if (!handler) throw new Error(`no scripted answer for gap "${key}"`);
    await handler(page, chips);
    answered.push(key);
    // The chips for THIS gap disappear while the turn runs; wait for the reply.
    await expect(page.locator(".as-typing")).toHaveCount(0, { timeout: 60_000 });
  }
  throw new Error("the conversation did not finish");
}

async function startAssistant(page: Page) {
  await page.goto("/estimate");
  const entry = page.getByTestId("chat-it");
  await expect(entry).toBeEnabled({ timeout: 30_000 });
  await entry.click();
  await expect(page).toHaveURL(/\/estimate\/assist\?c=/, { timeout: 30_000 });
  await expect(page.getByTestId("as-msg-assistant").first()).toBeVisible();
  // The disclosure line is the first thing a person reads (§8).
  await expect(page.locator(".as-disclosure")).toContainText(/assistant/i);
}

test.describe("assistant — guided mode as an anonymous customer", () => {
  test("interior 2-bed: the range shows once everything is confirmed, then the accept CTA", async ({ page }) => {
    test.setTimeout(420_000);
    await startAssistant(page);
    const answered = await converse(page, script({ email: `e2e-assist-${unique()}@example.com` }));
    // §4 order: qualification first, then rooms, then the room loop.
    expect(answered[0]).toMatch(/^q\./);
    expect(answered.indexOf("rooms")).toBeGreaterThan(answered.lastIndexOf("q.email"));
    expect(answered.findIndex((k) => k.startsWith("room."))).toBeGreaterThan(answered.indexOf("rooms"));
    // No number before confirmation; a range once confirmed and swept (R4).
    await expect(page.getByTestId("as-range")).toHaveAttribute("data-shown", "1");
    await expect(page.getByTestId("as-range")).toContainText(MONEY);
    const cta = page.getByTestId("as-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveText(/Accept estimate|Confirm my price/);
    // The editor beside the chat shows the same tree, priced — never a $0 line.
    await expect(page.locator(".sc-r").first()).toHaveText(MONEY);
    await expect(page.locator("text=/\\$0\\b/")).toHaveCount(0);
  });

  test("exterior on a pre-1970 home with peeling paint: the lead-paint script, visit tier", async ({ page }) => {
    test.setTimeout(300_000);
    await startAssistant(page);
    // Answer up to and including the exterior condition; the stop comes next.
    await converse(page, script({ email: `e2e-lead-${unique()}@example.com`, jobType: "Outside", pre1970: "Yes", condition: "Peeling" }), {
      stopAt: (key) => key.startsWith("stop.") || key.startsWith("side.") || key === "occupied" || key.startsWith("paint."),
      max: 40,
    });
    // The hard stop is code: the script IS the reply (§2 rule 5).
    const last = page.getByTestId("as-msg-assistant").last();
    await expect(last).toContainText(/lead/i);
    // Never a number through a hard stop.
    await expect(page.getByTestId("as-range")).toHaveAttribute("data-shown", "0");
  });

  test("abandon after the email: the sweep emits the lead event", async ({ page }) => {
    test.setTimeout(240_000);
    const email = `e2e-abandon-${unique()}@example.com`;
    await startAssistant(page);
    await converse(page, script({ email }), { stopAt: (key) => key === "job.surfaces" || key === "rooms" || key.startsWith("ext."), max: 20 });

    const secret = process.env.CRON_SECRET;
    test.skip(!secret, "set CRON_SECRET to run the sweep");
    const res = await page.request.get("/api/cron/agent-sweep?minutes=0", { headers: { authorization: `Bearer ${secret}` } });
    expect(res.ok()).toBe(true);
    expect((await res.json()).logged).toBeGreaterThan(0);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    test.skip(!url || !key, "service key needed to read crm_events");
    const db = createClient(url!, key!);
    const { data: acct } = await db.from("accounts").select("id").eq("email", email).maybeSingle();
    expect(acct?.id, "the email captured in chat became an account").toBeTruthy();
    const { data: events } = await db.from("crm_events").select("type, payload").eq("account_id", acct!.id).eq("type", "wizard_abandoned");
    expect(events?.length).toBeGreaterThan(0);
    expect((events![0].payload as { emailCaptured?: boolean }).emailCaptured).toBe(true);
  });
});
