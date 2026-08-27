// Ops tool: force a Google Calendar reconcile for one contractor against the
// live DB (uses SUPABASE_SERVICE_ROLE_KEY + GOOGLE_* from .env.local).
//   npx tsx --env-file=.env.local scripts/gcal-sync-contractor.ts <contractor_id>
import { reconcileContractorCalendar } from "../lib/gcal/sync";

const id = process.argv[2];
if (!id) {
  console.error("usage: npx tsx --env-file=.env.local scripts/gcal-sync-contractor.ts <contractor_id>");
  process.exit(1);
}
reconcileContractorCalendar(id).then((r) => {
  console.log(JSON.stringify(r));
  process.exit(r.status === "synced" ? 0 : 1);
});
