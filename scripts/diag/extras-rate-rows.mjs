// READ ONLY, TEST PROJECT: the extras rate rows the wizard prices (unit + hours).
import { readFileSync } from "node:fs";
import pg from "pg";
const env = Object.fromEntries(readFileSync(".env.test.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const c = new pg.Client({ connectionString: env.C1_DATABASE_URL }); await c.connect();
const r = await c.query(`select ri.* from rate_items ri join rate_cards rc on rc.id = ri.rate_card_id where rc.is_active and (ri.code ilike '%pergola%' or ri.code ilike '%deck%' or ri.code ilike '%hand rail%' or ri.code ilike '%paling%') order by ri.code`);
for (const row of r.rows) console.log(JSON.stringify(row));
await c.end();
