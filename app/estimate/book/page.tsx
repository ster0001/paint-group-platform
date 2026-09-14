import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { customerOwnsDraft, getWizardActor } from "@/lib/supabase/guards";
import { loadCustomerScope, type EstimateRow } from "@/lib/wizard/customer-scope";
import Wordmark from "@/app/wizard/Wordmark";
import Book from "./Book";
import "../../wizard/wizard.css";

/**
 * /estimate/book?id=… — Tom, 14 Sep (tighten batch, item 3): the booking page
 * behind "Book a time". Loads exactly what the editor loads (one loader, one
 * opinion about the job) and hands the reach strip its own screen.
 */
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Book a time · Paint Group",
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

export default async function BookPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
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
  if (bundle.kind === "holding") return <Holding line={bundle.line} />;

  return (
    <div className="wz">
      <header className="wz-top"><Wordmark logoUrl={bundle.logoUrl} /></header>
      <Book
        estimateId={bundle.estimateId}
        estimator={bundle.estimator}
        companyPhone={bundle.companyPhone}
        phoneHours={bundle.phoneHours}
        customerPhone={bundle.customerPhone}
        visitSlots={bundle.initialLadder.visitSlots}
        suburb={bundle.customerSuburb}
      />
    </div>
  );
}
