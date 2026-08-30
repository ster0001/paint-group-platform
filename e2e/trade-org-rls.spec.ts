import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Trade portal v2 · Session 1 — the org layer under RLS, proven through each
 * role's OWN session (never the service key — the CLAUDE.md lesson).
 *
 * What must hold (brief §7 row 1 + Tom's rulings):
 *  - a user of org X reads NOTHING of org Y: colour records, references,
 *    external approvals, properties;
 *  - a viewer with property_scope [A] cannot read property B — not the
 *    property row, not its colour records;
 *  - a finance-role user reads property references (and the account) but no
 *    colour records, no external approvals, no wo_events, no wo_photos;
 *  - members can neither insert nor update colour_records (select-only);
 *  - the anonymous key alone reads nothing.
 */

const db: SupabaseClient | null = serviceClient();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Session = { token: string };

async function signIn(email: string, password: string): Promise<Session> {
  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey!, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  if (!auth.access_token) throw new Error(`sign-in failed for ${email}: ${auth.msg ?? auth.error_description}`);
  return { token: auth.access_token };
}

async function restGet(session: Session | null, path: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: anonKey!, Authorization: `Bearer ${session ? session.token : anonKey}` },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function restWrite(
  session: Session,
  method: "POST" | "PATCH",
  path: string,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: anonKey!,
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const idsOf = (body: unknown): string[] =>
  Array.isArray(body) ? (body as Array<{ id: string }>).map((r) => r.id).sort() : [];

test.describe("trade org layer RLS (trade portal v2, session 1)", () => {
  test.skip(!db || !url || !anonKey, "needs SUPABASE_SERVICE_ROLE_KEY + supabase env");

  const run = randomBytes(4).toString("hex");
  const password = "painttest123";
  const admin = { email: `pg.e2e.trade.admin.${run}@example.com`, id: "" };   // org X, role admin, all properties
  const viewer = { email: `pg.e2e.trade.viewer.${run}@example.com`, id: "" }; // org X, role viewer, scope [propA1]
  const finance = { email: `pg.e2e.trade.fin.${run}@example.com`, id: "" };   // org X, role finance
  const other = { email: `pg.e2e.trade.other.${run}@example.com`, id: "" };   // org Y, role admin
  let orgX = "";
  let orgY = "";
  let propA1 = "";
  let propA2 = "";
  let propB = "";
  let estimateX = "";
  let approvalX = "";
  const colourIds: Record<string, string> = {}; // property id → colour record id
  let migrationReady = true;
  // A real wo_events / wo_photos row id each (via service), so the finance
  // denial test can ask for a SPECIFIC row through the index. A bare
  // `limit 5` probe hits the per-row policy quals on those tables and times
  // out at volume (pre-existing, flagged separately) — that would prove a
  // hang, not a denial.
  let someEventId = "";
  let somePhotoId = "";

  test.beforeAll(async () => {
    const sb = db!;
    // Probe: before migrations 20261213/20261214 the tables don't exist —
    // every test skips with the migrations named rather than failing noisily.
    const probe = await sb.from("colour_records").select("id").limit(1);
    const probe2 = await sb.from("property_references").select("id").limit(1);
    if (probe.error || probe2.error) {
      migrationReady = false;
      return;
    }

    for (const u of [admin, viewer, finance, other]) {
      const created = await sb.auth.admin.createUser({ email: u.email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
      u.id = created.data.user.id;
    }

    const x = await sb.from("accounts").insert({
      email: admin.email, name: "Org X e2e", account_type: "trade", org_kind: "real_estate",
    }).select("id").single();
    const y = await sb.from("accounts").insert({
      email: other.email, name: "Org Y e2e", account_type: "trade", org_kind: "facilities",
    }).select("id").single();
    if (x.error || y.error) throw new Error(`accounts: ${x.error?.message ?? y.error?.message}`);
    orgX = x.data.id;
    orgY = y.data.id;

    const mkProp = async (account: string, street: string, tag: string) => {
      const p = await sb.from("properties").insert({
        account_id: account, address: street, suburb: "Elwood", postcode: "3184",
        address_norm: `${street.toLowerCase()} elwood 3184 ${run}${tag}`,
      }).select("id").single();
      if (p.error) throw new Error(`property: ${p.error.message}`);
      return p.data.id as string;
    };
    propA1 = await mkProp(orgX, "14 Beaumont St", "a1");
    propA2 = await mkProp(orgX, "3 Tennyson St", "a2");
    propB = await mkProp(orgY, "9 Mitford St", "b");

    const memberships = await sb.from("account_users").insert([
      { account_id: orgX, profile_id: admin.id, role: "admin" },
      { account_id: orgX, profile_id: viewer.id, role: "viewer", property_scope: [propA1] },
      { account_id: orgX, profile_id: finance.id, role: "finance" },
      { account_id: orgY, profile_id: other.id, role: "admin" },
    ]);
    if (memberships.error) throw new Error(`account_users: ${memberships.error.message}`);

    for (const [prop, colour] of [[propA1, "Natural White"], [propA2, "Domino"], [propB, "Vivid White"]] as const) {
      const c = await sb.from("colour_records").insert({
        property_id: prop, area_label: "Walls — all rooms", surface_type: "wall",
        brand: "Dulux", product: "Wash & Wear", colour_name: colour,
        status: "applied", source: "historical_import", colour_attribution_lossy: true,
      }).select("id, account_id").single();
      if (c.error) throw new Error(`colour_records: ${c.error.message}`);
      colourIds[prop] = c.data.id;
      // The inheritance trigger fills account_id from the property.
      expect(c.data.account_id).toBe(prop === propB ? orgY : orgX);
    }

    const refs = await sb.from("property_references").insert([
      { property_id: propA1, label: "Owner", value: "T. & M. Nguyen" },
      { property_id: propB, label: "PO", value: "BAC-2026-0712" },
    ]);
    if (refs.error) throw new Error(`property_references: ${refs.error.message}`);

    const est = await sb.from("estimates").insert({
      title: `trade-rls e2e ${run}`, status: "draft",
      account_id: orgX, property_id: propA1,
      builder_state: { blocks: [], marginCents: 424242 },
    }).select("id").single();
    if (est.error) throw new Error(`estimate: ${est.error.message}`);
    estimateX = est.data.id;

    const ev = await sb.from("wo_events").select("id").limit(1).maybeSingle();
    someEventId = (ev.data?.id as string | undefined) ?? "";
    const ph = await sb.from("wo_photos").select("id").limit(1).maybeSingle();
    somePhotoId = (ph.data?.id as string | undefined) ?? "";

    const appr = await sb.from("external_approvals").insert({
      estimate_id: estimateX, sent_by_profile_id: admin.id,
      approver_name: "Owner e2e", approver_email: `owner.${run}@example.com`,
      token: randomBytes(24).toString("base64url"),
    }).select("id, account_id, property_id").single();
    if (appr.error) throw new Error(`external_approvals: ${appr.error.message}`);
    approvalX = appr.data.id;
    // The scope trigger inherited account + property from the estimate.
    expect(appr.data.account_id).toBe(orgX);
    expect(appr.data.property_id).toBe(propA1);
  });

  test.afterAll(async () => {
    const sb = db!;
    if (approvalX) await sb.from("external_approvals").delete().eq("id", approvalX);
    if (estimateX) await sb.from("estimates").delete().eq("id", estimateX);
    if (orgX) await sb.from("colour_records").delete().in("account_id", [orgX, orgY].filter(Boolean));
    if (orgX) await sb.from("property_references").delete().in("account_id", [orgX, orgY].filter(Boolean));
    if (orgX) await sb.from("properties").delete().in("account_id", [orgX, orgY].filter(Boolean));
    if (orgX) await sb.from("account_users").delete().in("account_id", [orgX, orgY].filter(Boolean));
    for (const id of [orgX, orgY]) if (id) await sb.from("accounts").delete().eq("id", id);
    for (const u of [admin, viewer, finance, other]) if (u.id) await sb.auth.admin.deleteUser(u.id);
  });

  const needMigrations = "run migrations 20261213000000_trade_org_layer + 20261214000000_colour_records first";

  test("org X admin reads own colour records — and none of org Y's", async () => {
    test.skip(!migrationReady, needMigrations);
    const a = await signIn(admin.email, password);
    const mine = await restGet(a, `colour_records?select=id&account_id=eq.${orgX}`);
    expect(idsOf(mine.body)).toEqual([colourIds[propA1], colourIds[propA2]].sort());
    const theirs = await restGet(a, `colour_records?select=id&account_id=eq.${orgY}`);
    expect(theirs.body).toEqual([]);
    const direct = await restGet(a, `colour_records?select=id&id=eq.${colourIds[propB]}`);
    expect(direct.body).toEqual([]);
  });

  test("org Y admin reads nothing of org X — colours, references, approvals", async () => {
    test.skip(!migrationReady, needMigrations);
    const o = await signIn(other.email, password);
    expect((await restGet(o, `colour_records?select=id&account_id=eq.${orgX}`)).body).toEqual([]);
    expect((await restGet(o, `property_references?select=id&account_id=eq.${orgX}`)).body).toEqual([]);
    expect((await restGet(o, `external_approvals?select=id&account_id=eq.${orgX}`)).body).toEqual([]);
    // Their own side still works — the policy is scoped, not broken.
    expect(idsOf((await restGet(o, `colour_records?select=id`)).body)).toEqual([colourIds[propB]]);
  });

  test("a viewer scoped to [A1] cannot read property A2 or B — rows or properties", async () => {
    test.skip(!migrationReady, needMigrations);
    const v = await signIn(viewer.email, password);
    const colours = await restGet(v, "colour_records?select=id");
    expect(idsOf(colours.body)).toEqual([colourIds[propA1]]);
    const props = await restGet(v, `properties?select=id&id=in.(${propA1},${propA2},${propB})`);
    expect(idsOf(props.body)).toEqual([propA1]);
    const refs = await restGet(v, "property_references?select=id,property_id");
    expect((refs.body as Array<{ property_id: string }>).every((r) => r.property_id === propA1)).toBe(true);
  });

  test("finance reads references and the account — but no colours, approvals, events or photos", async () => {
    test.skip(!migrationReady, needMigrations);
    const f = await signIn(finance.email, password);
    const refs = await restGet(f, `property_references?select=id&account_id=eq.${orgX}`);
    expect(idsOf(refs.body).length).toBe(1); // the Owner reference on A1
    const acct = await restGet(f, `accounts?select=id&id=eq.${orgX}`);
    expect(idsOf(acct.body)).toEqual([orgX]);
    expect((await restGet(f, "colour_records?select=id")).body).toEqual([]);
    expect((await restGet(f, "external_approvals?select=id")).body).toEqual([]);
    for (const [table, rowId] of [["wo_events", someEventId], ["wo_photos", somePhotoId]] as const) {
      if (!rowId) continue; // an empty target project has nothing to deny
      const r = await restGet(f, `${table}?select=id&id=eq.${rowId}`);
      // Either the policy answers empty or the grant refuses — never the row.
      expect([200, 401, 403, 404].includes(r.status)).toBe(true);
      if (r.status === 200) expect(r.body).toEqual([]);
    }
  });

  test("members cannot insert or update colour_records — select-only", async () => {
    test.skip(!migrationReady, needMigrations);
    const a = await signIn(admin.email, password);
    const ins = await restWrite(a, "POST", "colour_records", {
      property_id: propA1, area_label: "Intruder", surface_type: "wall",
      colour_name: "Hot Pink", source: "staff_edit",
    });
    expect(ins.status).toBeGreaterThanOrEqual(400);
    const upd = await restWrite(a, "PATCH", `colour_records?id=eq.${colourIds[propA1]}`, { colour_name: "Tampered" });
    expect(Array.isArray(upd.body) ? (upd.body as unknown[]).length : 0).toBe(0);
    const check = await db!.from("colour_records").select("colour_name").eq("id", colourIds[propA1]).single();
    expect(check.data?.colour_name).toBe("Natural White");
  });

  test("the anonymous key alone reads nothing from the org layer", async () => {
    test.skip(!migrationReady, needMigrations);
    for (const path of ["colour_records?select=id", "property_references?select=id", "external_approvals?select=id", "notification_prefs?select=id"]) {
      const r = await restGet(null, path);
      expect([200, 401, 403]).toContain(r.status);
      if (r.status === 200) expect(r.body).toEqual([]);
    }
  });
});
