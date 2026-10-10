// READ ONLY (11 Oct 2026): what "Create a trade account" did to an existing
// customer account it matched by PHONE (info@modvs.com → the
// tjhroman+crm.ashwood account). Usage, from the main checkout:
//   node scripts/diag/trade-takeover.mjs tjhroman+crm.ashwood@gmail.com 2026-10-11
// Prints the account, every seat on it with the login's email and when it was
// added, what else hangs off the account (so you can tell its original name),
// and the repair SQL with the ids filled in. It changes nothing.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [email, since] = process.argv.slice(2).map((s) => (s ?? "").trim());
if (!email || !/^\d{4}-\d{2}-\d{2}$/.test(since ?? "")) { console.error("usage: node scripts/diag/trade-takeover.mjs <account email> <YYYY-MM-DD the demo was made>"); process.exit(1); }
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

const accts = must(await db.from("accounts").select("*").ilike("email", email), "accounts") ?? [];
if (accts.length !== 1) { console.error(`expected ONE account with email ${email}, found ${accts.length} — stopping.`); process.exit(1); }
const a = accts[0];
console.log(`\naccount ${a.id}`);
for (const k of ["email", "name", "phone", "account_type", "org_kind", "flags", "created_at", "updated_at"]) if (k in a) console.log(`  ${k}: ${JSON.stringify(a[k])}`);

const seats = must(await db.from("account_users").select("id, profile_id, role, created_at").eq("account_id", a.id).order("created_at"), "account_users") ?? [];
console.log(`\nseats (${seats.length}):`);
const added = [];
for (const s of seats) {
  const u = await db.auth.admin.getUserById(s.profile_id);
  if (u.error) throw new Error(`getUserById ${s.profile_id}: ${u.error.message}`);
  const isNew = String(s.created_at) >= since;
  if (isNew) added.push(s);
  console.log(`  ${s.role.padEnd(8)} ${u.data.user?.email ?? "(no email)"} · added ${String(s.created_at).slice(0, 16)}${isNew ? "   ← added on/after " + since : ""}`);
}

const ests = must(await db.from("estimates").select("number, title, status, created_at").eq("account_id", a.id).order("created_at", { ascending: false }).limit(5), "estimates") ?? [];
const props = must(await db.from("properties").select("address, suburb").eq("account_id", a.id).limit(5), "properties") ?? [];
const contacts = must(await db.from("account_contacts").select("name, email, phone").eq("account_id", a.id).limit(5), "account_contacts") ?? [];
console.log(`\nestimates: ${ests.length ? ests.map((e) => `${e.number ?? "?"} "${e.title}" ${e.status}`).join(" · ") : "none"}`);
console.log(`properties: ${props.length ? props.map((p) => `${p.address}, ${p.suburb}`).join(" · ") : "none"}`);
console.log(`contacts: ${contacts.length ? contacts.map((c) => `${c.name ?? "?"} ${c.email ?? ""} ${c.phone ?? ""}`).join(" · ") : "none"}`);

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
console.log(`
---- repair SQL (review, put the original name in, then paste in the SQL editor) ----
set lock_timeout = '15s';
begin;
-- the seats the demo put on this account (${added.length})
delete from public.account_users where account_id = ${q(a.id)} and created_at >= ${q(since)};
-- back to a customer account, under its own name
update public.accounts set account_type = 'residential', name = <ORIGINAL NAME, e.g. 'Ashwood'> where id = ${q(a.id)};
commit;
select account_type, name, (select count(*) from public.account_users u where u.account_id = a.id) as seats
  from public.accounts a where id = ${q(a.id)};
-- _expect_: residential · the original name · ${seats.length - added.length} seats
`);
