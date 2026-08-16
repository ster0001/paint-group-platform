"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  DECLINE_REASONS,
  effectiveState,
  formatCountdown,
  msRemaining,
  suburbOnly,
  OFFER_CHIP,
  type BookingOffer,
} from "@/lib/scheduling/offers";
import Link from "next/link";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";
import FinishChip from "@/app/components/FinishChip";
import CalendarGrid, { type PortalBlock, type PortalJobDay } from "@/app/portal/calendar/CalendarGrid";

const money = (c: number | null) =>
  c == null ? "—" : "$" + (c / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });

const dateRange = (start: string, end: string | null) => {
  const f = (d: string) =>
    new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" })
      .format(new Date(d + "T00:00:00"))
      .toUpperCase();
  return end && end !== start ? `${f(start)} – ${f(end)}` : f(start);
};

export default function OfferCard({
  offer,
  woRef,
  doc,
  workOrderId,
  myBlocks,
  myJobDays,
}: {
  offer: BookingOffer;
  woRef: string;
  doc: WorkOrderDoc | null;
  workOrderId: string;
  myBlocks: PortalBlock[];
  myJobDays: PortalJobDay[];
}) {
  const router = useRouter();
  const supabase = createClient();

  // Live countdown. Recomputed client-side each second; the database re-checks
  // expiry on the actual response, so a stale page can't sneak an answer in.
  const [left, setLeft] = useState(() => msRemaining(offer.expires_at));
  useEffect(() => {
    const t = setInterval(() => setLeft(msRemaining(offer.expires_at)), 1000);
    return () => clearInterval(t);
  }, [offer.expires_at]);

  const [sheet, setSheet] = useState<null | "propose" | "decline">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [proposedDate, setProposedDate] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState(DECLINE_REASONS[0]);

  const state = effectiveState({ state: offer.state, expires_at: offer.expires_at });
  const live = state === "offered";
  const chip = OFFER_CHIP[state];

  async function respond(action: "accept" | "propose" | "decline") {
    setBusy(true);
    setErr("");
    try {
      const { data, error } = await supabase.rpc("respond_to_offer", {
        p_offer_id: offer.id,
        p_action: action,
        p_note: note,
        p_proposed_start: action === "propose" ? proposedDate || null : null,
        p_decline_reason: action === "decline" ? reason : "",
      });
      if (error) throw error;
      const result = String(data ?? "");
      if (result.startsWith("error:")) {
        // Server-side refusals, in the contractor's language.
        const map: Record<string, string> = {
          "error:expired": "This offer has expired — it's gone back to Paint Group.",
          "error:not_yours": "This offer isn't yours.",
          "error:no_date": "Pick the date you'd rather start.",
          "error:not_a_contractor": "Your account isn't set up as a contractor.",
        };
        setErr(map[result] ?? `Couldn't record that (${result.replace("error:", "")}).`);
        router.refresh();
        return;
      }
      setSheet(null);
      router.refresh();
    } catch (e) {
      const m = typeof e === "object" && e !== null && "message" in e ? String((e as { message: string }).message) : String(e);
      setErr(m);
    } finally {
      setBusy(false);
    }
  }

  const hours = offer.hours_allowance;

  return (
    <div className={`card ${live ? "amberish" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--cyan)" }}>
          OFFER · {woRef}
        </span>
        {live ? (
          <span className="cd">{formatCountdown(left)}</span>
        ) : (
          <span className={`chip ${chip.cls}`}>{chip.label}</span>
        )}
      </div>

      <h2 style={{ marginTop: 8 }}>{doc?.jobTitle || "Painting works"}</h2>
      <p className="slab" style={{ marginBottom: 6 }}>
        {suburbOnly(doc?.jobAddress)} · full address on acceptance
      </p>

      {doc?.finishCode && (
        <div style={{ margin: "8px 0" }}>
          <FinishChip code={doc.finishCode} />
        </div>
      )}

      <div className="frow">
        <span className="l">Dates</span>
        <span className="v">{dateRange(offer.start_date, offer.end_date)}</span>
      </div>
      {hours != null && (
        <div className="frow">
          <span className="l">Hours allowance</span>
          <span className="v">{Number(hours).toFixed(1)} H</span>
        </div>
      )}
      <div className="frow">
        <span className="l">Your price</span>
        <span className="v cyan" style={{ fontSize: 14 }}>
          {money(offer.payment_cents)}
        </span>
      </div>
      {offer.staff_note && (
        <div className="frow">
          <span className="l">Note</span>
          <span className="v">{offer.staff_note}</span>
        </div>
      )}

      {/* Scope summary — enough to decide on, without the full document. */}
      {doc && doc.areas.length > 0 && (
        <>
          <p className="slab" style={{ margin: "12px 0 6px" }}>Scope summary</p>
          <ul style={{ fontSize: "12.5px", color: "var(--muted)", paddingLeft: 16 }}>
            {doc.areas.slice(0, 6).map((a) => (
              <li key={a.id} style={{ padding: "2px 0" }}>
                {a.title} — {a.surfaces.length} {a.surfaces.length === 1 ? "surface" : "surfaces"}
                {a.finishOverridden && a.finishCode ? ` · ${a.finishCode}` : ""}
              </li>
            ))}
            {doc.areas.length > 6 && <li style={{ padding: "2px 0" }}>+ {doc.areas.length - 6} more</li>}
          </ul>
        </>
      )}

      {/* The full job sheet, still suburb-only until they accept. */}
      <Link href={`/portal/jobs/${workOrderId}`} className="btn gh">
        View full work order
      </Link>

      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}

      {state === "proposed" && (
        <div className="ok" style={{ marginTop: 12 }}>
          Proposal sent — Paint Group will approve or decline your new start date.
          The 24-hour clock has stopped; you responded in time.
        </div>
      )}
      {state === "accepted" && (
        <div className="ok" style={{ marginTop: 12 }}>
          Booked. The full address and customer details are now on your job.
        </div>
      )}
      {state === "expired" && (
        <div style={{ marginTop: 12, fontSize: "12.5px", color: "var(--muted)" }}>
          This offer ran out before it was answered, so it went back to Paint Group
          for reassignment.
        </div>
      )}
      {state === "declined" && (
        <div style={{ marginTop: 12, fontSize: "12.5px", color: "var(--muted)" }}>
          No hard feelings — the job returned to Paint Group. Your response was inside
          the window.
        </div>
      )}

      {live && (
        <div className="resp">
          <button className="btn cy full" disabled={busy} onClick={() => respond("accept")}>
            {busy ? "Working…" : "Accept — lock it in"}
          </button>
          <button className="btn gh" disabled={busy} onClick={() => setSheet("propose")}>
            Propose new date
          </button>
          <button className="btn dim" disabled={busy} onClick={() => setSheet("decline")}>
            Decline
          </button>
        </div>
      )}

      {/* ---- propose sheet ---- */}
      {sheet === "propose" && (
        <div className="sheetwrap on">
          <div className="scrim" onClick={() => setSheet(null)} />
          <div className="sheet">
            <h3>Propose a new start date</h3>
            <p className="slab">Pick against your own calendar — your blocked days are marked</p>
            <CalendarGrid
              blocks={myBlocks}
              jobDays={myJobDays}
              mode="pick"
              selectedDate={proposedDate || null}
              onPickDate={(d) => setProposedDate(d)}
            />
            <textarea
              rows={2}
              placeholder="Optional note — e.g. finishing another job Monday"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {err && <div className="err">{err}</div>}
            <button className="btn cy" disabled={busy || !proposedDate} onClick={() => respond("propose")}>
              {busy ? "Sending…" : "Send proposal to Paint Group"}
            </button>
            <button className="btn gh" onClick={() => setSheet(null)}>Back</button>
          </div>
        </div>
      )}

      {/* ---- decline sheet ---- */}
      {sheet === "decline" && (
        <div className="sheetwrap on">
          <div className="scrim" onClick={() => setSheet(null)} />
          <div className="sheet">
            <h3>Decline this offer</h3>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {DECLINE_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <textarea rows={2} placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
            {err && <div className="err">{err}</div>}
            <button className="btn cy" disabled={busy} onClick={() => respond("decline")}>
              {busy ? "Sending…" : "Confirm decline"}
            </button>
            <button className="btn gh" onClick={() => setSheet(null)}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
