"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TourCard } from "@/lib/help/tour";
import { markTourSeen } from "./tourActions";

/**
 * The first-sign-in tour (help brief Phase C, C3). One card at a time over
 * the portal, Next / Back / Skip; Next walks to the card's tab so the screen
 * being described is the one behind the card. Finishing or skipping records
 * tour_seen_at through its RPC, so it never shows twice — except when Help
 * replays it (`replay`), which records nothing new.
 */
export default function PortalTour({ cards, replay = false }: { cards: TourCard[]; replay?: boolean }) {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(cards.length > 0);
  const [pending, start] = useTransition();
  if (!open || cards.length === 0) return null;
  const card = cards[i];
  const last = i === cards.length - 1;

  const close = () => {
    setOpen(false);
    if (!replay) start(async () => { await markTourSeen(); });
  };
  const go = (n: number) => {
    const next = Math.max(0, Math.min(cards.length - 1, n));
    setI(next);
    const target = cards[next].target;
    if (target && target !== window.location.pathname) router.push(target);
  };

  return (
    <div className="tourwrap" role="dialog" aria-modal="true" aria-labelledby="tour-title" data-testid="tour">
      <div className="tour" data-testid={`tour-card-${i + 1}`}>
        <p className="slab" style={{ marginBottom: 6 }}>Show me around · {i + 1} of {cards.length}</p>
        <h2 id="tour-title" style={{ marginBottom: 6 }}>{card.title}</h2>
        <p style={{ fontSize: "13.5px", color: "var(--text)", lineHeight: 1.5, margin: 0 }}>{card.body}</p>
        <div className="tour-dots" aria-hidden>
          {cards.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}
        </div>
        <div className="tour-btns">
          <button type="button" className="btn gh narrow" onClick={() => go(i - 1)} disabled={i === 0 || pending} data-testid="tour-back">Back</button>
          {last ? (
            <button type="button" className="btn cy narrow" onClick={close} disabled={pending} data-testid="tour-finish">Done — let&rsquo;s go</button>
          ) : (
            <button type="button" className="btn cy narrow" onClick={() => go(i + 1)} disabled={pending} data-testid="tour-next">Next</button>
          )}
          <button type="button" className="btn dim narrow" onClick={close} disabled={pending} data-testid="tour-skip" style={{ marginLeft: "auto" }}>Skip</button>
        </div>
      </div>
    </div>
  );
}
