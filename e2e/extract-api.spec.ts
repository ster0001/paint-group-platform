import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * The plan-reader API's gates.
 *
 * This is the app's first API route, so what it refuses matters as much as what
 * it accepts. These four run against the real server; the first three need no
 * database tables, which is why they hold before the migration is applied.
 *
 * The happy path needs migration 20260910000000. It is behind
 * E2E_EXTRACT_READY=1 so the suite stays green on a database that hasn't had it
 * applied yet, rather than reporting a red test for a missing table.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
// Playwright loads specs as CJS, so no import.meta here; it runs from the repo root.
const fixture = readFileSync("lib/extract/__fixtures__/two-page-plan.pdf");

test("an anonymous request is refused", async ({ request }) => {
  const res = await request.post("/api/extract/floorplan", {
    multipart: { file: { name: "plan.pdf", mimeType: "application/pdf", buffer: fixture } },
  });
  expect(res.status()).toBe(401);
});

test("a contractor cannot upload plans", async ({ page }) => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  await signIn(page, contractor!, /\/portal/);

  const res = await page.request.post("/api/extract/floorplan", {
    multipart: { file: { name: "plan.pdf", mimeType: "application/pdf", buffer: fixture } },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toMatch(/staff/i);
});

test("a text file renamed .pdf is refused on its bytes, not its name", async ({ page }) => {
  test.skip(!staff, missingCreds("STAFF"));
  await signIn(page, staff!, /\/estimates/);

  const res = await page.request.post("/api/extract/floorplan", {
    multipart: {
      file: {
        name: "floorplan.pdf",
        mimeType: "application/pdf", // lying, exactly as an attacker would
        buffer: Buffer.from("<html><body>not a plan at all</body></html>"),
      },
    },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/doesn't look like a plan/i);
});

test("a real plan is read, classified and stored", async ({ page }) => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(process.env.E2E_EXTRACT_READY !== "1", "needs migration 20260910000000 applied");
  await signIn(page, staff!, /\/estimates/);

  const res = await page.request.post("/api/extract/floorplan", {
    multipart: { file: { name: "two-page-plan.pdf", mimeType: "application/pdf", buffer: fixture } },
  });
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body.runIds).toHaveLength(2);          // one run per page, never per document
  expect(body.pages[0].pageClass).toBe("floorplan_interior");
  expect(body.pages[1].pageClass).toBe("elevation");
  expect(body.pages[0].hasTextLayer).toBe(true);
  expect(body.floorplanPages).toBe(1);

  // The debug page renders that run for a human to check.
  await page.goto(`/dev/extract/${body.primaryRunId}`);
  await expect(page.getByRole("heading", { name: /extraction run/i })).toBeVisible();
  await expect(page.locator("body")).toContainText("floorplan_interior");
  await expect(page.locator("body")).toContainText("3.60 x 4.20"); // the text layer
});
