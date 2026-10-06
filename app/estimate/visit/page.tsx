import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { customerOwnsDraft, getWizardActor } from "@/lib/supabase/guards";
import { loadMessaging } from "@/lib/messaging/load";
import { ESTIMATE_CORE_SELECT, loadVisitContext, type EstimateCore } from "@/lib/visits/holds";
import Wordmark from "@/app/wizard/Wordmark";
import VisitBooking from "./VisitBooking";
import "../../wizard/wizard.css";

/**
 * /estimate/visit?id=… — "Book a site visit" (visit booking addendum A, S3).
 * The screens and wording are mockup 4: details (only when we do not hold
 * them) → calendar → code → booked. Everything is decided on the server from
 * the stored address; the page only shows what it was given.
 */
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Book a site visit · Paint Group",
  robots: { index: false, follow: false },
};

function Holding({ line }: { line: string }) {
  return (
    <div className="wz">
      <header className="wz-top"><Wordmark logoUrl={null} /></header>
      <div className="wz-wrap" style={{ textAlign: "center", paddingTop: 80 }}><h1>{line}</h1></div>
    </div>
  );
}

export default async function VisitPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (!id) return <Holding line="That link is missing its estimate." />;

  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return <Holding line="Open your estimate from the link we sent you." />;
  const svc = createServiceClient();
  if (!svc) return <Holding line="Booking isn't available just now — please try again shortly." />;

  const { data, error } = await svc.from("estimates").select(ESTIMATE_CORE_SELECT).eq("id", id).maybeSingle();
  if (error) return <Holding line="Your estimate couldn't be read just now — please try again shortly." />;
  const est = (data ?? null) as EstimateCore | null;
  const own = !est ? false : actor.kind !== "customer" || await customerOwnsDraft(svc, actor, est);
  if (!est || !own) return <Holding line="We couldn't find that estimate." />;

  const [ctx, { company }] = await Promise.all([loadVisitContext(svc, est), loadMessaging(svc)]);
  return (
    <div className="wz">
      <header className="wz-top"><Wordmark logoUrl={company.logoUrl ?? null} /></header>
      <VisitBooking
        estimateId={est.id}
        suburb={ctx.address?.suburb ?? null}
        address={ctx.address?.formatted ?? ""}
        hasAddress={!!ctx.address?.street}
        known={ctx.known}
        hasContact={!!ctx.contact}
        zone={ctx.zone.outcome}
        calendar={ctx.calendar}
        days={ctx.days}
        hold={ctx.hold}
        companyPhone={company.phone ?? null}
      />
    </div>
  );
}
