import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { wizardBrand, wizardTitle } from "@/lib/wizard/brandServer";
import { createServiceClient } from "@/lib/supabase/service";
import { customerOwnsDraft, getWizardActor } from "@/lib/supabase/guards";
import { loadCustomerScope, type EstimateRow } from "@/lib/wizard/customer-scope";
import { quoteStageV10On } from "@/lib/wizard/ui-flags";
import { getCompanyContact } from "@/lib/portal/data";
import Wordmark from "@/app/wizard/Wordmark";
import QuoteStage from "./QuoteStage";
import "../../wizard/wizard.css";

/**
 * /estimate/quote?id=… — QUOTE STAGE v10: "Get my detailed price"
 * (`docs/briefs/claude-code-brief-quote-stage-v10.md`). One card per question
 * on the v5 shell, writing the same `wizard-edit` actions the scope page
 * writes (R0). The same guards as `/estimate/scope`: a customer opens only
 * their own draft, staff can preview. Behind `quoteStageV10On()` — off, it
 * sends the link to the scope page it replaces. Session 1: the rooms bundle
 * (an interior job); sides go to the sides editor until session 6.
 */
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: await wizardTitle("Your detailed price"), robots: { index: false, follow: false } };
}

async function Holding({ line }: { line: string }) {
  const [company, brand] = await Promise.all([getCompanyContact(), wizardBrand()]);
  return (
    <div className="wz">
      <header className="wz-top"><Wordmark logoUrl={company.logoUrl} brand={brand} /></header>
      <div className="wz-wrap" style={{ textAlign: "center", paddingTop: 80 }}><h1>{line}</h1></div>
    </div>
  );
}

export default async function QuoteStagePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (!id) return <Holding line="That link is missing its estimate." />;
  if (!quoteStageV10On()) redirect(`/estimate/scope?id=${encodeURIComponent(id)}`);

  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return <Holding line="Open your estimate from the link we sent you." />;
  const db = actor.kind === "customer" ? createServiceClient() : supabase;
  if (!db) return <Holding line="Your detailed price isn't available just now — please try again shortly." />;

  const { data: estimate, error } = await db
    .from("estimates")
    .select("id, status, source, created_by, requires_site_check, builder_state, account_id, brand")
    .eq("id", id)
    .maybeSingle();
  if (error) return <Holding line="We couldn't open that estimate just now — please try again shortly." />;
  const own = !estimate ? false : actor.kind !== "customer" || await customerOwnsDraft(db, actor, estimate as EstimateRow);
  if (!estimate || !own) return <Holding line="We couldn't find that estimate." />;
  if (estimate.status === "accepted") return <Holding line="This estimate is accepted — its scope is locked in." />;

  const bundle = await loadCustomerScope(db, estimate as EstimateRow);
  if (bundle.kind === "holding") return <Holding line={bundle.line} />;
  // Session 1 carries the rooms; the sides editor stays the outside's detailed price until session 6.
  if (bundle.kind === "sides") redirect(`/estimate/scope?id=${encodeURIComponent(id)}`);
  const brand = (estimate as { brand?: string | null }).brand === "painthome" ? "painthome" as const : await wizardBrand();
  const loopRooms = bundle.initialInteriorLoop?.rooms ?? [];
  const rooms = bundle.initialRooms.map((r) => {
    const l = loopRooms.find((x) => x.areaId === r.areaId);
    return { areaId: r.areaId, name: r.name, lengthM: l?.lengthM ?? 0, widthM: l?.widthM ?? 0, heightM: l?.heightM ?? 2.4, size: l?.size ?? null, confirmed: l?.confirmed ?? false };
  });
  return (
    <div className="wz">
      <QuoteStage
        brand={brand}
        estimateId={bundle.estimateId}
        initial={bundle.initial}
        initialRooms={rooms}
        initialCornices={bundle.initialCornices}
        initialAccess={bundle.initialAccess}
        logoUrl={bundle.logoUrl}
        estimator={bundle.estimator}
        companyPhone={bundle.companyPhone}
        customerSuburb={bundle.customerSuburb}
      />
    </div>
  );
}
