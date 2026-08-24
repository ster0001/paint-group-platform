"use client";

import { useState } from "react";
import type { RevisionDiff } from "@/lib/revision/diff";
import { draftRevisionVariationsAction, type DraftedVariation } from "./revisionActions";

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
  estimateId, diff, existing, saveFirst,
}: {
  estimateId: string;
  diff: RevisionDiff;
  existing: ExistingRevisionVariation[];
  /** The builder's own save() — the server drafts from the SAVED scope. */
  saveFirst: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [drafted, setDrafted] = useState<DraftedVariation[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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
      {pending.length > 0 && !drafted && (
        <p className="mt-1 text-[11px] text-amber-400/90">
          {pending.length} draft{pending.length === 1 ? "" : "s"} already awaiting signature —
          re-drafting updates {pending.length === 1 ? "it" : "them"} in place.
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
        {message && <span className="text-xs text-gray-400" data-testid="revision-message">{message}</span>}
      </div>

      {drafted && drafted.some((d) => d.state === "drafted") && (
        <ul className="mt-3 space-y-1.5" data-testid="drafted-list">
          {drafted.filter((d) => d.state === "drafted").map((d) => (
            <li key={d.blockRef} className="flex items-center gap-2 text-xs">
              <span className={`font-mono ${d.credit ? "text-rose-400" : "text-emerald-400"}`}>
                {d.credit ? "− " : "+ "}{money(d.priceIncCents)}
              </span>
              <span>{d.title}</span>
              {d.token && (
                <button
                  type="button"
                  className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-gray-300 hover:bg-white/5"
                  onClick={() => copyLink(d.token!)}
                  data-testid={`copy-link-${d.blockRef.replace(/[^a-z0-9]/gi, "-")}`}
                >
                  {copied === d.token ? "Copied ✓" : "Copy signing link"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
