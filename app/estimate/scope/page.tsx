import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import { loadCustomerScope, type EstimateRow } from "@/lib/wizard/customer-scope";
import ScopeEditor from "./ScopeEditor";
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
  const own = actor.kind !== "customer" || (
    (estimate as { created_by?: string | null } | null)?.created_by === actor.user.id
    && (estimate as { source?: string } | null)?.source === "customer_intake"
    && estimate?.status === "draft"
  );
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
        />
      </div>
    );
  }

  return (
    <div className="wz" style={{ position: "relative" }}>
      {/* S4: "Chat it or fill it in" — the other half of the toggle. */}
      <a className="as-switch-top" href={`/estimate/assist?estimate=${bundle.estimateId}`}>Chat it instead</a>
      <ScopeEditor
        estimateId={bundle.estimateId}
        initial={bundle.initial}
        initialRooms={bundle.initialRooms}
        initialSides={bundle.initialSides}
        initialExterior={bundle.initialExterior}
        initialLadder={bundle.initialLadder}
        initialInteriorLoop={bundle.initialInteriorLoop}
        roomTypes={bundle.roomTypes}
        liveRange={bundle.liveRange}
        companyPhone={bundle.companyPhone}
        docs={bundle.docs}
        logoUrl={bundle.logoUrl}
      />
    </div>
  );
}
