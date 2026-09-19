import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Dark or light in the contractor portal (Tom, 19 Sep: "a switch for the
 * contractor portal to be in dark or light theme to match with other themes").
 *
 * The same switch, the same cookie and the same token names as the CRM,
 * Projects and Payments — so what is proven here is not "a button exists" but
 * the three things that made the staff surfaces' toggle trustworthy:
 *   · the choice is SERVER-rendered on the next load (no flash of the old
 *     palette), which means the cookie, not just a class flipped in the browser
 *   · it holds across every tab of the portal, not only the screen you flipped
 *   · the palette actually changes — asserted as computed colour, because
 *     `data-theme="light"` on an element no stylesheet answers is exactly the
 *     failure this spec exists to catch
 */

const creds = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

// The house light palette, shared with .crm / .pc / .invx.
const LIGHT_INK = "rgb(241, 244, 246)";
const LIGHT_TEXT = "rgb(18, 22, 26)";
const DARK_TEXT = "rgb(237, 240, 242)";

const themeOf = (page: Page) => page.locator(".pt");

// Two marks, so neither theme is left with lettering the same colour as the header.
const ON_DARK = "https://example.com/e2e-portal-logo-on-dark.png";
const ON_LIGHT = "https://example.com/e2e-portal-logo-on-light.png";

test.describe("contractor portal — dark or light", () => {
  test.skip(!creds, missingCreds("CONTRACTOR"));

  test("the switch flips the palette, and the choice survives a reload and every tab", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);
    const pt = themeOf(page);

    // Dark is the portal's own default — a painter who has never touched the
    // switch sees exactly what they saw before this feature.
    await expect(pt).toHaveAttribute("data-theme", "dark");
    expect(await pt.evaluate((el) => getComputedStyle(el).color)).toBe(DARK_TEXT);

    await page.getByTestId("theme-toggle").click();
    await expect(pt).toHaveAttribute("data-theme", "light");
    expect(await pt.evaluate((el) => getComputedStyle(el).color)).toBe(LIGHT_TEXT);
    // The phone column, the sticky header and the fixed tab bar are the three
    // surfaces that were painted with hard-coded near-black rather than tokens.
    expect(await page.locator(".pt .phone").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(LIGHT_INK);
    for (const sel of [".pt .hd", ".pt .tabs"]) {
      const bg = await page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg, `${sel} kept its dark chrome in light mode`).toMatch(/^rgba?\(2[0-9]{2}, 2[0-9]{2}, 2[0-9]{2}/);
    }

    // The reload is the point: a server that ignored the cookie would hand back
    // dark HTML and the screen would flash before the browser caught up.
    await page.reload();
    await expect(pt).toHaveAttribute("data-theme", "light");
    expect(await pt.evaluate((el) => getComputedStyle(el).color)).toBe(LIGHT_TEXT);

    for (const path of ["/portal/jobs", "/portal/calendar", "/portal/profile", "/portal/help"]) {
      await page.goto(path);
      await expect(themeOf(page), `${path} forgot the theme`).toHaveAttribute("data-theme", "light");
    }

    // And back, from a screen other than the one it was turned on from.
    await page.getByTestId("theme-toggle").click();
    await expect(themeOf(page)).toHaveAttribute("data-theme", "dark");
    await page.goto("/portal");
    await expect(themeOf(page)).toHaveAttribute("data-theme", "dark");
  });

  test("light mode never leaves white-on-white: the header logo swaps with the palette", async ({ page }) => {
    test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY to put a logo in Settings");
    // Settings is staff-RLS'd and the portal reads it through the whitelisted
    // service read, so the logos have to be real rows for this to mean
    // anything. Saved and put back — settings are shared with every other spec.
    const sb = db!;
    const before = await sb.from("settings").select("value").eq("key", "company_profile").maybeSingle();
    const had = !!before.data;
    const saved = (before.data?.value as Record<string, unknown> | null) ?? null;
    const next = { ...(saved ?? {}), logoUrl: ON_DARK, logoUrlLight: ON_LIGHT };
    const w = had
      ? await sb.from("settings").update({ value: next }).eq("key", "company_profile")
      : await sb.from("settings").insert({ key: "company_profile", value: next });
    if (w.error) throw new Error(w.error.message);

    try {
      await signIn(page, creds!, /\/portal/);
      const dark = page.getByTestId("portal-logo-dark");
      const light = page.getByTestId("portal-logo-light");
      await expect(dark).toHaveAttribute("src", ON_DARK);
      await expect(light).toHaveAttribute("src", ON_LIGHT);

      // Dark mode wears the white-lettering mark…
      if ((await themeOf(page).getAttribute("data-theme")) === "light") await page.getByTestId("theme-toggle").click();
      await expect(dark).toBeVisible();
      await expect(light).toBeHidden();
      // …and light mode the dark-lettering one. Both are in the page, so the
      // swap happens on the click with no round trip.
      await page.getByTestId("theme-toggle").click();
      await expect(light).toBeVisible();
      await expect(dark).toBeHidden();
      // And it survives the server render, not just the click.
      await page.reload();
      await expect(light).toBeVisible();
      await expect(dark).toBeHidden();
      await page.getByTestId("theme-toggle").click();
      await expect(dark).toBeVisible();
    } finally {
      if (had) await sb.from("settings").update({ value: saved }).eq("key", "company_profile");
      else await sb.from("settings").delete().eq("key", "company_profile");
    }
  });
});
