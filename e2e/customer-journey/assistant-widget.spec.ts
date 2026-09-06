import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { driveNoPlanWizard, openScopeEditor } from "./drive";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = url && key ? createClient(url, key) : null;
// "Talk to a person" is refused outside support hours (a callback is offered instead) — the run must be inside them.
const ALL_DAY = { timezone: "Australia/Melbourne", days: { mon: ["00:00", "23:59"], tue: ["00:00", "23:59"], wed: ["00:00", "23:59"], thu: ["00:00", "23:59"], fri: ["00:00", "23:59"], sat: ["00:00", "23:59"], sun: ["00:00", "23:59"] }, strongCoverageDays: [] };
let savedHours: unknown = null;
test.beforeAll(async () => {
  if (!db) return;
  const { data } = await db.from("agent_settings").select("support_hours").eq("tenant_key", "paint-group").maybeSingle();
  savedHours = data?.support_hours ?? null;
  await db.from("agent_settings").update({ support_hours: ALL_DAY }).eq("tenant_key", "paint-group");
});
test.afterAll(async () => {
  if (db && savedHours) await db.from("agent_settings").update({ support_hours: savedHours }).eq("tenant_key", "paint-group");
});

/**
 * Tom, 7 Sep 2026 — the bottom-right chat on the customer's editor
 * (C1 stack, AGENT_MODEL_STUB=1): an anonymous customer who just built an
 * estimate opens the widget, gets a grounded answer from the assistant in
 * SUPPORT mode (never the guided build chat, never co-work), and "Talk to a
 * person" hands the conversation off.
 */
test("the chat widget answers about the estimate and hands off to a person", async ({ page }) => {
  test.skip(!db, "service key needed (support hours)");
  test.setTimeout(300_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);

  await page.getByTestId("assistant-widget-launch").click();
  await expect(page.getByTestId("assistant-widget-panel")).toBeVisible();
  // The opening line is the support disclosure, not the guided interview.
  await expect(page.getByTestId("sp-msg-assistant").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("assistant-widget-panel")).not.toContainText(/Inside, outside, or both/);

  await page.getByTestId("sp-input").fill("What's included in my estimate?");
  await page.getByTestId("sp-send").click();
  await expect(page.locator(".pgw .msg.theirs .msg-body", { hasText: "…" })).toHaveCount(0, { timeout: 90_000 });
  const answer = (await page.getByTestId("sp-msg-assistant").last().innerText()).trim();
  expect(answer.length).toBeGreaterThan(10);

  await page.getByTestId("sp-person").click();
  await expect(page.getByTestId("support")).toHaveAttribute("data-status", "handed_off", { timeout: 90_000 });

  // Closing keeps the conversation; reopening shows it again.
  await page.getByTestId("assistant-widget-launch").click();
  await expect(page.getByTestId("assistant-widget-panel")).toHaveCount(0);
  await page.getByTestId("assistant-widget-launch").click();
  await expect(page.getByTestId("sp-msg-user").first()).toBeVisible();
});
