"use client";

import { useMemo, useState } from "react";
import { DEFAULT_MESSAGING, renderTemplate, type MessagingSettings, type TemplateVars } from "@/lib/messaging/config";
import type { CompanyProfile, Contact } from "./company";

export type SendDelivery = {
  email?: { to: string; subject: string; message: string };
  sms?: { to: string };
};

/**
 * Pre-send dialog: the wording is rendered from the saved templates HERE so
 * staff see (and can edit) exactly what the customer will read. The estimate
 * link itself is added server-side — the email gets an "Open your estimate"
 * button, the SMS gets the link substituted into its template.
 */
export default function SendDialog({
  contact,
  company,
  messaging,
  estimateTitle,
  totalCents,
  isResend,
  sending,
  reviewItems = [],
  reviewTotalCents = 0,
  reviewGateCents = 15000,
  onSend,
  onClose,
}: {
  contact: Contact | null;
  company: CompanyProfile;
  messaging: MessagingSettings;
  estimateTitle: string;
  totalCents: number;
  isResend: boolean;
  sending: boolean;
  /** Unresolved assumptions, ordered by dollar impact - the Step 6 gate. */
  reviewItems?: Array<{ label: string; needs: string; impactCents: number; basis: string }>;
  reviewTotalCents?: number;
  reviewGateCents?: number;
  onSend: (delivery: SendDelivery) => void;
  onClose: () => void;
}) {
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const gateBlocks = reviewTotalCents > reviewGateCents && !reviewAcknowledged;
  const vars: TemplateVars = useMemo(() => ({
    first_name: contact?.first_name || "there",
    name: [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || contact?.company || "there",
    company_name: company.name,
    estimate_title: estimateTitle,
    total: totalCents ? `${(totalCents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" })} inc GST` : "",
    estimator_name: company.estimatorName,
    // link is server-derived; leave the placeholder visible in the SMS preview
  }), [contact, company, estimateTitle, totalCents]);

  const m = { ...DEFAULT_MESSAGING, ...messaging };
  // Resends default to "just update, don't notify" so quiet corrections stay quiet.
  const [emailOn, setEmailOn] = useState(!isResend);
  const [emailTo, setEmailTo] = useState(contact?.email ?? "");
  const [subject, setSubject] = useState(() => renderTemplate(m.emailSubject, vars));
  const [message, setMessage] = useState(() => renderTemplate(m.emailIntro, vars));
  const [smsOn, setSmsOn] = useState(m.smsEnabled && !isResend && Boolean(contact?.phone));
  const [smsTo, setSmsTo] = useState(contact?.phone ?? "");

  const smsPreview = renderTemplate(m.smsTemplate, { ...vars, link: "(link to the estimate)" });
  const canSend = (!emailOn || emailTo.trim().length > 3) && (!smsOn || smsTo.trim().length > 5);

  function submit() {
    const delivery: SendDelivery = {};
    if (emailOn) delivery.email = { to: emailTo.trim(), subject: subject.trim(), message: message.trim() };
    if (smsOn) delivery.sms = { to: smsTo.trim() };
    onSend(delivery);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{isResend ? "Update sent estimate" : "Send estimate"}</h2>
        <p className="mt-1 text-xs text-gray-500">
          {isResend
            ? "The customer's link always shows the latest saved version — notify them below only if you want them to know it changed."
            : "The customer gets a personal link that always shows the latest saved version."}
        </p>

        <label className="mt-4 flex items-center gap-2 text-sm font-medium text-gray-800">
          <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
          Email the estimate
        </label>
        {emailOn && (
          <div className="mt-2 space-y-2 rounded-lg border border-gray-200 p-3">
            <div>
              <label className="text-xs font-medium text-gray-500">To</label>
              <input
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="customer@email.com"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Introduction</label>
              <textarea
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-relaxed"
              />
              <p className="mt-1 text-[11px] text-gray-400">An &ldquo;Open your estimate&rdquo; button is added under this message automatically. Edit the default wording in Settings → Messaging.</p>
            </div>
          </div>
        )}

        <label className="mt-4 flex items-center gap-2 text-sm font-medium text-gray-800">
          <input type="checkbox" checked={smsOn} onChange={(e) => setSmsOn(e.target.checked)} />
          Also text them the link
        </label>
        {smsOn && (
          <div className="mt-2 space-y-2 rounded-lg border border-gray-200 p-3">
            <div>
              <label className="text-xs font-medium text-gray-500">Mobile</label>
              <input
                value={smsTo}
                onChange={(e) => setSmsTo(e.target.value)}
                placeholder="04xx xxx xxx"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">{smsPreview}</p>
          </div>
        )}
        {!m.smsEnabled && smsOn && (
          <p className="mt-1 text-[11px] text-amber-600">Text messaging is switched off in Settings → Messaging — this one will still send, but turn it on there to have it ticked by default.</p>
        )}

        {reviewItems.length > 0 && (
          <div className={`mt-4 rounded-lg border p-3 ${reviewTotalCents > reviewGateCents ? "border-amber-400 bg-amber-50" : "border-gray-200 bg-gray-50"}`}>
            <p className="text-xs font-semibold text-gray-800">
              Still assumed on this estimate — about ${Math.round(reviewTotalCents / 100).toLocaleString("en-AU")} unresolved
            </p>
            <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto text-[11px] text-gray-600">
              {reviewItems.map((r, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{r.label}: {r.needs}</span>
                  <span className="whitespace-nowrap tabular-nums">~${Math.round(r.impactCents / 100).toLocaleString("en-AU")}</span>
                </li>
              ))}
            </ul>
            {reviewTotalCents > reviewGateCents && (
              <label className="mt-2 flex items-start gap-2 text-xs font-medium text-amber-900">
                <input type="checkbox" checked={reviewAcknowledged} onChange={(e) => setReviewAcknowledged(e.target.checked)} className="mt-0.5" />
                I&rsquo;ve reviewed these — send anyway (over the ${Math.round(reviewGateCents / 100)} review threshold)
              </label>
            )}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between">
          <p className="text-[11px] text-gray-400">{!emailOn && !smsOn ? (isResend ? "The estimate updates without notifying the customer." : "The estimate is marked sent — share the link yourself.") : ""}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">Cancel</button>
            <button
              onClick={submit}
              disabled={sending || !canSend || gateBlocks}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {sending ? "Sending…" : isResend ? "Update" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
