import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseBackTo } from "@/lib/navigation/backTo";
import { jobMoneyPage } from "@/lib/invoicing/jobMoney";
import { paymentsSettings } from "@/lib/invoicing/settings";
import { melbourneToday } from "@/lib/invoicing/derive";
import { reportError } from "@/lib/monitoring/report";
import ReadFailureNotice from "../../ReadFailureNotice";
import { loadJobMoneyInput } from "../../jobMoneyData";
import { JobPanel } from "../../payments/JobPanel";
import { loadJobPanel } from "../../payments/panelData";
import { PaymentsUiProvider } from "../../payments/ActionsClient";
import { pickerJobs } from "../../payments/labels";
import "../../payments/payments.css";

export const dynamic = "force-dynamic";
/** One-press "✓ Paid" sends its receipt after the Undo window (⚑P2), behind the response. */
export const maxDuration = 60;

type Search = { from?: string; tab?: string; addcost?: string; jt?: string };

/**
 * One job's money (payments-merge brief §4.7, Step 7): the job panel from
 * /invoicing (?job=), full page — the same component, the same figures as
 * the job's row. Reached from PC Command's money strip, the dashboard, and
 * any link outside the Payments page.
 */
export default async function JobMoneyPage({ params, searchParams }: { params: Promise<{ estimateId: string }>; searchParams: Promise<Search> }) {
  const { estimateId } = await params;
  const sp = await searchParams;
  // Tom, 1 Oct: the back link returns to where the job was opened from (with its
  // filters). Validated — `from` comes off the URL.
  const backTo = parseBackTo(sp.from);
  const supabase = await createClient();
  const now = new Date();
  const [{ input, failure }, settingsRes] = await Promise.all([
    loadJobMoneyInput(supabase, now),
    supabase.from("settings").select("key, value").eq("key", "invoicing"),
  ]);
  if (settingsRes.error) reportError(settingsRes.error, { where: "JobMoneyPage.settings", bestEffort: true });
  const settings = paymentsSettings((settingsRes.data ?? []) as { key: string; value: unknown }[]);
  if (!input) {
    const reason = failure ?? { headline: "This job's payments could not be loaded — this is not an empty ledger.", detail: "Reload the page; if it keeps happening, the error has been reported." };
    return <div className="pm"><main className="pm-jobpage"><ReadFailureNotice failure={reason} /></main></div>;
  }
  const page = jobMoneyPage({ ...input, paymentTermsDays: settings.paymentTermsDays });
  const panel = await loadJobPanel(supabase, page, estimateId, now);
  // Every accepted job is in the payments model; anything else has no money to show.
  if (!panel) notFound();

  const addCost = sp.addcost === "1";
  // ?tab=costs is what links written before the panel say (PC Command, emails).
  const tab = addCost || sp.jt === "out" || sp.tab === "costs" ? "out" : "in";
  const self = (t: "in" | "out") => {
    const q = new URLSearchParams();
    if (sp.from && backTo) q.set("from", sp.from);
    if (t === "out") q.set("jt", "out");
    const s = q.toString();
    return `/invoicing/job/${estimateId}${s ? `?${s}` : ""}`;
  };
  return (
    <div className="pm">
      <PaymentsUiProvider settings={{ depositOptionsPct: settings.depositOptionsPct, notifyPaymentDefault: settings.notifyPaymentDefault, today: melbourneToday(now) }}
        jobs={pickerJobs(page.rows)}>
        <main className="pm-jobpage" data-testid="pm-panel">
          <JobPanel d={panel} tab={tab} tabHref={self} closeHref={backTo?.href ?? "/invoicing"}
            closeLabel={backTo ? backTo.label.replace(/^Back to /, "").replace(/^./, (c) => c.toUpperCase()) : "Payments"}
            today={melbourneToday(now)} termsDays={settings.paymentTermsDays} startAddCost={addCost} />
        </main>
      </PaymentsUiProvider>
    </div>
  );
}
