import { requireContractor } from "@/lib/contractor/session";
import { loadContractorDocs, docsErrorMessage } from "@/lib/contractor/docs";
import { contractorPhone, weekendAvailability } from "@/lib/contractor/weekend";
import { createClient } from "@/lib/supabase/server";
import ProfileForm from "./ProfileForm";
import { loadMyStandards } from "@/lib/standards/status";
import { painterStatusLine } from "@/lib/standards/acks";
import { myLanguage } from "@/lib/induction/language";
import { languageOf } from "@/lib/induction/languages";
import { loadAgreementStatus } from "@/lib/agreements/load";
import { painterAgreementLine, renewalDue } from "@/lib/agreements/status";
import { melbourneDate } from "@/lib/workorder/console";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { email, name, contractor, capabilities } = await requireContractor();

  if (!contractor) {
    return (
      <div className="wrap">
        <h1>My profile</h1>
        <p className="slab">{email}</p>
        <div className="empty">
          <i aria-hidden>⏳</i>
          <b>Your account isn&rsquo;t set up yet</b>
          Paint Group still has to add you to the contractor list before you can fill
          in your company details.
        </div>
      </div>
    );
  }

  const { docs, error: docsError } = await loadContractorDocs(contractor.id);
  // Best-effort: null until migrations 20261221/20261223 run — hides the cards.
  const db = await createClient();
  const weekend = (await weekendAvailability(db, [contractor.id])).get(contractor.id) ?? null;
  const phone = await contractorPhone(db, contractor.id);
  // Finish standards (Step 2, ruling S7): the confirmed date and version on the profile.
  const { my } = await loadMyStandards(db, contractor.id);
  // Induction language (Step 4): shown with a way to change it; the record keeps the language they confirmed in.
  const languageCode = await myLanguage();
  const language = languageCode ? { code: languageCode, name: languageOf(languageCode).name, nativeName: languageOf(languageCode).nativeName } : null;
  // Subcontractor agreement (agreement brief §3): the Documents card reads the status RPC, never the document row.
  let agreement: { signed: boolean; due: boolean; line: string; downloadable: boolean; required: boolean } | null = null;
  if (capabilities.requiresInsurance) {
    const { status: ag } = await loadAgreementStatus(db);
    if (ag) {
      const today = melbourneDate(new Date());
      const due = !!ag.signed && renewalDue(ag.signed.expiresOn, today, ag.renewalWarnDays);
      agreement = { signed: !!ag.signed, due, line: painterAgreementLine(ag, today), downloadable: !!ag.signed?.pdfPath, required: ag.gate !== "ok" };
    }
  }
  const standards = my && my.status !== "not_required"
    ? { confirmed: my.status === "confirmed", line: painterStatusLine(my.status, my) }
    : null;

  return (
    <ProfileForm
      contractor={contractor}
      docs={docs}
      docsError={docsError ? docsErrorMessage(docsError) : null}
      name={name}
      email={email}
      weekend={weekend}
      phone={phone.available ? { value: phone.phone ?? "" } : null}
      capabilities={capabilities}
      standards={standards}
      language={language}
      agreement={agreement}
    />
  );
}
