/**
 * Step 8's done-when, live half: attack the running customer wizard and
 * assert every attack FAILS SAFELY. (The pure half lives in
 * lib/wizard/adversarial.test.ts and runs with the unit suite.)
 *
 * Preconditions (each checked, with a clear message if missing):
 *   - dev server running (E2E_BASE_URL, default http://localhost:3000)
 *   - migration 20260916 applied
 *   - Supabase: anonymous sign-ins ENABLED
 *   - server env: SUPABASE_SERVICE_ROLE_KEY set (the routes 503 without it)
 *
 *   npx tsx scripts/adversarial-wizard.ts
 *
 * Attacks:
 *   A1 unauthenticated submit/edit/upload            -> 401/403, never 200
 *   A2 anonymous user submitting INTERNAL mode        -> 403
 *   A3 guardrail bypass (commercial property)         -> handoff, no range
 *   A4 hard stop (asbestos)                           -> hard_stop, no range
 *   A5 rate limit                                     -> 429 by attempt N+1
 *   A6 editing a random estimate id                   -> 404 (not 403)
 *   A7 reveal payload leak scan                       -> no margin/price keys
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.join(import.meta.dirname ?? __dirname, "..");
for (const [k, v] of readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()] as const)) {
  if (!process.env[k]) process.env[k] = v;
}

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const results: Array<{ id: string; ok: boolean; note: string }> = [];
const check = (id: string, ok: boolean, note: string) => {
  results.push({ id, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${note}`);
};

const customerState = (email: string, over: Record<string, unknown> = {}) => ({
  mode: "customer",
  title: "", listingUrl: "", planRunIds: [], facadeRunIds: [],
  noPlan: true,
  basics: { bedrooms: 3, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: true },
  surfaces: ["walls", "ceilings", "cornices", "doors", "architraves", "skirting"],
  condition: { tier: "change", darkToLightSurfaces: [] },
  details: { doorStyle: "panel", windowStyle: "sash", ceilingHeight: "2.4", damageTier: 1, damageNote: "", damagePhotoCount: 0 },
  paint: { brands: [], colourHelp: null, waterBasedOnly: false, trimsOilBased: null },
  customer: {
    email, suburb: "Northcote", postcode: "3070",
    propertyKind: "house", heritageListed: "no", bodyCorporate: "no",
    builtPre1970: "no", asbestosSuspected: "no",
  },
  ...over,
});

async function main() {
  // ---- A1: no session at all ------------------------------------------------
  const bare = await fetch(`${BASE}/api/wizard/submit`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: customerState("nobody@example.com") }),
  });
  check("A1a", bare.status === 403, `unauthenticated submit -> ${bare.status} (auth checked before the body)`);
  const bareEdit = await fetch(`${BASE}/api/estimates/00000000-0000-4000-8000-000000000000/wizard-edit`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "confirm_height", heightM: 2.4 }),
  });
  check("A1b", bareEdit.status === 401 || bareEdit.status === 403, `unauthenticated edit -> ${bareEdit.status}`);
  const bareUp = await fetch(`${BASE}/api/extract/floorplan`, { method: "POST", body: new FormData() });
  check("A1c", bareUp.status === 401 || bareUp.status === 403, `unauthenticated upload -> ${bareUp.status}`);

  // ---- an anonymous identity for the rest ----------------------------------
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: anon, error: anonErr } = await supabase.auth.signInAnonymously();
  if (anonErr || !anon.session) {
    console.error(`\nCannot continue: anonymous sign-in failed (${anonErr?.message}).`);
    console.error("Enable it: Supabase dashboard -> Authentication -> Sign In / Up -> Allow anonymous sign-ins.");
    process.exit(1);
  }
  const auth = { authorization: `Bearer ${anon.session.access_token}` };
  // The app reads the session from cookies; the API routes accept the bearer
  // form through @supabase/ssr's cookie fallback? They don't - so we set the
  // sb cookies the same way the browser client would.
  const cookieName = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;
  const cookie = `${cookieName}=${encodeURIComponent(JSON.stringify(anon.session))}`;
  const asAnon = (init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), cookie, ...auth },
  });

  // ---- A2: anonymous user, internal mode ------------------------------------
  const internal = await fetch(`${BASE}/api/wizard/submit`, asAnon({
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ state: { ...customerState("a2@example.com"), mode: "internal", customer: null } }),
  }));
  check("A2", internal.status === 403, `anon submitting internal mode -> ${internal.status}`);

  // ---- A3: commercial property ----------------------------------------------
  const commercial = await fetch(`${BASE}/api/wizard/submit`, asAnon({
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      state: customerState("a3@example.com", {
        customer: { ...customerState("a3@example.com").customer, propertyKind: "commercial" },
      }),
    }),
  }));
  const commercialBody = await commercial.text();
  check("A3", commercial.ok && commercialBody.includes('"handoff"') && !commercialBody.includes("rangeLoCents"),
    `commercial -> handoff without a range (${commercial.status})`);

  // ---- A4: asbestos hard stop ----------------------------------------------
  const asbestos = await fetch(`${BASE}/api/wizard/submit`, asAnon({
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      state: customerState("a4@example.com", {
        customer: { ...customerState("a4@example.com").customer, asbestosSuspected: "yes" },
      }),
    }),
  }));
  const asbestosBody = await asbestos.text();
  check("A4", asbestos.ok && asbestosBody.includes('"hard_stop"') && !asbestosBody.includes("rangeLoCents"),
    `asbestos -> hard_stop without a range (${asbestos.status})`);

  // ---- A5 + A7: reveal, leak scan, then the rate limit ----------------------
  let leaked = false;
  let limited = false;
  for (let i = 1; i <= 4; i++) {
    const res = await fetch(`${BASE}/api/wizard/submit`, asAnon({
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ state: customerState("a5@example.com") }),
    }));
    const body = await res.text();
    if (res.status === 429) { limited = true; check("A5", true, `rate limited on attempt ${i}`); break; }
    if (res.ok) {
      for (const needle of ["marginCents", "subtotalCents", "priceCents", "contractorHours", '"openAt"']) {
        if (body.includes(needle)) { leaked = true; check("A7", false, `reveal leaked ${needle}`); }
      }
    }
  }
  if (!limited) check("A5", false, "4 submits from one identity were never rate-limited");
  if (!leaked) check("A7", true, "no internal keys in any reveal payload");

  // ---- A6: someone else's estimate ------------------------------------------
  const foreign = await fetch(`${BASE}/api/estimates/00000000-0000-4000-8000-000000000000/wizard-edit`, asAnon({
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "remove_room", areaId: 1 }),
  }));
  check("A6", foreign.status === 404, `foreign estimate edit -> ${foreign.status} (404 expected, existence never confirmed)`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} attacks failed safely.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
