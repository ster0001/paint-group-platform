import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { customerOwnsDraft, getWizardActor } from "@/lib/supabase/guards";
import { loadCustomerScope, type EstimateRow } from "@/lib/wizard/customer-scope";
import ScopeEditor from "./ScopeEditor";
import AssistantWidget from "@/app/estimate/assist/AssistantWidget";
import SidesEditor from "./SidesEditor";
import Wordmark from "@/app/wizard/Wordmark";
import { getCompanyContact } from "@/lib/portal/data";
import "../../wizard/wizard.css";

/**
 * /estimate/scope?id=… — Part B: the customer scope editor.
 *
 * Full control of WHAT is painted, zero control of hours, rates or
 * allowances — enforced by the wizard-edit route's action whitelist, not by
 * hidden buttons. A customer opens only their own customer_intake draft
 * (404 otherwise); staff can open any draft to preview what the customer
 * sees. Everything money-shaped on this page is a RANGE.
 */

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Shape your estimate · Paint Group",
  robots: { index: false, follow: false },
};

async function Holding({ line }: { line: string }) {
  const company = await getCompanyContact();
  return (
    <div className="wz">
      <header className="wz-top"><Wordmark logoUrl={company.logoUrl} /></header>
      <div className="wz-wrap" style={{ textAlign: "center", paddingTop: 80 }}>
        <h1>{line}</h1>
      </div>
    </div>
  );
}

export default async function ScopeEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (!id) return <Holding line="That link is missing its estimate." />;

  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return <Holding line="Open your estimate from the link we sent you." />;

  const db = actor.kind === "customer" ? createServiceClient() : supabase;
  if (!db) return <Holding line="The editor isn't available just now — please try again shortly." />;

  const { data: estimate } = await db
    .from("estimates")
    .select("id, status, source, created_by, requires_site_check, builder_state, account_id")
    .eq("id", id)
    .maybeSingle();
  // Phase 1 (6 Sep plan): the anonymous builder OR a signed-in member of the
  // linked account — the "keep shaping my estimate" way back in.
  const own = !estimate ? false : actor.kind !== "customer" || await customerOwnsDraft(db, actor, estimate as EstimateRow);
  if (!estimate || !own) return <Holding line="We couldn't find that estimate." />;
  if (estimate.status === "accepted") {
    return <Holding line="This estimate is accepted — its scope is locked in." />;
  }

  const bundle = await loadCustomerScope(db, estimate as EstimateRow);
  if (bundle.kind === "holding") return <Holding line={bundle.line} />;
  if (bundle.kind === "sides") {
    return (
      <div className="wz">
        <SidesEditor
          estimateId={bundle.estimateId}
          initial={bundle.initial}
          initialSides={bundle.initialSides}
          initialExterior={bundle.initialExterior}
          initialLadder={bundle.initialLadder}
          docs={bundle.docs}
          logoUrl={bundle.logoUrl}
          companyPhone={bundle.companyPhone}
          phoneHours={bundle.phoneHours}
          customerPhone={bundle.customerPhone}
        />
      </div>
    );
  }

  return (
    <div className="wz" style={{ position: "relative" }}>
      {/* S4: "Chat it or fill it in" — the other half of the toggle. */}
      <a className="as-switch-top" href={`/estimate/assist?estimate=${bundle.estimateId}`}>Chat it instead</a>
      {/* Tom, 7 Sep: general questions to the assistant, or a person — never co-work. */}
      {actor.kind === "customer" && <AssistantWidget estimateId={bundle.estimateId} lift={76} />}
      <ScopeEditor
        estimateId={bundle.estimateId}
        initial={bundle.initial}
        initialRooms={bundle.initialRooms}
        initialSides={bundle.initialSides}
        initialExterior={bundle.initialExterior}
        initialLadder={bundle.initialLadder}
        initialInteriorLoop={bundle.initialInteriorLoop}
        initialSystems={bundle.initialSystems}
        initialAccess={bundle.initialAccess}
        roomTypes={bundle.roomTypes}
        liveRange={bundle.liveRange}
        companyPhone={bundle.companyPhone}
        phoneHours={bundle.phoneHours}
        customerPhone={bundle.customerPhone}
        docs={bundle.docs}
        logoUrl={bundle.logoUrl}
      />
    </div>
  );
}
