import { test } from "vitest";
import assert from "node:assert/strict";
import { checkListingUrl, checkPlanImageUrl, findFloorplanImages } from "./listing.ts";

// ---- the URL gates ----------------------------------------------------------

test("listing URLs stay on the allow-list, https only", () => {
  assert.equal(checkListingUrl("https://www.realestate.com.au/property-house-vic-x-123").ok, true);
  assert.equal(checkListingUrl("http://www.domain.com.au/x").ok, false, "http refused");
  assert.equal(checkListingUrl("https://169.254.169.254/latest").ok, false, "SSRF target refused");
});

test("plan image URLs allow the portals' CDNs and nothing else", () => {
  assert.equal(checkPlanImageUrl("https://i2.au.reastatic.net/800x600/abc/floorplan_1.jpg").ok, true);
  assert.equal(checkPlanImageUrl("https://rimh2.domainstatic.com.au/abc.jpg").ok, true);
  assert.equal(checkPlanImageUrl("https://www.domain.com.au/img/plan.png").ok, true);
  assert.equal(checkPlanImageUrl("https://evil.example.com/floorplan.jpg").ok, false);
  assert.equal(checkPlanImageUrl("http://reastatic.net/plan.jpg").ok, false, "https only");
});

// ---- the floorplan finder (Tom, 31 Aug) ------------------------------------

test("finds a floorplan URL that names itself, and ignores gallery photos", () => {
  const html = `
    <img src="https://i2.au.reastatic.net/1000x750/aaa/image_1.jpg" alt="kitchen">
    <img src="https://i2.au.reastatic.net/1000x750/bbb/floorplan_1.jpg" alt="Floorplan 1">
  `;
  const found = findFloorplanImages(html);
  assert.deepEqual(found, ["https://i2.au.reastatic.net/1000x750/bbb/floorplan_1.jpg"]);
});

test("finds URLs inside a floorplan-labelled JSON block with escaped slashes", () => {
  const html = `{"media":{"floorplans":[{"url":"https:\\/\\/rimh2.domainstatic.com.au\\/abc123.jpg"}],` +
    `"images":[{"url":"https:\\/\\/rimh2.domainstatic.com.au\\/photo9.jpg"}]}}`;
  const found = findFloorplanImages(html);
  assert.ok(found.includes("https://rimh2.domainstatic.com.au/abc123.jpg"), `got ${JSON.stringify(found)}`);
});

test("resolves {size} templates and refuses off-list hosts", () => {
  const html = `"floorplans":[{"templatedUrl":"https://i2.au.reastatic.net/{size}/xyz/floorplan.jpg"},` +
    `{"url":"https://evil.example.com/floorplan.jpg"}]`;
  const found = findFloorplanImages(html);
  assert.deepEqual(found, ["https://i2.au.reastatic.net/1144x888/xyz/floorplan.jpg"]);
});

test("a page with no floorplan finds nothing — never a gallery fallback", () => {
  const html = `<img src="https://i2.au.reastatic.net/800x600/ccc/image_2.jpg">
    <p>Beautiful three bedroom home</p>`;
  assert.deepEqual(findFloorplanImages(html), []);
});
