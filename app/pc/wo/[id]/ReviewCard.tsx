"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { markReviewReceived, markReviewRequested } from "@/app/pc/actions";

export type ReviewState = { sentAt: string | null; sentVia: string | null; receivedAt: string | null; rating: number | null } | null;

/**
 * Dashboard 0c (B3, ⚑B2): reviews requested → received. The review-request
 * automation is still planned, so "we asked" is a person's tick for now;
 * "it came back" stays a person's tick until the Google Business Profile
 * API is connected. One row per job; the dashboard counts these.
 */
export default function ReviewCard({ workOrderId, review }: { workOrderId: string; review: ReviewState }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState<string>(review?.rating ? String(review.rating) : "");
  const [msg, setMsg] = useState("");
  const day = (iso: string | null) => iso
    ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" }).format(new Date(iso))
    : null;

  async function requested() {
    setBusy(true); setMsg("");
    const r = await markReviewRequested({ workOrderId });
    setBusy(false);
    if (!r.ok) { setMsg(r.message); return; }
    router.refresh();
  }
  async function received() {
    setBusy(true); setMsg("");
    const r = await markReviewReceived({ workOrderId, rating: rating ? Number(rating) : null });
    setBusy(false);
    if (!r.ok) { setMsg(r.message); return; }
    router.refresh();
  }

  return (
    <div className="card" data-testid="review-card">
      <div className="card-head"><b>Review</b></div>
      <p className="hint" data-testid="review-state">
        {review?.receivedAt
          ? `Received ${day(review.receivedAt)}${review.rating ? ` · ${"★".repeat(review.rating)}` : ""}`
          : review?.sentAt
            ? `Asked ${day(review.sentAt)}${review.sentVia === "automation" ? " (automatically)" : ""} — not received yet`
            : "Not asked for yet"}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        {!review?.sentAt && (
          <button type="button" className="btn" disabled={busy} onClick={() => void requested()} data-testid="review-requested">
            We asked for a review
          </button>
        )}
        {!review?.receivedAt && (
          <>
            <select value={rating} onChange={(e) => setRating(e.target.value)} aria-label="Rating" data-testid="review-rating">
              <option value="">Rating —</option>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
            </select>
            <button type="button" className="btn" disabled={busy} onClick={() => void received()} data-testid="review-received">
              Review received
            </button>
          </>
        )}
      </div>
      {msg && <p className="hint" role="status" style={{ color: "var(--clay, #b3412e)" }}>{msg}</p>}
    </div>
  );
}
