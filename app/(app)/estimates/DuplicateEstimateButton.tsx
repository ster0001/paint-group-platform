"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { duplicateEstimateAction } from "./actions";

/**
 * Tom, 16 Sep: "Duplicate" on every row, accepted ones included — copying a
 * signed job for the next house is the whole point.
 *
 * One click, no question: nothing is lost by making a copy, and the copy is
 * saved before the builder opens on it, so a stray click leaves a draft
 * called "… (copy)" on the list and nothing worse. The button goes quiet
 * while the copy is made and takes you to the new estimate when it exists.
 */
export default function DuplicateEstimateButton({ estimateId, title }: { estimateId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function duplicate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await duplicateEstimateAction({ estimateId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`/quote?id=${result.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The copy couldn't be made.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={duplicate}
        disabled={busy}
        className="mr-3 text-xs text-gray-400 hover:text-gray-900 disabled:cursor-wait disabled:text-gray-300"
        aria-label={`Duplicate ${title}`}
        data-testid={`duplicate-${estimateId}`}
      >
        {busy ? "Copying…" : "Duplicate"}
      </button>
      {error && (
        <span className="mr-3 text-xs text-red-600" role="alert" data-testid={`duplicate-error-${estimateId}`}>
          {error}
        </span>
      )}
    </>
  );
}
