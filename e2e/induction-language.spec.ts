import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, serviceClient } from "./fixtures/woLoop";

/**
 * Induction language — induction brief §8 Step 4 (rulings I8, ⚑2, ⚑3).
 *
 * AS THE CONTRACTOR: Home asks for a language until one is chosen; the picker
 * offers English and the live languages only (Italian switched off is not
 * offered; switched on it is); choosing Spanish renders the induction module
 * list, a module's Read-and-confirm lines and the standards sign-off section
 * in Spanish, with `lang="es"` on the translated text while the chrome stays
 * English; a Spanish line deleted from the tables falls back to English, is
 * marked, and the rest stays Spanish; the profile shows the choice; English
 * again puts everything back. The demo job and every app screen are not
 * touched by any of it (the Jobs tab reads the same in both).
 *
 * Rows: the e2e contractor's induction_language (put back), one Italian live
 * flag (put back), one Spanish block row deleted and re-inserted. Seeded
 * content (scripts/seed-induction.ts) must be on the test project.
 */
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let contractorId = "";
let languageBefore: string | null = null;
let kindBefore = "full";
let italianLiveBefore = false;
let spanishLiveBefore = false;
let deletedRow: Record<string, unknown> | null = null;

test.describe.configure({ mode: "serial" });

test.describe("induction language — choose, read in it, fall back to English", () => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to read the tables");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    expect(contractorId).toBeTruthy();
    const { data: c } = await db!.from("contractors").select("induction_language, induction_kind").eq("id", contractorId).single();
    languageBefore = (c as { induction_language: string | null }).induction_language;
    kindBefore = (c as { induction_kind: string }).induction_kind;
    // The list assertions below count the thirteen modules of the FULL induction; the e2e
    // painter is on the refresher since 20270270 (seven modules), so switch for the run.
    await db!.from("contractors").update({ induction_kind: "full" }).eq("id", contractorId);
    const { data: langs, error } = await db!.from("induction_languages").select("code, live").in("code", ["it", "es"]);
    expect(error?.message ?? "").toBe("");
    for (const l of (langs ?? []) as { code: string; live: boolean }[]) { if (l.code === "it") italianLiveBefore = l.live; if (l.code === "es") spanishLiveBefore = l.live; }
    const { count } = await db!.from("induction_blocks").select("id", { count: "exact", head: true }).eq("language", "es");
    expect(count ?? 0, "Spanish content is seeded on the test project (scripts/seed-induction.ts)").toBeGreaterThan(100);
    // The run needs Spanish on and Italian off; both go back in afterAll.
    await db!.from("induction_languages").update({ live: true }).eq("code", "es");
    await db!.from("induction_languages").update({ live: false }).eq("code", "it");
    await db!.from("contractors").update({ induction_language: null }).eq("id", contractorId);
  });

  test.afterAll(async () => {
    if (!db) return;
    if (deletedRow) await db.from("induction_blocks").insert(deletedRow);
    await db.from("induction_languages").update({ live: italianLiveBefore }).eq("code", "it");
    await db.from("induction_languages").update({ live: spanishLiveBefore }).eq("code", "es");
    await db.from("contractors").update({ induction_language: languageBefore, induction_kind: kindBefore }).eq("id", contractorId);
  });

  test("Home asks for a language; the picker offers English and the live languages only", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.getByTestId("home-induction-language").click();
    await expect(page.getByTestId("induction-language")).toBeVisible();
    await expect(page.getByTestId("language-en")).toBeVisible();
    await expect(page.getByTestId("language-es")).toBeVisible();
    await expect(page.getByTestId("language-it"), "Italian is switched off, so it is not offered").toHaveCount(0);

    // Switched on, it appears — without a deploy.
    await db!.from("induction_languages").update({ live: true }).eq("code", "it");
    await page.reload();
    await expect(page.getByTestId("language-it")).toBeVisible();
    await db!.from("induction_languages").update({ live: false }).eq("code", "it");

    // The RPC refuses a language that is not live, whatever the browser sends.
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
    const s = await anon.auth.signInWithPassword({ email: contractor!.email, password: contractor!.password });
    expect(s.error?.message ?? "").toBe("");
    const refused = await anon.rpc("induction_set_language", { p_code: "it" });
    expect(refused.data).toBe("error:not_live");
    const unknown = await anon.rpc("induction_set_language", { p_code: "xx" });
    expect(unknown.data).toBe("error:unknown_language");
  });

  test("choosing Spanish: the modules, a module's lines and a standards section read in Spanish", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/induction/language?next=/portal/induction");
    await page.getByTestId("language-es").click();
    await expect(page.getByTestId("induction")).toHaveAttribute("data-language", "es", { timeout: 20_000 });
    const { data: c } = await db!.from("contractors").select("induction_language").eq("id", contractorId).single();
    expect((c as { induction_language: string | null }).induction_language).toBe("es");

    // The module list: 13 modules, titles in Spanish with lang="es"; the chrome English.
    await expect(page.locator("[data-testid^='induction-module-m']")).toHaveCount(13);
    const m03 = page.getByTestId("induction-module-m03");
    await expect(m03.locator("[lang='es']")).toContainText("En casa del cliente");
    await expect(page.getByTestId("induction").locator("h1")).toHaveText("Your induction");

    // Module 3: the ten site rules, in Spanish, on an element that says so.
    await m03.click();
    await expect(page.getByTestId("induction-module")).toHaveAttribute("data-language", "es");
    await expect(page.getByTestId("induction-module-title")).toHaveAttribute("lang", "es");
    const lines = page.getByTestId("induction-lines").locator("li");
    await expect(lines).toHaveCount(10);
    await expect(page.getByTestId("induction-line-s1")).toContainText("Soy un invitado en la casa del cliente");
    await expect(page.getByTestId("induction-line-s1")).toHaveAttribute("data-translated", "true");
    await expect(page.getByTestId("induction-tick-statement")).toContainText("Seguiré las reglas del sitio en cada casa.");
    await expect(page.getByTestId("induction-fallback")).toHaveCount(0);
    await expect(page.getByText("Read and confirm · 15 min")).toBeVisible();

    // Module 5 links to the six standards sections; the sign-off section reads in Spanish.
    await page.goto("/portal/induction/m05");
    await expect(page.getByTestId("induction-standards-links")).toBeVisible();
    await page.goto("/portal/standards/confirm?s=levels");
    await expect(page.getByTestId("signoff-section")).toHaveAttribute("data-section", "levels");
    await expect(page.getByTestId("signoff-section")).toContainText("El nivel en su orden de trabajo");
    await expect(page.getByTestId("signoff-section")).not.toContainText("The level on your work order tells you");
    // Help → standards too, and the words page.
    await page.goto("/portal/help/standards");
    await expect(page.locator("body")).toContainText("Paredes");

    // The profile shows the choice.
    await page.goto("/portal/profile");
    await expect(page.getByTestId("profile-language-chip")).toContainText("Spanish");
  });

  test("a missing Spanish line falls back to English, is marked, and the rest stays Spanish", async ({ page }) => {
    const { data: m } = await db!.from("induction_modules").select("id").eq("module_key", "m03").limit(1).single();
    const moduleId = (m as { id: string }).id;
    const { data: row } = await db!.from("induction_blocks").select("module_id, line_key, kind, sort, audiences, language, text").eq("module_id", moduleId).eq("line_key", "s2").eq("language", "es").single();
    deletedRow = row as Record<string, unknown>;
    const del = await db!.from("induction_blocks").delete().eq("module_id", moduleId).eq("line_key", "s2").eq("language", "es");
    expect(del.error?.message ?? "").toBe("");

    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/induction/m03");
    await expect(page.getByTestId("induction-line-s2")).toHaveAttribute("data-translated", "false");
    await expect(page.getByTestId("induction-line-s2")).toContainText("Shoes off until the floors are covered");
    await expect(page.getByTestId("induction-line-s1")).toHaveAttribute("data-translated", "true");
    await expect(page.getByTestId("induction-fallback")).toContainText("1 line shown in English");

    await db!.from("induction_blocks").insert(deletedRow!);
    deletedRow = null;
    await page.reload();
    await expect(page.getByTestId("induction-line-s2")).toHaveAttribute("data-translated", "true");
  });

  test("the app and the demo job stay English whatever the language; English again puts the words back", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/jobs");
    await expect(page.locator("body")).toContainText(/Your jobs|Jobs|Demo/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.goto("/portal/induction/language?next=/portal/induction/m03");
    await page.getByTestId("language-en").click();
    await expect(page.getByTestId("induction-module")).toHaveAttribute("data-language", "en", { timeout: 20_000 });
    await expect(page.getByTestId("induction-line-s1")).toContainText("I am a guest in the customer's home");
    await page.goto("/portal/standards/confirm?s=levels");
    await expect(page.getByTestId("signoff-section")).toContainText("The level on your work order tells you");
  });
});
