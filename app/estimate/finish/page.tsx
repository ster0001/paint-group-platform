import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { customerOwnsDraft, getWizardActor } from "@/lib/supabase/guards";
import { loadCustomerScope, type EstimateRow } from "@/lib/wizard/customer-scope";
import { getCompanyContact } from "@/lib/portal/data";
import Wordmark from "@/app/wizard/Wordmark";
import Finish from "./Finish";
import "../../wizard/wizard.css";

/**
 * /estimate/finish?id=… — prototype screen 10, the finish line (§3, §9.5).
 *
 * Loads exactly what the scope editor loads, because it must show the SAME
 * numbers and the same answers: a second loader would be a second opinion
 * about money, and the two would disagree the first time either changed.
 */
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your estimate · Paint Group",
  robots: { index: false, follow: false },
};

function Holding({ line, logoUrl }: { line: string; logoUrl?: string | null }) {
  return (
    <div className="wz">
      <header className="wz-top"><Wordmark logoUrl={logoUrl ?? null} /></header>
      <div className="wz-wrap" style={{ textAlign: "center", paddingTop: 80 }}><h1>{line}</h1></div>
    </div>
  );
}

export default async function FinishPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (!id) return <Holding line="That link is missing its estimate." />;

  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return <Holding line="Open your estimate from the link we sent you." />;
  const db = actor.kind === "customer" ? createServiceClient() : supabase;
  if (!db) return <Holding line="Your estimate isn't available just now — please try again shortly." />;

  const { data: estimate } = await db
    .from("estimates")
    .select("id, status, source, created_by, requires_site_check, builder_state, account_id")
    .eq("id", id).maybeSingle();
  const own = !estimate ? false : actor.kind !== "customer" || await customerOwnsDraft(db, actor, estimate as EstimateRow);
  if (!estimate || !own) return <Holding line="We couldn't find that estimate." />;

  const bundle = await loadCustomerScope(db, estimate as EstimateRow);
  if (bundle.kind !== "rooms") {
    // An exterior-only job's finish line is its own screen (§3's branch) and
    // is not built; sending them to a half-right summary would be worse than
    // sending them back to the editor they know.
    return <Holding line="Open your estimate to finish it off." logoUrl={bundle.kind === "sides" ? bundle.logoUrl : null} />;
  }

  const loop = bundle.initialInteriorLoop;
  const spots = bundle.initialRooms.flatMap((r) => r.spots ?? []).map((s) => s.label);

  return (
    <div className="wz">
      <header className="wz-top"><Wordmark logoUrl={bundle.logoUrl} /></header>
      <Finish
        estimateId={bundle.estimateId}
        companyPhone={bundle.companyPhone}
        // The midpoint of the range the engine produced — the "computed
        // central estimate" ⚑8 asks for, never the top of the band.
        fixedPriceCents={Math.round((bundle.initial.rangeLoCents + bundle.initial.rangeHiCents) / 2)}
        input={{
          payload: bundle.initial,
          systems: bundle.initialSystems,
          access: bundle.initialAccess.answers,
          extras: bundle.initialExtras.offer.filter((o) => bundle.initialExtras.on.includes(o.code)).map((o) => o.label),
          spots,
          roomsConfirmed: loop ? loop.rooms.filter((r) => r.confirmed).length : bundle.initialRooms.length,
          roomsTotal: bundle.initialRooms.length,
        }}
      />
    </div>
  );
}
