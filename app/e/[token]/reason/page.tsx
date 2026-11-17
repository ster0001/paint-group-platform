import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DECLINE_REASON_CODES, isDeclineReasonCode } from "@/lib/estimate/declineReason";
import type { CustomerSnapshot } from "@/lib/customer/snapshot";
import ReasonConfirm from "./ReasonConfirm";

export const dynamic = "force-dynamic";

/**
 * E11 (17 Nov 2026): the page a decline-reason chip opens. It asks once and
 * records nothing until the customer taps — an email link scanner opening
 * every chip must not choose a reason. Unknown token or chip → 404, exactly as
 * the estimate itself.
 */
export default async function DeclineReasonPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ r?: string }> }) {
  const { token } = await params;
  const { r } = await searchParams;
  if (!isDeclineReasonCode(r)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_estimate_by_token", { p_token: token });
  const row = (Array.isArray(data) ? data[0] : data) as { snapshot?: CustomerSnapshot } | undefined;
  if (error || !row || !row.snapshot) notFound();
  const chip = DECLINE_REASON_CODES[r].chip;
  return (
    <div className="docpage" data-testid="decline-reason">
      <header className="dochead">
        <div className="brandline">{row.snapshot.company?.name || "Paint Group"}</div>
        <h1>Thanks for letting us know</h1>
        <p className="docmeta">{row.snapshot.jobAddress || "Your quote"}</p>
      </header>
      <p>So we can improve: was it <b>{chip.toLowerCase()}</b>?</p>
      <ReasonConfirm token={token} code={r} chip={chip} />
      <p className="viewnote"><a href={`/e/${token}`}>← Back to your quote</a></p>
    </div>
  );
}
