import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { rpcAs, serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * The first-sign-in tour (help brief Phase C, C3), through a REAL invite:
 * staff invite a painter, the painter joins, the tour appears once, Next walks
 * every card and lands on Help, a second sign-in shows no tour, Help replays
 * it, and the shared test contractor (jobs on the books) never sees it.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const index = JSON.parse(readFileSync("docs/help/_index.json", "utf8")) as { tours: { role: string; cards: number }[] };
const cards = index.tours.find((t) => t.role === "contractor")?.cards ?? 0;

const email = `pg.e2e.tour.${Date.now().toString(36)}@example.com`;
const password = "TourTest-2026!";

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  if (!db) return;
  // Remove the painter this spec invited: contractors row, profile, auth user, invite.
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  const u = users?.users.find((x) => x.email === email);
  if (u) {
    await db.from("contractors").delete().eq("profile_id", u.id);
    await db.from("profiles").delete().eq("id", u.id);
    await db.auth.admin.deleteUser(u.id);
  }
  await db.from("contractor_invites").delete().eq("email", email);
});

test("a freshly invited painter is toured once, can replay it from Help", async ({ page }) => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  test.skip(cards === 0, "no contractor tour in the index");
  test.setTimeout(180_000);

  const token = await rpcAs(staff!, "create_contractor_invite", {
    p_email: email, p_name: "Tour Tester", p_company: "Tour Test Painting", p_tier: null, p_days: 7,
  });
  expect(token).toMatch(/^[0-9a-f]{48}$/);

  // The join page signs up, or signs in when the account already exists. C1's
  // auth rejects public sign-ups on example.com and rate-limits confirmation
  // mail, so the account is created here and the page takes its sign-in path;
  // everything after that (redeem, promote, portal gate, tour) is the real flow.
  const made = await db!.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "Tour Tester" } });
  expect(made.error?.message ?? "").toBe("");

  await page.goto(`/join/${token}`);
  await page.getByPlaceholder("Josef Kovac").fill("Tour Tester");
  await page.getByPlaceholder("At least 8 characters").fill(password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.getByRole("button", { name: /join|create|set up|finish/i }).click();
  await expect(page).toHaveURL(/\/portal/, { timeout: 30_000 });

  // The tour, once.
  const tour = page.getByTestId("tour");
  await expect(tour).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("tour-card-1")).toBeVisible();
  for (let i = 1; i < cards; i++) {
    await page.getByTestId("tour-next").click();
    await expect(page.getByTestId(`tour-card-${i + 1}`)).toBeVisible();
  }
  await expect(page).toHaveURL(/\/portal\/help/); // the last card walks to Help
  await page.getByTestId("tour-finish").click();
  await expect(tour).toHaveCount(0);

  // Recorded on the account: a fresh page, no tour.
  await page.goto("/portal");
  await expect(page.getByTestId("help-list").or(page.locator("body"))).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("tour")).toHaveCount(0);
  const { data: row } = await db!.from("contractors").select("tour_seen_at").eq("company_name", "Tour Test Painting").maybeSingle();
  expect((row as { tour_seen_at: string | null } | null)?.tour_seen_at).not.toBeNull();

  // Replay from Help, then Skip — still recorded once.
  await page.goto("/portal/help");
  await page.getByTestId("tour-replay").click();
  await expect(page.getByTestId("tour")).toBeVisible();
  await page.getByTestId("tour-skip").click();
  await expect(page.getByTestId("tour")).toHaveCount(0);
});

test("a painter with work on the books is not toured", async ({ page }) => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  await signIn(page, contractor!, /\/portal/);
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("tour")).toHaveCount(0);
});
