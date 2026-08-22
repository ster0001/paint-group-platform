"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { reportIfError } from "@/lib/monitoring/report";
import { withdrawOfferAction, sendOfferAction } from "@/app/pc/schedule/actions";
import {
  OFFER_COLUMNS,
  formatDMY,
  OFFER_CHIP_STAFF,
  effectiveState,
  formatCountdown,
  isLive,
  msRemaining,
  type BookingOffer,
} from "@/lib/scheduling/offers";

const money = (c: number | null) =>
  c == null ? "—" : "$" + (c / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });

const fmt = (d: string | null) => formatDMY(d);

/**
 * Staff control for offering an issued work order to a contractor.
 *
 * Deliberately lives on the work order rather than a scheduling board — the
 * drag-and-drop timeline is a later phase. Everything here goes through the
 * database RPCs so the 24-hour rule and one-live-offer-per-job rule hold even
 * if this page is stale.
 */
export default function OfferPanel({
  workOrderId,
  contractorId,
  contractorName,
  defaultStart,
  issued,
}: {
  workOrderId: string | null;
  contractorId: string | null;
  contractorName: string;
  defaultStart: string | null;
  /** No hours or payment props: the server derives both. Deliberately absent. */
  issued: boolean;
}) {
  const supabase = createClient();
  const [offers, setOffers] = useState<BookingOffer[]>([]);
  // Seeded from whether there's anything to load, so the effect never has to
  // set state synchronously (which would cascade renders).
  const [loading, setLoading] = useState(Boolean(workOrderId));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [start, setStart] = useState(defaultStart ?? "");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Pure fetch — no state writes, so the effect below can await it without
  // triggering a cascading render.
  async function fetchOffers(): Promise<BookingOffer[]> {
    if (!workOrderId) return [];
    // Sweep lapsed offers first so a stale one is never shown as live.
    reportIfError(await supabase.rpc("expire_booking_offers"), {
      where: "offerPanel.expireSweep",
      bestEffort: true,
    });
    const { data } = await supabase
      .from("booking_offers")
      .select(OFFER_COLUMNS)
      .eq("work_order_id", workOrderId)
      .order("offered_at", { ascending: false });
    return (data as BookingOffer[] | null) ?? [];
  }

  /** Refresh after an action. Called from event handlers, never from an effect. */
  async function load() {
    setOffers(await fetchOffers());
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchOffers();
      if (cancelled) return;
      setOffers(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId]);

  const liveOffer = offers.find((o) => isLive(effectiveState(o)));

  async function sendOffer() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      if (!workOrderId) throw new Error("Save and accept the estimate first — the work order doesn't exist yet.");
      if (!contractorId) throw new Error("Choose a contractor above first.");
      if (!issued) throw new Error("Issue the work order before offering it.");
      if (!start) throw new Error("Pick a start date.");

      // The server derives the payment from the work order — this screen no
      // longer sends an amount at all.
      const r = await sendOfferAction({
        workOrderId,
        contractorId,
        startDate: start,
        endDate: end || null,
        note,
      });
      if (!r.ok) throw new Error(r.message);
      setMsg("Offer sent. The contractor has 24 hours to respond.");
      setNote("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string, expectedState: string) {
    setBusy(true);
    setErr("");
    setMsg("");
    // Goes through the server boundary: one transaction, and the expected state
    // guards against a stale tab withdrawing something already answered.
    const r = await withdrawOfferAction({ offerId: id, expectedState });
    if (r.ok) setMsg("Offer withdrawn.");
    else setErr(r.message);
    await load();
    setBusy(false);
  }

  async function resolve(id: string, approve: boolean) {
    setBusy(true);
    setErr("");
    setMsg("");
    const { data, error } = await supabase.rpc("resolve_proposed_offer", { p_offer_id: id, p_approve: approve });
    if (error) setErr(error.message);
    else if (String(data).startsWith("error:")) setErr(String(data));
    else setMsg(approve ? "New date approved — the job is booked." : "Proposal declined; the job is back in the pool.");
    await load();
    setBusy(false);
  }

  if (!workOrderId) {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
        <div className="font-medium text-gray-900">Booking</div>
        A work order is created when the estimate is accepted. Offers can be sent after that.
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-gray-900">Booking</div>
        {liveOffer && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 font-mono text-xs font-semibold text-amber-800">
            {formatCountdown(msRemaining(liveOffer.expires_at))} left
            <span className="hidden">{tick}</span>
          </span>
        )}
      </div>

      {err && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {msg && <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}

      {loading ? (
        <div className="mt-3 text-sm text-gray-400">Loading…</div>
      ) : liveOffer ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="font-medium text-amber-900">{OFFER_CHIP_STAFF[effectiveState(liveOffer)]}</div>
          <div className="mt-1 text-amber-800">
            {contractorName || "Contractor"} · {fmt(liveOffer.start_date)}
            {liveOffer.end_date ? ` – ${fmt(liveOffer.end_date)}` : ""} · {money(liveOffer.payment_cents)}
          </div>
          {liveOffer.state === "proposed" && (
            <div className="mt-2 rounded-md bg-white p-2">
              <div className="text-gray-900">
                They&rsquo;ve proposed <strong>{fmt(liveOffer.proposed_start_date)}</strong> instead.
              </div>
              {liveOffer.response_note && <div className="mt-1 text-gray-500">“{liveOffer.response_note}”</div>}
              <div className="mt-2 flex gap-2">
                <button onClick={() => resolve(liveOffer.id, true)} disabled={busy} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  Approve new date
                </button>
                <button onClick={() => resolve(liveOffer.id, false)} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50">
                  Decline it
                </button>
              </div>
            </div>
          )}
          <button onClick={() => withdraw(liveOffer.id, effectiveState(liveOffer))} disabled={busy} className="mt-2 text-xs font-medium text-amber-900 underline hover:no-underline disabled:opacity-50">
            Withdraw offer
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-gray-500">
            Offers run for 24 hours. Nothing reaches the customer until the contractor accepts.
          </p>
          <div className="flex flex-wrap gap-2">
            <label className="text-xs text-gray-600">
              Start
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="ml-2 rounded-md border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs text-gray-600">
              End
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="ml-2 rounded-md border border-gray-300 px-2 py-1 text-sm" />
            </label>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the contractor (optional)"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            onClick={sendOffer}
            disabled={busy || !contractorId || !issued}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accentink hover:bg-paint disabled:opacity-50"
          >
            {busy ? "Sending…" : `Offer this job${contractorName ? ` to ${contractorName}` : ""}`}
          </button>
          {!issued && <div className="text-xs text-gray-400">Issue the work order first.</div>}
          {!contractorId && <div className="text-xs text-gray-400">Choose a contractor above first.</div>}
        </div>
      )}

      {offers.filter((o) => !isLive(effectiveState(o))).length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-gray-400">Offer history</div>
          <ul className="mt-1 space-y-1 text-xs text-gray-500">
            {offers.filter((o) => !isLive(effectiveState(o))).map((o) => (
              <li key={o.id} className="flex justify-between gap-3">
                <span>
                  {OFFER_CHIP_STAFF[effectiveState(o)]}
                  {o.decline_reason ? ` — ${o.decline_reason}` : ""}
                </span>
                <span className="tabular-nums">{fmt(o.start_date)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
