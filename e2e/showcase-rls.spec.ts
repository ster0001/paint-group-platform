import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds } from "./helpers";

/**
 * Homepage v2 · session 2 — showcase_jobs under RLS, proven through each
 * role's OWN session (never the service key — the CLAUDE.md lesson).
 *
 * What must hold (brief §4.4a AC):
 *  - the public (anon key, no session) reads PUBLISHED rows and nothing else;
 *  - the public cannot insert;
 *  - staff read drafts too;
 *  - staff cannot write through their client either — the table has no
 *    client write policy and no write grant; the server action is the path;
 *  - the showcase-media bucket exists and is public-read.
 *
 * Rows are created through the service client (that is fixture set-up, not
 * the thing under test) and removed afterwards.
 */

const db: SupabaseClient | null = serviceClient();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const staff = credentials("STAFF");

async function rest(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...rest,
    headers: {
      apikey: anonKey!,
      Authorization: `Bearer ${token ?? anonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(rest.headers ?? {}),
    },
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as unknown };
}

async function signIn(email: string, password: string): Promise<string> {
  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey!, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  if (!auth.access_token) throw new Error(`sign-in failed for ${email}`);
  return auth.access_token as string;
}

test.describe("showcase_jobs RLS (homepage brief §4.4a)", () => {
  test.skip(!db || !url || !anonKey, "needs SUPABASE_SERVICE_ROLE_KEY + supabase env");

  const run = randomBytes(4).toString("hex");
  const publishedSlug = `e2e-showcase-live-${run}`;
  const draftSlug = `e2e-showcase-draft-${run}`;
  let migrationReady = true;
  let draftId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const probe = await sb.from("showcase_jobs").select("id").limit(1);
    if (probe.error) { migrationReady = false; return; }
    const base = {
      title: "E2E showcase", job_type: "interior", property_type: "home", suburb: "Northcote",
      completed_on: "2026-07-01", days_on_site: 3, price_low_cents: 500000, price_high_cents: 600000,
      scope_line: "e2e", hero_path: `e2e/${run}/hero.jpg`, consent_confirmed: true,
    };
    const live = await sb.from("showcase_jobs").insert({ ...base, slug: publishedSlug, published: true }).select("id").single();
    if (live.error) throw live.error;
    const draft = await sb.from("showcase_jobs").insert({ ...base, slug: draftSlug, published: false }).select("id").single();
    if (draft.error) throw draft.error;
    draftId = draft.data.id as string;
  });

  test.afterAll(async () => {
    if (!db) return;
    await db.from("showcase_jobs").delete().in("slug", [publishedSlug, draftSlug]);
  });

  test("the public reads published rows only", async () => {
    test.skip(!migrationReady, "migration 20270101 (showcase_jobs) not applied on this stack");
    const r = await rest(`showcase_jobs?select=slug,published&slug=in.(${publishedSlug},${draftSlug})`);
    expect(r.status).toBe(200);
    const slugs = (r.body as Array<{ slug: string }>).map((x) => x.slug);
    expect(slugs).toEqual([publishedSlug]);
  });

  test("the public cannot insert", async () => {
    test.skip(!migrationReady, "migration 20270101 (showcase_jobs) not applied on this stack");
    const r = await rest("showcase_jobs", {
      method: "POST",
      body: JSON.stringify({ slug: `e2e-anon-${run}`, title: "x", job_type: "interior", property_type: "home", suburb: "y" }),
    });
    expect([401, 403]).toContain(r.status);
    const check = await db!.from("showcase_jobs").select("id").eq("slug", `e2e-anon-${run}`);
    expect(check.data ?? []).toHaveLength(0);
  });

  test("staff read drafts but cannot write through their own client", async () => {
    test.skip(!migrationReady, "migration 20270101 (showcase_jobs) not applied on this stack");
    test.skip(!staff, missingCreds("STAFF"));
    const token = await signIn(staff!.email, staff!.password);

    const read = await rest(`showcase_jobs?select=slug&slug=in.(${publishedSlug},${draftSlug})&order=slug`, { token });
    expect(read.status).toBe(200);
    expect((read.body as Array<{ slug: string }>).map((x) => x.slug).sort()).toEqual([draftSlug, publishedSlug].sort());

    const write = await rest(`showcase_jobs?id=eq.${draftId}`, { method: "PATCH", token, body: JSON.stringify({ title: "hacked" }) });
    expect([401, 403]).toContain(write.status);
    const after = await db!.from("showcase_jobs").select("title").eq("id", draftId).single();
    expect(after.data?.title).toBe("E2E showcase");

    const insert = await rest("showcase_jobs", {
      method: "POST", token,
      body: JSON.stringify({ slug: `e2e-staff-${run}`, title: "x", job_type: "interior", property_type: "home", suburb: "y" }),
    });
    expect([401, 403]).toContain(insert.status);
  });

  test("the rules the database enforces: publish-ready, price order, slug lock", async () => {
    test.skip(!migrationReady, "migration 20270101 (showcase_jobs) not applied on this stack");
    const sb = db!;
    // publish without consent → refused
    const noConsent = await sb.from("showcase_jobs").insert({
      slug: `e2e-noconsent-${run}`, title: "x", job_type: "interior", property_type: "home", suburb: "y",
      completed_on: "2026-07-01", price_low_cents: 1, price_high_cents: 2, hero_path: "h.jpg", consent_confirmed: false, published: true,
    });
    expect(noConsent.error?.code).toBe("23514");
    // low > high → refused
    const badPrice = await sb.from("showcase_jobs").insert({
      slug: `e2e-badprice-${run}`, title: "x", job_type: "interior", property_type: "home", suburb: "y",
      price_low_cents: 200, price_high_cents: 100,
    });
    expect(badPrice.error?.code).toBe("23514");
    // slug locked once published
    const rename = await sb.from("showcase_jobs").update({ slug: `${publishedSlug}-renamed` }).eq("slug", publishedSlug);
    expect(rename.error?.code).toBe("23514");
    // a second job on the same featured rank → refused
    await sb.from("showcase_jobs").update({ featured_rank: 3 }).eq("slug", publishedSlug);
    const dupRank = await sb.from("showcase_jobs").update({ featured_rank: 3 }).eq("slug", draftSlug);
    expect(dupRank.error?.code).toBe("23505");
    await sb.from("showcase_jobs").update({ featured_rank: null }).eq("slug", publishedSlug);
  });

  test("the showcase-media bucket is public-read", async () => {
    test.skip(!migrationReady, "migration 20270101 (showcase_jobs) not applied on this stack");
    const { data, error } = await db!.storage.getBucket("showcase-media");
    expect(error).toBeNull();
    expect(data?.public).toBe(true);
  });
});
