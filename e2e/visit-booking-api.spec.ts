import { test, expect, type Browser, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { driveNoPlanWizard } from "./customer-journey/drive";
import { STANDARD_WEEK } from "../lib/visits/schedule";
import { melbourneInstant, melbourneParts } from "../lib/time/businessHours";

/**
 * Visit booking addendum A · section 8 — "tests that try to break it", run
 * against the API directly (page.request shares the anonymous session's
 * cookies), as the brief requires. Tests 1–11 and 13.
 *
 * Every customer here is a real anonymous wizard run on the test project,
 * cleaned up in afterAll together with its visits, holds and accounts.
 */

const db: SupabaseClient | null = serviceClient();
const staffEmail = process.env.E2E_STAFF_EMAIL ?? "";
const run = randomBytes(3).toString("hex");

type Customer = { page: Page; estimateId: string; mobile: string; email: string };
type Days = Array<{ date: string; weekday: number; slots: Array<{ startsAt: string; startMinutes: number }> }>;

async function customer(browser: Browser, tag: string, suburb: string, postcode: string, withDetails = true): Promise<Customer> {
  const page = await (await browser.newContext()).newPage();
  await driveNoPlanWizard(page, { stopAtReveal: true, suburb, postcode });
  const estimateId = (await page.getByTestId("reveal").getAttribute("data-estimate-id")) ?? "";
  expect(estimateId).toBeTruthy();
  const c: Customer = { page, estimateId, mobile: `04${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, email: `api.${tag}.${run}@example.com` };
  if (withDetails) {
    const r = await page.request.post("/api/visits/details", { data: { estimateId, name: `Test ${tag}`, email: c.email, mobile: c.mobile } });
    expect(r.status(), await r.text()).toBe(200);
  }
  return c;
}
const availability = async (c: Customer): Promise<Days> => (await (await c.page.request.get(`/api/visits/availability?estimateId=${c.estimateId}`)).json()).days;
const hold = (c: Customer, startsAt: string) => c.page.request.post("/api/visits/hold", { data: { estimateId: c.estimateId, startsAt } });
const confirm = (c: Customer, holdId: string, code: string) => c.page.request.post("/api/visits/confirm", { data: { estimateId: c.estimateId, holdId, code } });
const resend = (c: Customer, holdId: string) => c.page.request.post("/api/visits/resend", { data: { estimateId: c.estimateId, holdId } });

async function codeFor(sb: SupabaseClient, mobile: string, after: number): Promise<string> {
  const e164 = `+61${mobile.slice(1)}`;
  for (let i = 0; i < 20; i++) {
    const { data } = await sb.from("messages").select("body, created_at").eq("to_address", e164).ilike("body", "%code to book%").gte("created_at", new Date(after - 2000).toISOString()).order("created_at", { ascending: false }).limit(1);
    const m = /\b(\d{6})\b/.exec((data?.[0]?.body as string | undefined) ?? "");
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`no code for ${e164}`);
}

/** The next <weekday> at least `minDays` ahead, at HH:MM Melbourne. */
function nextAt(weekday: number, minutes: number, minDays: number): string {
  const d = new Date(Date.now() + minDays * 86_400_000);
  for (let i = 0; i < 8; i++) {
    const p = melbourneParts(new Date(d.getTime() + i * 86_400_000));
    if (p.weekday === weekday) return melbourneInstant(p.y, p.m, p.d, Math.floor(minutes / 60), minutes % 60).toISOString();
  }
  throw new Error("no such day");
}

test.describe("Section 8 — tests that try to break it (API)", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staffEmail, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_EMAIL");
  const customers: Customer[] = [];
  let staffId = "", hadWeek = false;
  const zonesBefore = new Map<string, string | null>();

  test.beforeAll(async () => {
    const sb = db!;
    const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
    staffId = users?.users.find((x) => (x.email ?? "").toLowerCase() === staffEmail.toLowerCase())?.id ?? "";
    if (!staffId) throw new Error("staff login not found");
    const { data: zones } = await sb.from("visit_zones").select("key, estimator_id");
    for (const z of zones ?? []) zonesBefore.set(z.key as string, z.estimator_id as string | null);
    await sb.from("visit_zones").update({ estimator_id: staffId }).is("estimator_id", null);
    const { data: slots } = await sb.from("visit_slots").select("id").eq("estimator_id", staffId).limit(1);
    hadWeek = !!slots?.length;
    if (!hadWeek) {
      const { error } = await sb.from("visit_slots").insert(STANDARD_WEEK.map((s) => ({ estimator_id: staffId, weekday: s.weekday, start_minutes: s.startMinutes, length_minutes: 90, zones: [...s.zones].sort(), cond_zone: s.cond?.zone ?? null, cond_if_prev_zone: s.cond?.ifPrevZone ?? null })));
      if (error) throw new Error(error.message);
    }
  });

  test.afterAll(async () => {
    const sb = db!;
    const ids = customers.map((c) => c.estimateId);
    if (ids.length) { await sb.from("visits").delete().in("estimate_id", ids); await sb.from("visit_holds").delete().in("estimate_id", ids); }
    for (const c of customers) {
      const { data: acc } = await sb.from("accounts").select("id").eq("email", c.email).maybeSingle();
      if (acc) { await sb.from("estimates").update({ account_id: null, property_id: null }).eq("account_id", acc.id); await sb.from("properties").delete().eq("account_id", acc.id); await sb.from("accounts").delete().eq("id", acc.id); }
    }
    for (const [key, est] of zonesBefore) if (est === null) await sb.from("visit_zones").update({ estimator_id: null }).eq("key", key);
    if (!hadWeek) await sb.from("visit_slots").delete().eq("estimator_id", staffId);
  });

  test("1 · a slot the address's zone cannot book is refused — the zone comes from the stored address only", async ({ browser }) => {
    const c = await customer(browser, "t1", "Glen Waverley", "3150"); customers.push(c); // Zone 1
    // Wednesday 09:30 is Zone 2 only.
    const r = await hold(c, nextAt(3, 570, 2));
    expect(r.status()).toBe(409);
    expect((await r.json()).code).toBe("not_offered");
    // Sending a zone with the request changes nothing (the body does not even accept one).
    const r2 = await c.page.request.post("/api/visits/hold", { data: { estimateId: c.estimateId, startsAt: nextAt(3, 570, 2), zone: "zone_2" } });
    expect(r2.status()).toBe(409);
  });

  test("2 · confirm without a valid code is refused", async ({ browser }) => {
    const c = await customer(browser, "t2", "Glen Waverley", "3150"); customers.push(c);
    const days = await availability(c);
    const slot = days[0].slots[0];
    const h = await (await hold(c, slot.startsAt)).json();
    expect(h.holdId).toBeTruthy();
    expect((await confirm(c, h.holdId, "")).status()).toBe(400);
    expect((await confirm(c, h.holdId, "12345")).status()).toBe(400);
    const wrong = await confirm(c, h.holdId, "000000");
    expect(wrong.status()).toBe(400);
    expect((await wrong.json()).code).toBe("wrong");
    const { data } = await db!.from("visits").select("id").eq("estimate_id", c.estimateId);
    expect(data?.length).toBe(0);
  });

  test("3 · an expired hold is refused and released", async ({ browser }) => {
    const c = await customer(browser, "t3", "Glen Waverley", "3150"); customers.push(c);
    const slot = (await availability(c))[0].slots[0];
    const before = Date.now();
    const h = await (await hold(c, slot.startsAt)).json();
    const code = await codeFor(db!, c.mobile, before);
    await db!.from("visit_holds").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", h.holdId);
    const r = await confirm(c, h.holdId, code);
    expect(r.status()).toBe(410);
    expect((await r.json()).code).toBe("expired");
    const { data } = await db!.from("visit_holds").select("released_at, release_reason").eq("id", h.holdId).single();
    expect(data?.released_at).not.toBeNull();
    expect(data?.release_reason).toBe("expired");
    // The slot is offered again.
    const again = (await availability(c)).flatMap((d) => d.slots).some((s) => s.startsAt === slot.startsAt);
    expect(again).toBe(true);
  });

  test("4 · two customers hold the same slot at the same moment: exactly one succeeds, and only the holder can book", async ({ browser }) => {
    const a = await customer(browser, "t4a", "Glen Waverley", "3150"); customers.push(a);
    const b = await customer(browser, "t4b", "Kew", "3101"); customers.push(b);
    const slot = (await availability(a))[0].slots[0];
    const before = Date.now();
    const [ra, rb] = await Promise.all([hold(a, slot.startsAt), hold(b, slot.startsAt)]);
    const statuses = [ra.status(), rb.status()].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = ra.status() === 200 ? a : b, loser = winner === a ? b : a;
    const h = await (ra.status() === 200 ? ra : rb).json();
    // The loser cannot confirm with a hold id that is not theirs.
    const stolen = await confirm(loser, h.holdId, "000000");
    expect(stolen.status()).toBe(404);
    const code = await codeFor(db!, winner.mobile, before);
    const booked = await confirm(winner, h.holdId, code);
    expect(booked.status(), await booked.text()).toBe(200);
    const { data } = await db!.from("visits").select("id, estimate_id").eq("staff_id", staffId).eq("starts_at", slot.startsAt).eq("status", "booked");
    expect(data?.length).toBe(1);
    expect(data![0].estimate_id).toBe(winner.estimateId);
  });

  test("5 · a slot starting in 90 minutes is refused; 6 · a slot 30 days ahead is refused", async ({ browser }) => {
    const c = await customer(browser, "t56", "Glen Waverley", "3150"); customers.push(c);
    const soon = new Date(Date.now() + 90 * 60_000); soon.setSeconds(0, 0);
    const r5 = await hold(c, soon.toISOString());
    expect(r5.status()).toBe(409);
    const far = new Date(Date.now() + 30 * 86_400_000); far.setSeconds(0, 0);
    const r6 = await hold(c, far.toISOString());
    expect(r6.status()).toBe(409);
    // And nothing the API offers is outside the window.
    const days = await availability(c);
    const latest = Math.max(...days.flatMap((d) => d.slots.map((s) => new Date(s.startsAt).getTime())));
    expect(latest).toBeLessThanOrEqual(Date.now() + 22 * 86_400_000);
    const earliest = Math.min(...days.flatMap((d) => d.slots.map((s) => new Date(s.startsAt).getTime())));
    expect(earliest).toBeGreaterThanOrEqual(Date.now() + 119 * 60_000);
  });

  test("7 · a pre-arranged address cannot book; 8 · nor can an out-of-area one", async ({ browser }) => {
    const pre = await customer(browser, "t7", "Sorrento", "3943"); customers.push(pre);
    const av7 = await (await pre.page.request.get(`/api/visits/availability?estimateId=${pre.estimateId}`)).json();
    expect(av7.zone).toBe("pre_arranged");
    expect(av7.days).toEqual([]);
    const r7 = await hold(pre, nextAt(1, 480, 2));
    expect(r7.status()).toBe(409);
    expect((await r7.json()).code).toBe("not_bookable");
    const out = await customer(browser, "t8", "Werribee", "3030"); customers.push(out);
    const av8 = await (await out.page.request.get(`/api/visits/availability?estimateId=${out.estimateId}`)).json();
    expect(av8.zone).toBe("out_of_area");
    const r8 = await hold(out, nextAt(1, 480, 2));
    expect(r8.status()).toBe(409);
    expect((await r8.json()).code).toBe("not_bookable");
    // The screens, too.
    await pre.page.goto(`/estimate/visit?id=${pre.estimateId}`);
    await expect(pre.page.getByRole("heading", { name: "We visit Sorrento by arrangement" })).toBeVisible();
    await out.page.goto(`/estimate/visit?id=${out.estimateId}`);
    await expect(out.page.getByRole("heading", { name: "We don’t currently visit Werribee" })).toBeVisible();
  });

  test("9 · an estimate that is not this customer's — or does not exist — cannot book; no details, no hold", async ({ browser }) => {
    const a = await customer(browser, "t9a", "Glen Waverley", "3150"); customers.push(a);
    const b = await customer(browser, "t9b", "Glen Waverley", "3150", false); customers.push(b);
    const slot = (await availability(a))[0].slots[0];
    // b asks about a's estimate.
    const stolen = await b.page.request.post("/api/visits/hold", { data: { estimateId: a.estimateId, startsAt: slot.startsAt } });
    expect(stolen.status()).toBe(403);
    const ghost = await b.page.request.post("/api/visits/hold", { data: { estimateId: "00000000-0000-4000-8000-000000000000", startsAt: slot.startsAt } });
    expect(ghost.status()).toBe(404);
    // b has given no details: a hold is refused until they do.
    const own = await hold(b, slot.startsAt);
    expect(own.status()).toBe(409);
    expect((await own.json()).code).toBe("no_contact");
  });

  test("10 · six wrong codes end the hold with no booking", async ({ browser }) => {
    const c = await customer(browser, "t10", "Glen Waverley", "3150"); customers.push(c);
    const slot = (await availability(c))[0].slots[0];
    const h = await (await hold(c, slot.startsAt)).json();
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) seen.push((await confirm(c, h.holdId, "111111")).status());
    expect(seen.slice(0, 4)).toEqual([400, 400, 400, 400]);
    expect(seen[4]).toBe(410);
    expect(seen[5]).toBe(410);
    const { data } = await db!.from("visit_holds").select("release_reason").eq("id", h.holdId).single();
    expect(data?.release_reason).toBe("too_many_attempts");
    const { data: v } = await db!.from("visits").select("id").eq("estimate_id", c.estimateId);
    expect(v?.length).toBe(0);
  });

  test("11 · codes to one mobile are limited: three resends per hold, five sends per ten minutes", async ({ browser }) => {
    const c = await customer(browser, "t11", "Glen Waverley", "3150"); customers.push(c);
    const slots = (await availability(c)).flatMap((d) => d.slots);
    const h = await (await hold(c, slots[0].startsAt)).json(); // send 1
    expect((await resend(c, h.holdId)).status()).toBe(200); // 2
    expect((await resend(c, h.holdId)).status()).toBe(200); // 3
    expect((await resend(c, h.holdId)).status()).toBe(200); // 4
    const fourth = await resend(c, h.holdId);
    expect(fourth.status()).toBe(429);
    // Picking again is a new hold and the fifth send; the one after that hits the per-mobile limit.
    expect((await hold(c, slots[1].startsAt)).status()).toBe(200); // 5
    const sixth = await hold(c, slots[2].startsAt);
    expect(sixth.status()).toBe(429);
    expect((await sixth.json()).code).toBe("limited");
    const { count } = await db!.from("visit_code_sends").select("id", { count: "exact", head: true }).eq("mobile", `+61${c.mobile.slice(1)}`);
    expect(count).toBe(5);
  });

  test("13 · far-edge Zone 4 holds Friday 08:00, far-edge Zone 3 holds Friday 09:30: whoever confirms second is refused (R18)", async ({ browser }) => {
    const z4 = await customer(browser, "t13a", "Mornington", "3931"); customers.push(z4); // Zone 4, far edge
    const z3 = await customer(browser, "t13b", "Lilydale", "3140"); customers.push(z3);   // Zone 3, far edge
    const fri8 = nextAt(5, 480, 2), fri930 = nextAt(5, 570, 2);
    const offered4 = (await availability(z4)).flatMap((d) => d.slots.map((s) => s.startsAt));
    test.skip(!offered4.includes(fri8), "next Friday 08:00 is not free on the test project");
    const before = Date.now();
    const h4 = await (await hold(z4, fri8)).json();
    expect(h4.holdId).toBeTruthy();
    // A hold is not a booking: Zone 3 can still hold 09:30 next door.
    const r3 = await hold(z3, fri930);
    expect(r3.status(), await r3.text()).toBe(200);
    const h3 = await r3.json();
    const code4 = await codeFor(db!, z4.mobile, before);
    expect((await confirm(z4, h4.holdId, code4)).status()).toBe(200);
    // Now the far-edge neighbour is confirmed, the second confirmation breaks R18.
    const code3 = await codeFor(db!, z3.mobile, before);
    const r = await confirm(z3, h3.holdId, code3);
    expect(r.status()).toBe(409);
    expect((await r.json()).code).toBe("unavailable");
    const { data } = await db!.from("visits").select("estimate_id").eq("staff_id", staffId).eq("starts_at", fri930).eq("status", "booked");
    expect(data?.length).toBe(0);
  });

  test("15 · a browser cannot write a hold or a visit directly", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    test.skip(!url || !anonKey, "needs the anon key");
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const h = await anon.from("visit_holds").insert({ estimate_id: "00000000-0000-4000-8000-000000000000", estimator_id: staffId, starts_at: new Date().toISOString(), zone: "zone_1", mobile: "+61400000000", code_hash: "x", expires_at: new Date().toISOString() });
    expect(h.error).not.toBeNull();
    const rpc = await anon.rpc("visit_hold_release", { p_hold: "00000000-0000-4000-8000-000000000000", p_reason: "x" });
    expect(rpc.error).not.toBeNull();
  });
});
