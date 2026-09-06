import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "../helpers";
import { DESK, PHONE, shot } from "./rig";

/**
 * Help capture — the help centre itself (brief Phase C, C4). Not a gate.
 * Contractor: Help tab, a guide, a search, the tour. Office: Help, a guide, a search.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const F = "help-centre";

test("help centre — contractor screens", async ({ browser }) => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const c = await ctx.newPage();
  await signIn(c, contractor!, /\/portal/);
  await c.goto("/portal/help");
  await expect(c.getByTestId("help-list")).toBeVisible();
  await shot(c, F, "contractor", "01");
  await c.goto("/portal/help/scheduling");
  await expect(c.getByTestId("help-guide")).toBeVisible();
  await shot(c, F, "contractor", "02");
  await c.locator(".help-article ol").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot(c, F, "contractor", "03");
  await c.goto("/portal/help?q=before+photo");
  await expect(c.getByTestId("help-results")).toBeVisible();
  await shot(c, F, "contractor", "04");
  await c.goto("/portal/help?tour=1");
  await expect(c.getByTestId("tour")).toBeVisible();
  await shot(c, F, "contractor", "05");
  await ctx.close();
});

test("help centre — office screens", async ({ browser }) => {
  test.skip(!staff, missingCreds("STAFF"));
  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: 2 });
  const s = await ctx.newPage();
  await signIn(s, staff!, /\/estimates/);
  await s.goto("/help");
  await expect(s.getByTestId("help-list")).toBeVisible();
  await shot(s, F, "staff", "01");
  await s.goto("/help/work-orders/pc");
  await expect(s.getByTestId("help-guide")).toBeVisible();
  await shot(s, F, "staff", "02");
  await s.goto("/help?q=mark+paid");
  await expect(s.getByTestId("help-results")).toBeVisible();
  await shot(s, F, "staff", "03");
  await ctx.close();
});
