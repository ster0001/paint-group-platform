"use client";

import { useState } from "react";
import { setReviewTagAction } from "./siteContentActions";

export type ReviewTagRow = { review_key: string; author: string; rating: number | null; snippet: string; published_at: string | null; audience_suggested: "home" | "business" | null; audience: "home" | "business" | null };

/**
 * Settings → Website → Reviews (session 8 §5). Each Google review the site
 * has fetched, the import's guess, and one tap to confirm Home or
 * Business. Only the confirmed tag decides which site shows the review.
 */
export default function ReviewTagsManager({ initial }: { initial: ReviewTagRow[] }) {
  const [rows, setRows] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);

  async function tag(row: ReviewTagRow, audience: "home" | "business" | null) {
    setRows((rs) => rs.map((r) => (r.review_key === row.review_key ? { ...r, audience } : r)));
    const r = await setReviewTagAction({ reviewKey: row.review_key, audience }).catch(() => null);
    setMsg(!r || r.status === "error" ? (r?.status === "error" ? r.message : "That didn't save.") : null);
  }

  if (rows.length === 0) return <p className="text-sm text-gray-500">No reviews fetched yet. They appear here once the homepage has loaded the Google listing.</p>;
  return (
    <div className="grid gap-2" data-testid="review-tags">
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {rows.map((r) => (
        <div key={r.review_key} className="rounded-lg border border-gray-200 bg-white p-3" data-testid={`review-tag-${r.review_key}`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <b>{r.author}</b>
            {r.rating != null && <span className="text-amber-600">{"★".repeat(r.rating)}</span>}
            {r.published_at && <span className="text-xs text-gray-400">{new Date(r.published_at).toLocaleDateString("en-AU")}</span>}
            {r.audience_suggested && !r.audience && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] uppercase text-amber-700">looks like {r.audience_suggested}</span>}
          </div>
          <p className="mt-1 text-sm text-gray-600">{r.snippet}</p>
          <div className="mt-2 flex gap-1.5">
            {(["home", "business"] as const).map((a) => (
              <button key={a} type="button" onClick={() => tag(r, r.audience === a ? null : a)}
                className={`rounded-full border px-3 py-1 text-xs ${r.audience === a ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`} data-testid={`tag-${a}`}>
                {a === "home" ? "Home" : "Business"}
              </button>
            ))}
            {r.audience && <span className="self-center text-xs text-gray-400">tap again to clear</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
