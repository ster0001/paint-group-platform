import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { customerOwnsDraft, getWizardActor } from "@/lib/supabase/guards";
import { loadCustomerScope, type EstimateRow } from "@/lib/wizard/customer-scope";
import { getCompanyContact } from "@/lib/portal/data";
import { DEFAULT_TURNAROUND } from "@/lib/wizard/finish-line";
import Wordmark from "@/app/wizard/Wordmark";
import Sent from "./Sent";
import "../../wizard/wizard.css";

/**
 * /estimate/sent?id=… — prototype screen 11, the hand-off (§3, §9.6).
 *
 * Its own URL rather than a state inside the editor, deliberately: this is
 * the screen somebody comes back to when they want to know what is happening
 * to their job, and a toast cannot be returned to.
 */
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Sent to your estimator · Paint Group",
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

export default async function SentPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
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

  const [bundle, company] = await Promise.all([
    loadCustomerScope(db, estimate as EstimateRow),
    getCompanyContact(),
  ]);
  if (bundle.kind === "holding") return <Holding line={bundle.line} />;

  const state = (estimate.builder_state ?? {}) as Record<string, unknown>;
  const contact = (state.contact ?? {}) as { email?: string };
  const rooms = bundle.kind === "rooms" ? bundle.initialRooms : [];
  const photos = bundle.kind === "rooms" || bundle.kind === "sides" ? (bundle.docs.photos?.length ?? 0) : 0;

  return (
    <div className="wz">
      <header className="wz-top"><Wordmark logoUrl={bundle.logoUrl} /></header>
      <Sent
        estimateId={bundle.estimateId}
        // The name a customer should hear, from Settings — never a hardcoded
        // "Sarah". An office that hasn't set one gets the company's name
        // rather than an invented person.
        coordinator={company.coordinatorName || company.name}
        companyPhone={bundle.companyPhone}
        email={contact.email?.trim() || null}
        roomsTotal={rooms.length}
        spots={rooms.reduce((n, r) => n + (r.spots?.length ?? 0), 0)}
        photos={photos}
        turnaround={DEFAULT_TURNAROUND}
        visitSlots={bundle.initialLadder.visitSlots}
      />
    </div>
  );
}
