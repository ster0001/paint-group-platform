/* One-off (deleted after run): reproduce Tom's contractor claim flow on PROD
 * as Josef — press send in the REAL UI, watch responses + console. */
import { chromium } from "playwright-core";

const BASE = "https://paint-group-platform.vercel.app";

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE ERR:", m.text().slice(0, 200)); });
page.on("response", (r) => {
  if (r.request().method() === "POST" && r.status() >= 400) console.log("POST FAIL:", r.status(), r.url());
});

await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', "pg.josef.contractor@gmail.com");
await page.fill('input[type="password"]', "painttest123");
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL(/portal/, { timeout: 30000 });

await page.goto(`${BASE}/portal/money`);
await page.waitForSelector('[data-testid="request-claim"]', { timeout: 20000 });
const empty = await page.locator('[data-testid="claim-empty"]').count();
console.log("claim card empty-state:", empty > 0);

if (!empty) {
  await page.locator('[data-testid="open-claim"]').click();
  const hasPicker = await page.locator('[data-testid="claim-job"]').count();
  if (hasPicker) await page.locator('[data-testid="claim-job"]').selectOption({ index: 1 });
  await page.locator('[data-testid="claim-fixed"]').click();
  await page.fill('[data-testid="claim-dollars"]', "1");
  const btn = page.locator('[data-testid="send-claim"]');
  console.log("send button text:", await btn.textContent());
  await btn.click();
  await page.waitForSelector('[data-testid="claim-message"]', { timeout: 30000 }).catch(() => console.log("NO MESSAGE APPEARED within 30s"));
  const msg = await page.locator('[data-testid="claim-message"]').textContent().catch(() => null);
  console.log("result message:", msg);
  // Does the invoice list below now show rows?
  await page.waitForTimeout(2500);
  const body = await page.locator("body").innerText();
  console.log("page mentions CI-:", /CI-\d+/.test(body), (body.match(/CI-\d+/g) ?? []).join(","));
}

// PDF check on the newest submitted invoice
const links = await page.locator('a[href*="/pdf"]').all();
console.log("pdf links on page:", links.length);
if (links.length) {
  const href = await links[0].getAttribute("href");
  const res = await page.request.get(`${BASE}${href}`, { maxRedirects: 0 }).catch((e) => null);
  console.log("PDF route status:", res?.status(), (await res?.text().catch(() => ""))?.slice(0, 120));
}

await browser.close();
