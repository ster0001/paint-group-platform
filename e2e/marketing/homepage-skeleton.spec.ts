import { test, expect, type Page } from "@playwright/test";

/**
 * Homepage v2 — the walking skeleton (brief §6, session 1). An ANONYMOUS
 * visitor on a phone: load → tap the field → it is empty → type → pick a
 * suggestion → See my price → lands on /estimate with the address AND the
 * mode on the URL (Tom, 4 Sep: assert the values, not just the navigation),
 * and the wizard shows the address.
 *
 * The "ghost typing visible → tap → field empty" beat is session 6's
 * (§6b) — this spec gains it when the self-typing estimator lands.
 *
 * Address lookup is mocked at the network edge: the C1 test stack has no
 * Google key (the proxy 503s and the field degrades to plain typing), and
 * the real proxy is exercised elsewhere. What this asserts is the field's
 * own suggestion → selection → hand-off path.
 */
test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const PICKED = {
  street: "12 Elm Street",
  suburb: "Northcote",
  state: "VIC",
  postcode: "3070",
  formatted: "12 Elm Street, Northcote VIC 3070",
};

async function mockLookup(page: Page) {
  await page.route("**/api/places/autocomplete", async (route) => {
    const body = route.request().postDataJSON() as { input?: string };
    const input = (body.input ?? "").trim();
    await route.fulfill({
      json: {
        suggestions: ["Street", "Grove", "Road"].map((kind, i) => ({
          placeId: `mock-${i}`,
          main: `${input} ${kind}`,
          secondary: ["Northcote VIC 3070", "Thornbury VIC 3071", "Preston VIC 3072"][i],
        })),
      },
    });
  });
  await page.route("**/api/places/details", (route) =>
    route.fulfill({ json: { address: PICKED, inServiceArea: true } }),
  );
}

/** Collect every `track()` call so the spec can assert the analytics contract (§5). */
async function captureEvents(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __pgEvents?: unknown[] };
    w.__pgEvents = [];
    window.addEventListener("pg:track", (e) => {
      w.__pgEvents!.push((e as CustomEvent).detail);
    });
  });
}
type Captured = { name: string; props: Record<string, unknown> };
const events = (page: Page) =>
  page.evaluate(() => (window as Window & { __pgEvents?: Captured[] }).__pgEvents ?? []);

test("anonymous mobile visitor: type → pick → See my price → wizard pre-filled", async ({ page }) => {
  await captureEvents(page);
  await mockLookup(page);
  await page.goto("/");

  // The H1 is the LCP element and the copy is the prototype's, verbatim.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Transforming spaces.Redefining painting.");
  // The phone number never hides: on mobile it lives in the call bar.
  await expect(page.getByRole("link", { name: "Call us" })).toBeVisible();

  // Two address fields now (hero + closing CTA, session 5): this spec is the hero's.
  const hero = page.locator("#top");
  const field = hero.getByRole("textbox", { name: "Address" });
  await field.tap();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");

  await field.fill("12 Elm");
  const options = page.getByRole("option");
  await expect(options).toHaveCount(3);
  await expect(options.first()).toContainText("12 Elm Street");
  await options.first().click();
  await expect(field).toHaveValue(PICKED.formatted);

  await hero.getByRole("button", { name: "See my price →" }).click();
  await expect(page).toHaveURL(/\/estimate\?/);

  const url = new URL(page.url());
  expect(url.searchParams.get("address")).toBe(PICKED.formatted);
  expect(url.searchParams.get("mode")).toBe("home");

  // The wizard shows what was typed. (If the public gate is shut on this
  // stack the holding page renders instead — that is a stack problem, and
  // the message says so.)
  const holding = page.getByText("Online estimates are nearly here");
  if (await holding.count()) throw new Error("wizard_public is OFF on this stack — turn it on before running this spec");
  await expect(page.getByPlaceholder("Your address — start typing and pick it")).toHaveValue(PICKED.formatted);

  // Analytics contract: the field's events carry `where` only; the address
  // never rides an event; see_price carries {where, mode}.
  const seen = await events(page);
  const names = seen.map((e) => e.name);
  expect(names).toEqual(expect.arrayContaining(["address_typed", "address_selected", "see_price"]));
  const seePrice = seen.find((e) => e.name === "see_price");
  expect(seePrice?.props).toEqual({ where: "hero", mode: "home" });
  for (const e of seen) expect(JSON.stringify(e.props)).not.toContain("Elm");
});

test("the business chip travels as mode=business and pre-selects commercial", async ({ page }) => {
  await captureEvents(page);
  await mockLookup(page);
  await page.goto("/");

  const hero = page.locator("#top");
  await hero.getByRole("button", { name: "A business or property I manage" }).tap();
  const field = hero.getByRole("textbox", { name: "Address" });
  await field.fill("4/22 High Street, Northcote");
  await hero.getByRole("button", { name: "See my price →" }).click();
  await expect(page).toHaveURL(/\/estimate\?/);

  const url = new URL(page.url());
  expect(url.searchParams.get("address")).toBe("4/22 High Street, Northcote");
  expect(url.searchParams.get("mode")).toBe("business");

  const seen = await events(page);
  expect(seen.find((e) => e.name === "mode_business")?.props).toEqual({ where: "hero" });
  expect(seen.find((e) => e.name === "see_price")?.props).toEqual({ where: "hero", mode: "business" });

  const holding = page.getByText("Online estimates are nearly here");
  if (await holding.count()) throw new Error("wizard_public is OFF on this stack — turn it on before running this spec");
  await expect(page.getByPlaceholder("Your address — start typing and pick it")).toHaveValue("4/22 High Street, Northcote");
  // Property kind: the wizard's own picker (Seg) marks the chosen answer with class "on".
  await expect(page.locator(".wz-seg button", { hasText: "Commercial" })).toHaveClass(/\bon\b/);
});
