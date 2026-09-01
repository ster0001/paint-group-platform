"use client";

import { useRef, useState } from "react";
import type { RevisionDiff } from "@/lib/revision/diff";
import {
  draftRevisionVariationsAction,
  sendVariationForSignatureAction,
  type DraftedVariation,
} from "./revisionActions";

const money = (c: number) =>
  "$" + (Math.abs(c) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (c: number) => (c < 0 ? "− " : "+ ") + money(c);

export type ExistingRevisionVariation = {
  id: string;
  revision_block_ref: string | null;
  status: string;
  price_cents: number | null;
  credit: boolean;
  est_hours: string | number | null;
  customer_token: string | null;
  signed_name: string | null;
  comment: string;
};

/**
 * The revision builder's "Changes vs the accepted estimate" panel (addendum
 * §3). The list is a live client-side PREVIEW from the same lib/revision
 * diff; the button saves the working scope first and then asks the server to
 * recompute and draft — nothing here writes money.
 */
export default function RevisionPanel({
  estimateId, diff, existing, saveFirst, onViewInvoice, workOrderId = null, photoCounts = {},
}: {
  estimateId: string;
  diff: RevisionDiff;
  existing: ExistingRevisionVariation[];
  /** The builder's own save() — the server drafts from the SAVED scope. */
  saveFirst: () => Promise<unknown>;
  /** Flip to the customer tab — what the final invoice will read. */
  onViewInvoice?: () => void;
  /** The job the photos hang off — null on jobs with no work order yet. */
  workOrderId?: string | null;
  /** variationId → how many wo_photos already sit on it (server-loaded). */
  photoCounts?: Record<string, number>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [drafted, setDrafted] = useState<DraftedVariation[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>(photoCounts);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploadTarget = useRef<string | null>(null);

  // Tom's ruling (1 Sep): a change goes to the customer WITH a photo — they
  // sign what they can see. The server refuses too; this keeps the buttons
  // honest. Credits (scope removals) are exempt.
  async function uploadPhoto(variationId: string, file: File) {
    if (!workOrderId) return;
    setUploadingFor(variationId);
    setMessage(null);
    try {
      const signRes = await fetch("/api/wo/photos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId, size: file.size }),
      });
      const sign = await signRes.json();
      if (!signRes.ok) throw new Error(sign.error ?? "upload");
      const put = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/wo-photos/${sign.path}?token=${sign.token}`,
        { method: "PUT", body: file },
      );
      if (!put.ok) throw new Error("upload");
      const ingest = await fetch("/api/wo/photos", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId, path: sign.path, kind: "variation", variationId }),
      });
      const done = await ingest.json();
      if (!ingest.ok) throw new Error(done.error ?? "upload");
      setCounts((c) => ({ ...c, [variationId]: (c[variationId] ?? 0) + 1 }));
    } catch (e) {
      setMessage(e instanceof Error && e.message !== "upload" ? e.message : "That photo didn't upload — try again.");
    } finally {
      setUploadingFor(null);
    }
  }

  async function sendLink(token: string, via: "email" | "sms" | "both") {
    setSending(token + via);
    setMessage(null);
    try {
      const result = await sendVariationForSignatureAction({ token, via });
      if (result.ok) {
        setSentIds((s) => [...s, token]);
        const bits = [
          result.email ? `email ${result.email.status === "sent" ? "sent" : result.email.status.replace(/_/g, " ")}` : null,
          result.sms ? `text ${result.sms.status === "sent" ? "sent" : result.sms.status.replace(/_/g, " ")}` : null,
        ].filter(Boolean);
        setMessage(`Signing link on its way — ${bits.join(", ")}.`);
      } else {
        setMessage(result.message ?? "Couldn't send that.");
      }
    } finally {
      setSending(null);
    }
  }

  const signedOnes = existing.filter(
    (v) => v.status === "customer_approved" || v.status === "contractor_accepted",
  );
  const pending = existing.filter((v) => v.status === "priced");

  async function draft() {
    setBusy(true);
    setMessage(null);
    try {
      await saveFirst();
      const result = await draftRevisionVariationsAction({ estimateId });
      if (!result.ok) { setMessage(result.message); return; }
      setDrafted(result.drafted);
      const live = result.drafted.filter((d) => d.state === "drafted").length;
      setMessage(live
        ? `${live} variation${live === 1 ? "" : "s"} drafted — send the signing link${live === 1 ? "" : "s"} below.`
        : "Nothing to draft — the working scope matches what's already signed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(token: string) {
    const url = `${window.location.origin}/v/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setMessage(url);
    }
  }

  return (
    <section
      className="mb-4 rounded-xl border border-amber-300/40 bg-amber-50/5 p-4"
      data-testid="revision-panel"
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-semibold tracking-wide">Changes vs the accepted estimate</h2>
        <span className="font-mono text-xs text-gray-400" data-testid="revision-totals">
          {money(diff.acceptedIncCents)} → {money(diff.workingIncCents)} incl. GST
        </span>
      </div>

      {diff.changes.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400" data-testid="revision-no-changes">
          The working scope matches the accepted estimate — nothing to send for signature.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5" data-testid="revision-changes">
          {diff.changes.map((c) => (
            <li key={c.blockRef} className="flex items-baseline gap-2 text-xs">
              <span className={`font-mono ${c.credit ? "text-rose-400" : "text-emerald-400"}`}>
                {signed(c.deltaIncCents)}
              </span>
              <span className="font-medium">{c.title}</span>
              {c.detail && <span className="text-gray-500">· {c.detail}</span>}
              {c.hours > 0 && <span className="text-gray-500">· {c.hours} hr</span>}
            </li>
          ))}
        </ul>
      )}

      {signedOnes.length > 0 && (
        <p className="mt-2 text-[11px] text-gray-500">
          Already signed on this job:{" "}
          {signedOnes.map((v) => `${v.credit ? "−" : "+"}${money(v.price_cents ?? 0)}`).join(" · ")}
          {" — "}new drafts carry only what goes beyond these.
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={draft}
          disabled={busy || diff.changes.length === 0}
          className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-50"
          data-testid="draft-variations"
        >
          {busy ? "Drafting…" : "Save & draft variations for signature"}
        </button>
        {onViewInvoice && (
          <button
            type="button"
            onClick={onViewInvoice}
            className="rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-white/5"
            data-testid="view-invoice"
            title="What the customer's final invoice will read once every change is signed"
          >
            View invoice
          </button>
        )}
        {message && <span className="text-xs text-gray-400" data-testid="revision-message">{message}</span>}
      </div>

      {/* One row per live signing link — freshly drafted this visit, or a
          draft still awaiting the customer from earlier. Copy it, or fire it
          straight to their email + mobile through the messaging rails. */}
      {(() => {
        const rows: { key: string; title: string; credit: boolean; priceIncCents: number; token: string; variationId: string | null }[] = [
          ...(drafted ?? [])
            .filter((d) => d.state === "drafted" && d.token)
            .map((d) => ({ key: d.blockRef, title: d.title, credit: d.credit, priceIncCents: d.priceIncCents, token: d.token!, variationId: d.variationId })),
          ...(!drafted
            ? pending
                .filter((p) => p.customer_token)
                .map((p) => ({
                  key: p.id, title: p.comment || "Awaiting signature", credit: p.credit,
                  priceIncCents: p.price_cents ?? 0, token: p.customer_token!, variationId: p.id,
                }))
            : []),
        ];
        if (rows.length === 0) return null;
        return (
          <>
          <input
            ref={fileInput} type="file" hidden
            accept="image/jpeg,image/png,image/webp,image/heic"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              const target = uploadTarget.current;
              if (f && target) void uploadPhoto(target, f);
            }}
          />
          <ul className="mt-3 space-y-1.5" data-testid="drafted-list">
            {rows.map((d) => {
              const photoCount = d.variationId ? (counts[d.variationId] ?? 0) : 0;
              const needsPhoto = !d.credit && photoCount === 0;
              return (
              <li key={d.key} className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`font-mono ${d.credit ? "text-rose-400" : "text-emerald-400"}`}>
                  {d.credit ? "− " : "+ "}{money(d.priceIncCents)}
                </span>
                <span>{d.title}</span>
                {!d.credit && d.variationId && workOrderId && (
                  <button
                    type="button"
                    className={`rounded border px-2 py-0.5 text-[11px] ${needsPhoto ? "border-amber-400/70 text-amber-300" : "border-white/15 text-gray-300"} hover:bg-white/5 disabled:opacity-50`}
                    onClick={() => { uploadTarget.current = d.variationId; fileInput.current?.click(); }}
                    disabled={uploadingFor !== null}
                    data-testid={`variation-photo-${d.key.replace(/[^a-z0-9]/gi, "-")}`}
                  >
                    {uploadingFor === d.variationId ? "Uploading…"
                      : needsPhoto ? "📷 Add a photo — needed before sending"
                      : `📷 ${photoCount} photo${photoCount === 1 ? "" : "s"} — add another`}
                  </button>
                )}
                <button
                  type="button"
                  className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-gray-300 hover:bg-white/5"
                  onClick={() => copyLink(d.token)}
                  data-testid={`copy-link-${d.key.replace(/[^a-z0-9]/gi, "-")}`}
                >
                  {copied === d.token ? "Copied ✓" : "Copy signing link"}
                </button>
                {/* The sender chooses the channel (Tom, 24 Aug close-off). */}
                <span className="inline-flex overflow-hidden rounded border border-cyan-500/60 text-[11px] font-semibold">
                  {([["email", "Email"], ["sms", "Text"], ["both", "Both"]] as const).map(([via, label]) => (
                    <button
                      key={via}
                      type="button"
                      className="bg-cyan-500/90 px-2 py-0.5 text-black hover:bg-cyan-400 disabled:opacity-50 border-r border-cyan-700/40 last:border-r-0"
                      onClick={() => sendLink(d.token, via)}
                      disabled={sending !== null || needsPhoto}
                      title={needsPhoto ? "Attach a photo of the change first — the customer signs what they can see." : undefined}
                      data-testid={`send-${via}-${d.key.replace(/[^a-z0-9]/gi, "-")}`}
                    >
                      {sending === d.token + via ? "…" : label}
                    </button>
                  ))}
                </span>
                {sentIds.includes(d.token) && <span className="text-[11px] text-emerald-400">Sent ✓</span>}
              </li>
              );
            })}
          </ul>
          </>
        );
      })()}
    </section>
  );
}
