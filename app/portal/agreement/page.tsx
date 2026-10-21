import Link from "next/link";
import { requireContractor } from "@/lib/contractor/session";
import { createClient } from "@/lib/supabase/server";
import { loadAgreementRules, loadAgreementStatus, loadAgreementVersion, missingForAgreement, previewValues, wordingHash } from "@/lib/agreements/load";
import { AGREEMENT_CSS, renderAgreementFragment, SIGNING_FIELDS } from "@/lib/agreements/render";
import { isValidAbn } from "@/lib/agreements/source";
import { dmy, painterAgreementLine, renewalDue } from "@/lib/agreements/status";
import { melbourneDate } from "@/lib/workorder/console";
import SignForm from "./SignForm";
import "./agreement.css";

export const dynamic = "force-dynamic";

/**
 * The subcontractor agreement, read and signed on the phone (brief §3). The
 * body is the ONE renderer's output with this contractor's record in place
 * and the signing slots marked; the sign form sits under it and only wakes
 * once the end has been reached. Signed, the page is their copy: the date,
 * the version, Download PDF, and the history. A record with a blank trading
 * name, ABN or address is sent to Profile first with the fields named, never
 * to a document with blanks in it.
 */
export default async function AgreementPage({ searchParams }: { searchParams: Promise<{ signed?: string }> }) {
  const { contractor, name, email, capabilities } = await requireContractor();
  const { signed: justSigned } = await searchParams;
  if (!contractor) {
    return <div className="wrap"><h1>Your agreement</h1><div className="empty"><i aria-hidden>⏳</i><b>Your account isn&rsquo;t set up yet</b>Paint Group still has to add you to the contractor list.</div></div>;
  }
  if (!capabilities.requiresInsurance) {
    return <div className="wrap" data-testid="agreement-not-needed"><h1>Your agreement</h1><div className="card"><p className="hint">Employed painters are covered by Paint Group&rsquo;s own agreement. There is nothing to sign here.</p></div></div>;
  }

  const db = await createClient();
  const [{ status, error: statusError }, version, rules] = await Promise.all([loadAgreementStatus(db), loadAgreementVersion(db), loadAgreementRules(db)]);
  if (!status || !version.file) {
    return <div className="wrap" data-testid="agreement-unavailable"><h1>Your agreement</h1><div className="err" role="alert">{statusError ?? ("error" in version ? version.error : "")} Ring the office if this keeps happening.</div></div>;
  }
  const today = melbourneDate(new Date());
  const due = !!status.signed && renewalDue(status.signed.expiresOn, today, status.renewalWarnDays);

  // ---- signed: their copy ----------------------------------------------------------------
  if (status.signed && !due) {
    const s = status.signed;
    return (
      <div className="wrap" data-testid="agreement-signed">
        <span className="slab">Subcontractor agreement</span>
        <h1>Signed</h1>
        {justSigned === "1" && (
          <div className="ok" data-testid="agreement-just-signed">Signed. A PDF copy is on its way to {email} and is in your Documents.</div>
        )}
        <div className="card">
          <div style={{ marginTop: 2 }}><span className="chip grn">Signed</span></div>
          <p className="hint" data-testid="agreement-signed-line">{painterAgreementLine(status, today)}</p>
          <div className="perk on"><span className="ic">✓</span><span>{s.source === "uploaded" ? "Signed on paper and kept on file by Paint Group" : `Signed by ${s.signedName} on ${dmy(s.signedAt)}`}</span></div>
          {s.commencementOn && <div className="perk on"><span className="ic">✓</span><span>Runs from {dmy(s.commencementOn)}{s.expiresOn ? ` to ${dmy(s.expiresOn)}` : ""}</span></div>}
          {s.pdfPath
            ? <a href={`/portal/agreement/pdf?id=${s.id}`} className="btn cy" data-testid="agreement-download">Download PDF</a>
            : <p className="hint" data-testid="agreement-pdf-pending">Your PDF is being prepared — it will be here in a moment, and in your email.</p>}
        </div>
        {status.history.length > 1 && (
          <div className="card" data-testid="agreement-history">
            <h3>Earlier copies</h3>
            {status.history.filter((h) => h.id !== s.id).map((h) => (
              <div key={h.id} className="doc"><div className="dn"><b>{h.source === "uploaded" ? "Signed on paper" : `Version ${h.version}`}</b><small>Signed {dmy(h.signedAt)}{h.expiresOn ? ` · expired ${dmy(h.expiresOn)}` : ""}</small></div>
                {h.pdfPath && <a href={`/portal/agreement/pdf?id=${h.id}`} style={{ color: "var(--cyan)", fontSize: "11.5px" }}>View</a>}</div>
            ))}
          </div>
        )}
        <Link href="/portal/profile" className="btn gh">Back to my profile</Link>
      </div>
    );
  }

  // ---- not signed (or due for renewal): the profile has to be complete first ---------------
  const missing = missingForAgreement(contractor, isValidAbn);
  if (missing.length) {
    return (
      <div className="wrap" data-testid="agreement-incomplete">
        <span className="slab">Subcontractor agreement</span>
        <h1>Finish your profile first</h1>
        <div className="card amberish">
          <p className="hint">The agreement is filled in from your profile, so these have to be in before you can sign:</p>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>{missing.map((m) => <li key={m.field} data-testid={`agreement-missing-${m.field}`}>{m.label}</li>)}</ul>
          <Link href="/portal/profile" className="btn cy" style={{ marginTop: 10 }}>Open my profile</Link>
        </div>
      </div>
    );
  }

  const values = previewValues(contractor, status, rules);
  const hash = wordingHash(version.file, values);
  const fragment = renderAgreementFragment(version.file, values, SIGNING_FIELDS);
  return (
    <div className="wrap ag-wrap" data-testid="agreement-read" data-version={version.file.version}>
      <span className="slab">Subcontractor agreement</span>
      <h1>{due ? "Your agreement is due for renewal" : "Read and sign your agreement"}</h1>
      <p className="hint" style={{ padding: 0 }}>
        {due ? `The one you signed runs out on ${dmy(status.signed!.expiresOn!)}. Read the new term and sign it the same way.` : "Your details are already filled in. Read it through, then tick and sign at the bottom."}
      </p>
      <style>{AGREEMENT_CSS}</style>
      <div className="ag ag-sheet" dangerouslySetInnerHTML={{ __html: fragment }} />
      <SignForm version={version.file.version} hash={hash} defaultName={name} businessName={contractor.company_name ?? ""} />
    </div>
  );
}
