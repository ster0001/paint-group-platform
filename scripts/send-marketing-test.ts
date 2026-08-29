/**
 * Send one campaign template to one address, as a test.
 *
 * A script rather than a click, for the case the studio's button cannot cover:
 * proving delivery to an address that is not the signed-in user's. Refuses to
 * run without an explicit recipient, so it can never quietly mail a list.
 *
 *   npx tsx scripts/send-marketing-test.ts you@example.com
 */
import { readFileSync } from "node:fs";
import { sendCampaignEmail } from "../lib/campaigns/send";
import { templateSchema } from "../lib/campaigns/blocks";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }),
);
for (const [k, v] of Object.entries(env)) process.env[k] = v as string;

async function main() {
const to = process.argv[2];
if (!to) { console.error("Who to? npx tsx scripts/send-marketing-test.ts you@example.com"); process.exit(1); }

const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const [row] = await (await fetch(`${base}/rest/v1/campaign_templates?select=id,subject,preheader,blocks&order=updated_at.desc&limit=1`, { headers })).json();
if (!row) { console.error("No templates to send."); process.exit(1); }

const parsed = templateSchema.safeParse({ subject: row.subject, preheader: row.preheader ?? "", blocks: row.blocks });
if (!parsed.success) { console.error("That template isn't valid."); process.exit(1); }

const [account] = await (await fetch(`${base}/rest/v1/accounts?select=id&email=eq.${encodeURIComponent(to.toLowerCase())}`, { headers })).json();

const result = await sendCampaignEmail({
  to,
  accountId: account?.id ?? "00000000-0000-0000-0000-000000000000",
  template: parsed.data,
  brand: { companyName: "Paint Group" },
  isTest: true,
});
console.log(`"${parsed.data.subject}" → ${to}:`, JSON.stringify(result));
}

main().catch((e) => { console.error(e); process.exit(1); });
