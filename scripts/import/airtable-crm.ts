/**
 * Part A · Airtable history → the CRM (brief §4, Tom's R1–R11).
 *
 *   set -a; source .env.test.local; set +a
 *   npx tsx scripts/import/airtable-crm.ts check  docs/imports/airtable-crm-import
 *   npx tsx scripts/import/airtable-crm.ts import docs/imports/airtable-crm-import [--import-name airtable-history]
 *   npx tsx scripts/import/airtable-crm.ts purge  [--import-name airtable-history]
 *
 * Order: accounts → properties → contacts → estimates → jobs → events →
 * follow-ups → facts. One Postgres transaction per table, so a failure leaves
 * a clean partial to re-run. Every row's stable key (acc_/prop_/est_/job_)
 * is recorded in crm_import_keys; a re-run finds its rows there, updates only
 * what differs, and inserts nothing twice. Events dedupe on their own key.
 *
 * The estimate triggers that would corrupt history (estimate_accepted at
 * now(); a lost customer re-opened by their own old estimate) are switched
 * off for the transaction with set_config('crm.import', 'on', true) —
 * migration 20270152. Everything else (identity sync, the primary-contact
 * mirror, the facts staleness marks) stays on.
 *
 * Runs against Postgres directly (pg) for the transactions, and through the
 * REST API for the facts rebuild — both must name the same project
 * (scripts/import/target.ts). Production needs IMPORT_ALLOW_PRODUCTION=1.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { parseCsv } from "../../lib/import/csv";
import { addressKey } from "../../lib/accounts/identity";
import { refreshAccountFacts } from "../../lib/crm/facts";
import {
  mapEstimateStatus, mapEvent, mapJobStatus, mapLevelOfFinish, mapLostReason, mapRelationshipState, mapSizeBand, mapTags, mapTemperature,
} from "../../lib/import/airtable/mapping";
import { resolveImportTarget } from "./target";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const [cmd, dirArg] = positional;
const IMPORT = flag("--import-name") ?? "airtable-history";

type Row = Record<string, string>;
type Stats = { inserted: number; updated: number; unchanged: number; attached: number; skipped: number; notes: string[] };
const stats = (): Stats => ({ inserted: 0, updated: 0, unchanged: 0, attached: 0, skipped: 0, notes: [] });
const report: Record<string, Stats> = {};

function usage(): never {
  console.error("usage: airtable-crm.ts check <dir> | import <dir> [--import-name x] | purge [--import-name x]");
  process.exit(1);
}

const nz = (s: string | undefined): string | null => (s && s.trim() ? s.trim() : null);
const ts = (s: string | undefined): string | null => {
  const v = nz(s);
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`bad timestamp "${v}"`);
  return d.toISOString();
};
const cents = (s: string | undefined): number | null => {
  const v = nz(s);
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`bad cents "${v}"`);
  return n;
};
const num = (s: string | undefined): number | null => {
  const v = nz(s);
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`bad number "${v}"`);
  return n;
};

// ---- the pack ------------------------------------------------------------------
type Pack = {
  accounts: Row[]; contacts: Row[]; properties: Row[]; estimates: Row[]; jobs: Row[]; events: Row[];
  summary: Record<string, unknown> | null;
};
function loadPack(dir: string): Pack {
  const read = (name: string, required = true): Row[] => {
    const p = resolve(dir, name);
    if (!existsSync(p)) { if (required) throw new Error(`${dir}/${name} is missing`); return []; }
    return parseCsv(readFileSync(p, "utf8"));
  };
  const summaryPath = resolve(dir, "summary.json");
  return {
    accounts: read("accounts.csv"), contacts: read("account_contacts.csv", false), properties: read("properties.csv"),
    estimates: read("estimates.csv"), jobs: read("jobs.csv", false), events: read("crm_events.csv"),
    summary: existsSync(summaryPath) ? (JSON.parse(readFileSync(summaryPath, "utf8")) as Record<string, unknown>) : null,
  };
}

/** A note whose text is blank is not a fact — it is skipped and reported, never written. */
const emptyNote = (ev: Row): boolean => {
  if (ev.type !== "note") return false;
  const p = JSON.parse(ev.payload) as { text?: unknown };
  return !(typeof p.text === "string" && p.text.trim());
};

/** Everything the pack says, checked before a single row is written. */
function validate(pack: Pack): void {
  const accKeys = new Set(pack.accounts.map((r) => r.account_key));
  const propKeys = new Set(pack.properties.map((r) => r.property_key));
  const estKeys = new Set(pack.estimates.map((r) => r.estimate_key));
  const dup = (rows: Row[], k: string) => { const seen = new Set<string>(); for (const r of rows) { if (seen.has(r[k])) throw new Error(`duplicate ${k} ${r[k]}`); seen.add(r[k]); } };
  dup(pack.accounts, "account_key"); dup(pack.properties, "property_key"); dup(pack.estimates, "estimate_key"); dup(pack.jobs, "job_key"); dup(pack.events, "event_key");
  for (const a of pack.accounts) {
    mapRelationshipState(a.relationship_state); mapLostReason(a.lost_reason); mapTemperature(a.temperature); mapTags(a.tags);
    if (a.relationship_state === "lost" && !a.lost_reason) throw new Error(`${a.account_key}: lost with no reason`);
    if (!nz(a.email) && !nz(a.phone_e164)) stats(); // reachability: reported at load, not fatal here
    ts(a.first_seen_at);
  }
  for (const p of pack.properties) if (!accKeys.has(p.account_key)) throw new Error(`${p.property_key}: unknown account ${p.account_key}`);
  for (const e of pack.estimates) {
    if (!accKeys.has(e.account_key)) throw new Error(`${e.estimate_key}: unknown account`);
    if (e.property_key && !propKeys.has(e.property_key)) throw new Error(`${e.estimate_key}: unknown property`);
    const status = mapEstimateStatus(e.status);
    mapLevelOfFinish(e.level_of_finish, status); mapSizeBand(e.size_band);
    // A draft may carry no figure yet (230 do); anything sent has one.
    if (status !== "draft" && (cents(e.total_cents) == null || cents(e.subtotal_cents) == null)) throw new Error(`${e.estimate_key}: money missing`);
    if (status !== "draft" && !ts(e.sent_at)) throw new Error(`${e.estimate_key}: ${status} without sent_at`);
    ts(e.created_at); ts(e.accepted_at); ts(e.declined_at);
  }
  for (const j of pack.jobs) {
    if (!accKeys.has(j.account_key)) throw new Error(`${j.job_key}: unknown account`);
    if (j.estimate_key && !estKeys.has(j.estimate_key)) throw new Error(`${j.job_key}: unknown estimate`);
    mapJobStatus(j.status);
  }
  for (const ev of pack.events) {
    if (!accKeys.has(ev.account_key)) throw new Error(`${ev.event_key}: unknown account`);
    if (ev.estimate_key && !estKeys.has(ev.estimate_key)) throw new Error(`${ev.event_key}: unknown estimate`);
    if (ev.source !== "airtable_import") throw new Error(`${ev.event_key}: source ${ev.source}`);
    if (!emptyNote(ev)) mapEvent(ev.type, JSON.parse(ev.payload) as Record<string, unknown>);
    ts(ev.occurred_at);
  }
  const s = pack.summary;
  if (s) {
    const want = (k: string, n: number) => { if (typeof s[k] === "number" && s[k] !== n) throw new Error(`summary.json says ${k}=${String(s[k])}, the CSV has ${n}`); };
    want("accounts", pack.accounts.length); want("properties", pack.properties.length); want("estimates", pack.estimates.length); want("jobs", pack.jobs.length); want("events", pack.events.length);
  }
}

// ---- the load -------------------------------------------------------------------
type Db = pg.Client;
const keyMap = new Map<string, string>(); // import key → uuid

async function loadKeyMap(db: Db) {
  const r = await db.query<{ key: string; row_id: string; table_name: string }>("select key, row_id, table_name from public.crm_import_keys where import = $1", [IMPORT]);
  for (const row of r.rows) keyMap.set(row.key, row.row_id);
}
async function remember(db: Db, key: string, table: string, id: string) {
  await db.query("insert into public.crm_import_keys (import, key, table_name, row_id) values ($1,$2,$3,$4) on conflict (import, key) do nothing", [IMPORT, key, table, id]);
  keyMap.set(key, id);
}
async function tx(db: Db, name: string, fn: () => Promise<void>) {
  await db.query("begin");
  try {
    await db.query("select set_config('crm.import', 'on', true)");
    await fn();
    await db.query("commit");
    const s = report[name];
    console.log(`${name.padEnd(11)} inserted ${s.inserted}  updated ${s.updated}  unchanged ${s.unchanged}${s.attached ? `  attached ${s.attached}` : ""}${s.skipped ? `  skipped ${s.skipped}` : ""}`);
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Update only the columns whose value differs; count it honestly. */
async function patchIfChanged(db: Db, table: string, id: string, want: Record<string, unknown>, s: Stats) {
  const cols = Object.keys(want);
  const cur = await db.query(`select ${cols.map((c) => `"${c}"`).join(", ")} from public.${table} where id = $1`, [id]);
  const row = cur.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`${table} ${id} vanished`);
  const diff = cols.filter((c) => JSON.stringify(normalise(row[c])) !== JSON.stringify(normalise(want[c])));
  if (diff.length === 0) { s.unchanged++; return; }
  await db.query(`update public.${table} set ${diff.map((c, i) => `"${c}" = $${i + 2}`).join(", ")} where id = $1`, [id, ...diff.map((c) => want[c])]);
  s.updated++;
}
/** A canonical form so "changed" means changed: jsonb comes back with its own
 *  key order, timestamps as Date, numerics as text. */
const normalise = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString();
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(normalise).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, normalise(o[k])]));
  }
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) return Number(v); // numeric(8,2) → "18.50"
  if (typeof v === "number") return v;
  return v;
};

async function loadAccounts(db: Db, pack: Pack) {
  const s = (report.accounts = stats());
  for (const a of pack.accounts) {
    const email = nz(a.email)?.toLowerCase() ?? null;
    const phone = nz(a.phone_e164);
    if (!email && !phone) { s.skipped++; s.notes.push(`${a.account_key} (${a.name}): no email and no phone — accounts_reachable forbids it; left in exceptions`); continue; }
    const lost = mapLostReason(a.lost_reason);
    const state = mapRelationshipState(a.relationship_state);
    const want = {
      name: nz(a.name), phone, company_name: nz(a.company_name),
      relationship_state: state, lost_reason: state === "lost" ? lost?.lostReason ?? null : null,
      state_note: state === "lost" ? lost?.stateNote ?? null : null,
      temperature: mapTemperature(a.temperature), tags: mapTags(a.tags),
      external_ref: { account_key: a.account_key, lead_source: nz(a.lead_source), account_type_reason: nz(a.account_type_reason), other_phones: nz(a.other_phones), origin: "airtable" },
    };
    const known = keyMap.get(a.account_key);
    if (known) {
      // A re-run refreshes the provenance and fills blanks; it never blanks a
      // value another source filled (Part B fills a phone from PaintScout) and
      // never touches the office's dimensions — temperature, relationship
      // state, tags and the follow-up are the CRM's the moment they land.
      const cur = await db.query<{ name: string | null; phone: string | null; company_name: string | null }>("select name, phone, company_name from public.accounts where id = $1", [known]);
      const row = cur.rows[0];
      await patchIfChanged(db, "accounts", known, {
        external_ref: want.external_ref,
        name: row.name ?? want.name, phone: row.phone ?? want.phone, company_name: row.company_name ?? want.company_name,
      }, s);
      continue;
    }
    // A customer who has since used the platform: attach, never duplicate (§4.3).
    const existing = email
      ? await db.query<{ id: string }>("select id from public.accounts where lower(email) = $1", [email])
      : await db.query<{ id: string }>("select id from public.accounts where phone_e164 = $1 and email is null", [phone]);
    if (existing.rows[0]) {
      await remember(db, a.account_key, "accounts:attached", existing.rows[0].id);
      s.attached++; s.notes.push(`${a.account_key} attached to existing account ${existing.rows[0].id} (${email ?? phone})`);
      continue;
    }
    const ins = await db.query<{ id: string; phone_e164: string | null }>(
      `insert into public.accounts (account_type, email, phone, name, company_name, relationship_state, lost_reason, state_note, state_reason, state_set_at,
         temperature, temperature_set_at, tags, source, external_ref, created_at)
       values ('residential', $1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text,
         case when $5::text = 'lost' then 'Imported from Airtable' end, case when $5::text = 'lost' then $10::timestamptz end,
         $8::text, case when $8::text is not null then $10::timestamptz end, $9::text[], 'airtable', $11::jsonb, $10::timestamptz) returning id, phone_e164`,
      [email, phone, want.name, want.company_name, want.relationship_state, want.lost_reason, want.state_note, want.temperature, want.tags, ts(a.first_seen_at), want.external_ref],
    );
    const row = ins.rows[0];
    if (phone && row.phone_e164 !== phone) throw new Error(`${a.account_key}: the database normalised ${phone} to ${row.phone_e164 ?? "null"}`);
    await remember(db, a.account_key, "accounts", row.id);
    s.inserted++;
  }
}

async function loadProperties(db: Db, pack: Pack) {
  const s = (report.properties = stats());
  const earliest = new Map<string, string>();
  for (const e of pack.estimates) {
    const at = ts(e.created_at) ?? ts(e.sent_at);
    if (!at || !e.property_key) continue;
    const have = earliest.get(e.property_key);
    if (!have || at < have) earliest.set(e.property_key, at);
  }
  for (const p of pack.properties) {
    const accountId = keyMap.get(p.account_key);
    if (!accountId) { s.skipped++; continue; } // its account was unreachable
    const key = addressKey({ street: p.address, suburb: p.suburb, postcode: p.postcode });
    const want = {
      address: nz(p.address), suburb: nz(p.suburb), state: nz(p.state) ?? "VIC", postcode: nz(p.postcode), type: nz(p.type),
      external_ref: { property_key: p.property_key, address_norm_airtable: p.address_norm, airtable_refs: nz(p.airtable_refs), origin: "airtable" },
    };
    const known = keyMap.get(p.property_key);
    if (known) { await patchIfChanged(db, "properties", known, want, s); continue; }
    const found = key
      ? await db.query<{ id: string }>("select id from public.properties where account_id = $1 and address_norm = $2", [accountId, key])
      : { rows: [] as { id: string }[] };
    if (found.rows[0]) {
      await remember(db, p.property_key, "properties:attached", found.rows[0].id);
      s.attached++;
      continue;
    }
    const ins = await db.query<{ id: string }>(
      `insert into public.properties (account_id, address, suburb, state, postcode, type, address_norm, source, external_ref, created_at)
       values ($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,'airtable',$8::jsonb,$9::timestamptz) returning id`,
      [accountId, want.address, want.suburb, want.state, want.postcode, want.type, key, want.external_ref, earliest.get(p.property_key) ?? ts(pack.accounts.find((a) => a.account_key === p.account_key)?.first_seen_at) ?? new Date().toISOString()],
    );
    await remember(db, p.property_key, "properties", ins.rows[0].id);
    s.inserted++;
  }
}

async function loadContacts(db: Db, pack: Pack) {
  const s = (report.contacts = stats());
  for (const c of pack.contacts) {
    const accountId = keyMap.get(c.account_key);
    const name = nz(c.name);
    if (!accountId || !name) { s.skipped++; continue; }
    const have = await db.query<{ id: string }>("select id from public.account_contacts where account_id = $1 and lower(name) = lower($2)", [accountId, name]);
    if (have.rows[0]) { s.unchanged++; continue; }
    await db.query(
      "insert into public.account_contacts (account_id, name, role, email, phone, is_primary, notes) values ($1::uuid,$2::text,$3::text,$4::text,$5::text,false,$6::text)",
      [accountId, name, nz(c.role) ?? "other", nz(c.email)?.toLowerCase() ?? null, nz(c.phone), nz(c.notes)],
    );
    s.inserted++;
  }
}

async function loadEstimates(db: Db, pack: Pack) {
  const s = (report.estimates = stats());
  const addrOf = new Map(pack.properties.map((p) => [p.property_key, [p.address, p.suburb].filter((x) => nz(x)).join(", ")]));
  for (const e of pack.estimates) {
    const accountId = keyMap.get(e.account_key);
    if (!accountId) { s.skipped++; continue; }
    const status = mapEstimateStatus(e.status);
    const propertyId = e.property_key ? keyMap.get(e.property_key) ?? null : null;
    const sentAt = ts(e.sent_at);
    const createdAt = ts(e.created_at) ?? sentAt ?? new Date().toISOString();
    const want = {
      account_id: accountId, property_id: propertyId, title: addrOf.get(e.property_key) || nz(e.quote_number) || "Imported estimate",
      status, level_of_finish: mapLevelOfFinish(e.level_of_finish, status), size_band: mapSizeBand(e.size_band),
      // estimates.subtotal_cents / total_cents are NOT NULL; a draft with no figure is $0.
      subtotal_cents: cents(e.subtotal_cents) ?? 0, total_cents: cents(e.total_cents) ?? 0,
      accepted_total_cents: status === "accepted" ? cents(e.total_cents) : null,
      sent_at: sentAt, accepted_at: ts(e.accepted_at), declined_at: ts(e.declined_at),
      external_ref: {
        airtable_id: nz(e.airtable_id), quote_number: nz(e.quote_number), quote_url: nz(e.quote_url), work_order_url: nz(e.work_order_url),
        quote_type: nz(e.quote_type), airtable_status: nz(e.airtable_status), project_status: nz(e.project_status),
        date_confidence: nz(e.date_confidence) ?? "high", level_of_finish_assumed: e.level_of_finish_assumed === "yes",
        estimated_hours: num(e.estimated_hours), estimated_materials: nz(e.estimated_materials), lead_source: nz(e.lead_source),
        follow_up_date: nz(e.follow_up_date), estimate_key: e.estimate_key, origin: "airtable",
      },
    };
    const known = keyMap.get(e.estimate_key);
    if (known) { await patchIfChanged(db, "estimates", known, want, s); continue; }
    const updatedAt = want.accepted_at ?? want.declined_at ?? sentAt ?? createdAt;
    const ins = await db.query<{ id: string }>(
      `insert into public.estimates (account_id, property_id, title, status, level_of_finish, size_band, subtotal_cents, total_cents, accepted_total_cents,
         sent_at, accepted_at, declined_at, source, external_ref, builder_state, created_at, updated_at, job_kind)
       values ($1::uuid,$2::uuid,$3::text,$4::public.estimate_status,$5::smallint,$6::text,$7::integer,$8::integer,$9::integer,
         $10::timestamptz,$11::timestamptz,$12::timestamptz,'airtable',$13::jsonb,'{}'::jsonb,$14::timestamptz,$15::timestamptz,'residential') returning id`,
      [want.account_id, want.property_id, want.title, want.status, want.level_of_finish, want.size_band, want.subtotal_cents, want.total_cents, want.accepted_total_cents,
        want.sent_at, want.accepted_at, want.declined_at, want.external_ref, createdAt, updatedAt],
    );
    await remember(db, e.estimate_key, "estimates", ins.rows[0].id);
    s.inserted++;
  }
}

async function loadJobs(db: Db, pack: Pack) {
  const s = (report.jobs = stats());
  for (const j of pack.jobs) {
    const accountId = keyMap.get(j.account_key);
    if (!accountId) { s.skipped++; continue; }
    const want = {
      account_id: accountId, estimate_id: j.estimate_key ? keyMap.get(j.estimate_key) ?? null : null, property_id: j.property_key ? keyMap.get(j.property_key) ?? null : null,
      quote_url: nz(j.quote_url), work_order_url: nz(j.work_order_url), quote_number: nz(j.quote_number), project_name: nz(j.project_name), job_type: nz(j.job_type),
      level_of_finish: num(j.level_of_finish), status: mapJobStatus(j.status), accepted_at: ts(j.date_accepted),
      start_date: nz(j.start_date), end_date: nz(j.end_date),
      invoice_total_cents: cents(j.invoice_total_cents), gst_cents: cents(j.gst_cents),
      estimated_hours: num(j.estimated_hours), actual_hours: num(j.actual_hours),
      estimated_materials_cents: cents(j.estimated_materials_cents), actual_materials_cents: cents(j.actual_materials_cents),
      contractor_offer_cents: cents(j.contractor_offer_cents), contractor_invoiced_cents: cents(j.contractor_invoiced_cents),
      workers: num(j.workers), notes: nz(j.notes),
      external_ref: { job_key: j.job_key, airtable_id: nz(j.airtable_id), airtable_status: nz(j.airtable_status), matched_by: nz(j.matched_by), origin: "airtable" },
    };
    const known = keyMap.get(j.job_key);
    if (known) { await patchIfChanged(db, "crm_jobs", known, want, s); continue; }
    const cols = Object.keys(want);
    const ins = await db.query<{ id: string }>(
      `insert into public.crm_jobs (${cols.join(", ")}, source) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}, 'airtable') returning id`,
      cols.map((c) => (want as Record<string, unknown>)[c]),
    );
    await remember(db, j.job_key, "crm_jobs", ins.rows[0].id);
    s.inserted++;
  }
}

async function loadEvents(db: Db, pack: Pack) {
  const s = (report.events = stats());
  const BATCH = 500;
  for (let i = 0; i < pack.events.length; i += BATCH) {
    const chunk = pack.events.slice(i, i + BATCH);
    for (const ev of chunk) if (emptyNote(ev)) s.notes.push(`${ev.event_key}: note with no text — skipped`);
    const slice = chunk.filter((ev) => keyMap.get(ev.account_key) && !emptyNote(ev));
    s.skipped += chunk.length - slice.length;
    if (slice.length === 0) continue;
    const mapped = slice.map((ev) => {
      const m = mapEvent(ev.type, JSON.parse(ev.payload) as Record<string, unknown>);
      return {
        account: keyMap.get(ev.account_key)!, estimate: ev.estimate_key ? keyMap.get(ev.estimate_key) ?? null : null,
        property: ev.property_key ? keyMap.get(ev.property_key) ?? null : null,
        type: m.type, payload: JSON.stringify(m.payload), at: ts(ev.occurred_at)!, key: ev.event_key,
      };
    });
    // The 20270121 backfill pattern: a direct insert with the dedupe key —
    // idempotent, and the only way a historical occurred_at gets written.
    const r = await db.query(
      `insert into public.crm_events (account_id, estimate_id, property_id, type, source, payload, occurred_at, dedupe_key)
       select a, e, p, t, 'airtable_import', pl::jsonb, at, k
         from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::timestamptz[], $7::text[]) as x(a, e, p, t, pl, at, k)
       on conflict (dedupe_key) where dedupe_key is not null do nothing`,
      [mapped.map((m) => m.account), mapped.map((m) => m.estimate), mapped.map((m) => m.property), mapped.map((m) => m.type), mapped.map((m) => m.payload), mapped.map((m) => m.at), mapped.map((m) => m.key)],
    );
    s.inserted += r.rowCount ?? 0;
    s.unchanged += mapped.length - (r.rowCount ?? 0);
  }
}

/** R9: the open follow-ups become the account's follow-up (the platform's
 *  task) — only where nobody here has set one already. */
async function loadFollowups(db: Db, pack: Pack, today: string) {
  const s = (report.followups = stats());
  const byAccount = new Map<string, { date: string; quote: string }>();
  for (const e of pack.estimates) {
    const d = nz(e.follow_up_date);
    if (!d || d < today) continue;
    const have = byAccount.get(e.account_key);
    if (!have || d < have.date) byAccount.set(e.account_key, { date: d, quote: nz(e.quote_number) ?? "" });
  }
  for (const [accKey, f] of byAccount) {
    const accountId = keyMap.get(accKey);
    if (!accountId) { s.skipped++; continue; }
    const r = await db.query(
      `update public.accounts set followup_due_at = ($2::date::timestamp at time zone 'Australia/Melbourne') + interval '9 hours',
         followup_note = $3 where id = $1 and followup_due_at is null`,
      [accountId, f.date, `Follow up (from Airtable${f.quote ? `, quote ${f.quote}` : ""})`],
    );
    if (r.rowCount) s.inserted++; else s.unchanged++;
  }
}

async function purge(db: Db) {
  const keys = await db.query<{ key: string; table_name: string; row_id: string }>("select key, table_name, row_id from public.crm_import_keys where import = $1", [IMPORT]);
  const ids = (t: string) => keys.rows.filter((k) => k.table_name === t).map((k) => k.row_id);
  const accounts = ids("accounts");
  const attached = ids("accounts:attached");
  await db.query("begin");
  try {
    await db.query("select set_config('crm.import', 'on', true)");
    await db.query("delete from public.crm_events where source = 'airtable_import' and account_id = any($1::uuid[])", [[...accounts, ...attached]]);
    await db.query("delete from public.crm_jobs where id = any($1::uuid[])", [ids("crm_jobs")]);
    await db.query("delete from public.estimates where id = any($1::uuid[])", [ids("estimates")]);
    await db.query("delete from public.account_contacts where account_id = any($1::uuid[]) and is_primary = false and notes like 'Name seen on an Airtable%'", [[...accounts, ...attached]]);
    await db.query("delete from public.properties where id = any($1::uuid[])", [ids("properties")]);
    // Accounts THIS import created go with everything hanging off them — a
    // later run may have attached its own rows to them (the e2e does).
    await db.query("delete from public.invoices where account_id = any($1::uuid[]) or estimate_id in (select id from public.estimates where account_id = any($1::uuid[]))", [accounts]);
    await db.query("delete from public.estimates where account_id = any($1::uuid[])", [accounts]);
    await db.query("delete from public.crm_jobs where account_id = any($1::uuid[])", [accounts]);
    await db.query("delete from public.properties where account_id = any($1::uuid[])", [accounts]);
    await db.query("delete from public.accounts where id = any($1::uuid[])", [accounts]);
    await db.query("delete from public.crm_import_keys where import = $1", [IMPORT]);
    await db.query("commit");
    console.log(`purged ${IMPORT}: ${accounts.length} accounts, ${ids("estimates").length} estimates, ${ids("crm_jobs").length} jobs (+ their events); ${attached.length} pre-existing accounts kept`);
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  }
}

async function main() {
  if (!cmd) usage();
  // `date` columns come back as text, not a JS Date at local midnight — the
  // re-run compare must see "2025-07-14", not a shifted timestamp.
  pg.types.setTypeParser(1082, (v: string) => v);
  const target = resolveImportTarget("airtable-crm.ts", { needsDatabase: true });
  const db = new pg.Client({ connectionString: target.databaseUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    if (cmd === "purge") { await purge(db); return; }
    if ((cmd !== "check" && cmd !== "import") || !dirArg) usage();
    const pack = loadPack(dirArg);
    validate(pack);
    console.log(`pack ok: ${pack.accounts.length} accounts, ${pack.properties.length} properties, ${pack.contacts.length} contacts, ${pack.estimates.length} estimates, ${pack.jobs.length} jobs, ${pack.events.length} events`);
    if (cmd === "check") return;

    await loadKeyMap(db);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await tx(db, "accounts", () => loadAccounts(db, pack));
    await tx(db, "properties", () => loadProperties(db, pack));
    await tx(db, "contacts", () => loadContacts(db, pack));
    await tx(db, "estimates", () => loadEstimates(db, pack));
    await tx(db, "jobs", () => loadJobs(db, pack));
    await tx(db, "events", () => loadEvents(db, pack));
    await tx(db, "followups", () => loadFollowups(db, pack, today));

    // Facts are DERIVED: rebuild for every account the import touched.
    const rest = createClient(target.url, target.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const touched = [...new Set(pack.accounts.map((a) => keyMap.get(a.account_key)).filter((x): x is string => !!x))];
    const refreshed = await refreshAccountFacts(rest, touched);
    console.log(`facts       rebuilt for ${refreshed} accounts`);

    for (const [name, s] of Object.entries(report)) for (const n of s.notes) console.log(`  ${name}: ${n}`);
    const out = flag("--report") ?? resolve(dirArg, `import-report-${IMPORT}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(out, JSON.stringify({ import: IMPORT, target: target.ref, at: new Date().toISOString(), report }, null, 2));
    console.log(`report → ${out}`);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
