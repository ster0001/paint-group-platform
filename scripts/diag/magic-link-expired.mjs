// READ ONLY (13 Oct 2026): why a customer's "Open my account" link says
// expired. Usage, from the main checkout:
//   node scripts/diag/magic-link-expired.mjs <customer email>
// Prints the auth login, its live one-time tokens, its sessions (every
// session is one redeemed link — a session created seconds after a send, from
// our own server, with the customer still saying "expired", is a scanner),
// the profile and the account seats. It changes nothing.
import { readFileSync } from "node:fs";
import pg from "pg";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email.includes("@")) { console.error("usage: node scripts/diag/magic-link-expired.mjs <email>"); process.exit(1); }
const c = new pg.Client({ connectionString: env.IMPORT_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("begin read only");
const q = async (label, sql, args) => { try { const r = await c.query(sql, args); console.log(`\n== ${label} (${r.rowCount})`); console.table(r.rows); return r.rows; } catch (e) { console.log(`\n== ${label}: ERROR ${e.message}`); await c.query("rollback; begin read only"); return []; } };
const users = await q("auth.users", `select id, email, created_at, email_confirmed_at, last_sign_in_at, confirmation_sent_at, recovery_sent_at, banned_until, is_anonymous from auth.users where lower(email) = $1`, [email]);
const ids = users.map((u) => u.id);
await q("one_time_tokens", `select token_type, created_at, updated_at, relates_to from auth.one_time_tokens where user_id = any($1::uuid[]) order by created_at`, [ids]);
await q("sessions (one per redeemed link)", `select created_at, refreshed_at, user_agent from auth.sessions where user_id = any($1::uuid[]) order by created_at`, [ids]);
await q("profiles", `select id, role, name from public.profiles where id = any($1::uuid[])`, [ids]);
await q("accounts", `select id, email, name, account_type, created_at from public.accounts where lower(email) = $1`, [email]);
await q("account_users", `select au.* from public.account_users au join public.accounts a on a.id = au.account_id where lower(a.email) = $1`, [email]);
await c.query("rollback");
await c.end();
