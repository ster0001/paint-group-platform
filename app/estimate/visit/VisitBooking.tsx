"use client";

import { useEffect, useState } from "react";
import type { OfferedDay } from "@/lib/visits/schedule";
import type { ZoneOutcome } from "@/lib/visits/zones";

/**
 * Book a site visit — the customer's screens, mockup 4 verbatim (addendum A
 * §9): details (only when we do not hold them), calendar, code, booked, and
 * the plain "that time was released" with a button back to the calendar.
 * Nothing here decides anything: every tap posts to /api/visits/* and shows
 * what came back.
 */

type Hold = { id: string; startsAt: string; expiresAt: string; maskedMobile: string };
type Slot = OfferedDay["slots"][number];
type SlotWords = { startsAt: string; dayWords: string; timeWords: string; visitEndWords: string; address: string };
type Screen = "details" | "calendar" | "code" | "done" | "expired" | "request" | "request_sent" | "out_of_area" | "message" | "message_sent";
const DAYS = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5]] as const;
const PARTS = [["Morning", "morning"], ["Afternoon", "afternoon"], ["Either", "either"]] as const;

const endWords = (s: Slot) => {
  const d = new Date(s.visitEndsAt);
  const p = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d);
  const h = p.find((x) => x.type === "hour")?.value ?? "", m = p.find((x) => x.type === "minute")?.value ?? "", ap = (p.find((x) => x.type === "dayPeriod")?.value ?? "").toLowerCase().replace(/\./g, "");
  return `${h}:${m} ${ap}`;
};
const words = (s: Slot, address: string): SlotWords => ({ startsAt: s.startsAt, dayWords: s.dayWords, timeWords: s.timeWords, visitEndWords: endWords(s), address });
const short = (d: OfferedDay) => ({ dow: d.dayWords.split(" ")[0].slice(0, 3), num: d.date.slice(8, 10).replace(/^0/, ""), mon: d.dayWords.split(" ")[2]?.slice(0, 3) ?? "" });

export default function VisitBooking(props: {
  estimateId: string; suburb: string | null; address: string; hasAddress: boolean;
  known: { name?: string; email?: string; mobile?: string }; hasContact: boolean;
  zone: ZoneOutcome; days: OfferedDay[]; hold: Hold | null; companyPhone: string | null;
  /** S5: "ok", or why no live times are shown ("none" = no connected calendar, "unavailable" = Google could not be reached). */
  calendar?: "ok" | "none" | "unavailable";
}) {
  const { estimateId } = props;
  const [days, setDays] = useState(props.days);
  const [hasContact, setHasContact] = useState(props.hasContact);
  const [det, setDet] = useState({ name: props.known.name ?? "", address: props.hasAddress ? props.address : "", email: props.known.email ?? "", mobile: props.known.mobile ? localMobile(props.known.mobile) : "" });
  const [dayIx, setDayIx] = useState(0);
  const [pick, setPick] = useState<Slot | null>(null);
  const [hold, setHold] = useState<(Hold & { slot: SlotWords }) | null>(() => {
    if (!props.hold) return null;
    const s = props.days.flatMap((d) => d.slots).find((x) => x.startsAt === props.hold!.startsAt);
    return s ? { ...props.hold, slot: words(s, props.address) } : null;
  });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [screen, setScreen] = useState<Screen>(() => {
    if (props.zone === "out_of_area") return "out_of_area";
    if (!props.hasContact) return "details";
    if (props.zone === "pre_arranged" || props.zone === "unmapped") return "request";
    if (props.calendar && props.calendar !== "ok") return "request";
    return props.hold ? "code" : "calendar";
  });
  const [prefs, setPrefs] = useState<number[]>([]);
  const [part, setPart] = useState<"morning" | "afternoon" | "either" | "">("");
  const [message, setMessage] = useState("");
  const [clientId] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`));
  const notBookable = props.zone === "pre_arranged" || props.zone === "unmapped" || (props.calendar !== undefined && props.calendar !== "ok");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // The hold's clock. When it runs out the customer is told plainly (4.3).
  useEffect(() => {
    if (screen !== "code" || !hold) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(hold.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setScreen("expired");
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [screen, hold]);

  const cur = days[Math.min(dayIx, Math.max(0, days.length - 1))];
  const tel = props.companyPhone ? `tel:${props.companyPhone.replace(/\s+/g, "")}` : null;
  const tightenHref = `/estimate/scope?id=${estimateId}`;

  async function post<T>(path: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; code: string; attemptsLeft?: number | null }> {
    setBusy(true); setErr("");
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estimateId, ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, status: r.status, error: j.error ?? "That didn't go through — please try again.", code: j.code ?? "failed", attemptsLeft: j.attemptsLeft };
      return { ok: true, data: j as T };
    } catch {
      return { ok: false, status: 0, error: "That didn't go through — check your connection and try again.", code: "network" };
    } finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true);
    try {
      const r = await fetch(`/api/visits/availability?estimateId=${estimateId}`);
      const j = await r.json();
      if (r.ok) { setDays(j.days ?? []); setDayIx(0); setPick(null); }
    } finally { setBusy(false); }
  }

  async function saveDetails() {
    const ok = det.name.trim() && /.+@.+\..+/.test(det.email) && det.mobile.replace(/\D/g, "").length >= 10 && (props.hasAddress || det.address.trim());
    if (!ok) { setErr(props.hasAddress ? "Please fill in your name, email and mobile number." : "Please fill in your name, address, email and mobile number."); return; }
    const r = await post("/api/visits/details", { name: det.name, email: det.email, mobile: det.mobile, ...(props.hasAddress ? {} : { street: det.address }) });
    if (!r.ok) { setErr(r.error); return; }
    setHasContact(true);
    if (props.zone === "out_of_area") { setScreen("message"); return; }
    if (notBookable) { setScreen("request"); return; }
    await refresh();
    setScreen("calendar");
  }

  async function sendRequest() {
    if (!prefs.length || !part) return;
    const r = await post("/api/visits/request", { kind: "time", name: det.name || props.known.name || "", email: det.email || props.known.email || "", mobile: det.mobile || props.known.mobile || "", preferredDays: prefs, timeOfDay: part });
    if (!r.ok) { if (r.code === "no_contact" || r.code === "invalid") { setScreen("details"); setErr(r.error); return; } setErr(r.error); return; }
    setScreen("request_sent");
  }
  async function sendMessage() {
    if (!message.trim()) { setErr("Please write your message first."); return; }
    const body: Record<string, unknown> = { clientId, body: message.trim() };
    if (!hasContact) body.contact = { name: det.name, email: det.email, mobile: det.mobile, ...(props.hasAddress ? {} : { street: det.address }) };
    const r = await post("/api/visits/message", body);
    if (!r.ok) { setErr(r.error); return; }
    setScreen("message_sent");
  }

  async function book() {
    if (!pick) return;
    const r = await post<Hold & { holdId: string; slot: SlotWords }>("/api/visits/hold", { startsAt: pick.startsAt });
    if (!r.ok) {
      if (r.code === "no_contact") { setScreen("details"); return; }
      if (r.code === "calendar_unavailable") { setErr(r.error); setScreen("request"); return; }
      setErr(r.error);
      if (r.code === "taken" || r.code === "not_offered") await refresh();
      return;
    }
    setHold({ id: r.data.holdId, startsAt: r.data.slot.startsAt, expiresAt: r.data.expiresAt, maskedMobile: r.data.maskedMobile, slot: r.data.slot });
    setCode(""); setNote("");
    setScreen("code");
  }

  async function confirm() {
    if (!hold || code.length !== 6) return;
    const r = await post<{ visitId: string; slot: SlotWords }>("/api/visits/confirm", { holdId: hold.id, code });
    if (!r.ok) {
      if (r.code === "expired" || r.code === "ended") { setScreen("expired"); return; }
      if (r.code === "calendar_unavailable") { setErr(r.error); setScreen("request"); return; }
      if (r.code === "unavailable") { setErr(r.error); await refresh(); setScreen("calendar"); return; }
      setErr(r.error); setCode("");
      return;
    }
    setHold({ ...hold, slot: r.data.slot });
    setScreen("done");
  }

  async function resend() {
    if (!hold) return;
    const r = await post("/api/visits/resend", { holdId: hold.id });
    setNote(r.ok ? "We have sent a new code." : r.error);
    if (!r.ok && (r.code === "taken")) setScreen("expired");
  }

  const summary = (s: SlotWords) => (
    <div className="wz-summary" data-testid="visit-summary">
      <b>{s.dayWords}, {s.timeWords} to {s.visitEndWords}</b>
      <span>{s.address}</span>
    </div>
  );
  const brand = <p className="wz-kick">Your estimate</p>;

  if (screen === "details") {
    return (
      <main className="wz-wrap" data-testid="visit-details">
        {brand}
        <h1>A few details first</h1>
        <p>We need these to book your visit and send your confirmation.</p>
        <label className="wz-field"><span>Full name</span><input value={det.name} onChange={(e) => setDet({ ...det, name: e.target.value })} autoComplete="name" data-testid="visit-name" /></label>
        {!props.hasAddress && <label className="wz-field"><span>Address of the property</span><input value={det.address} onChange={(e) => setDet({ ...det, address: e.target.value })} autoComplete="street-address" data-testid="visit-address" /></label>}
        <label className="wz-field"><span>Email</span><input type="email" value={det.email} onChange={(e) => setDet({ ...det, email: e.target.value })} autoComplete="email" data-testid="visit-email" /></label>
        <label className="wz-field"><span>Mobile number</span><input type="tel" inputMode="tel" placeholder="04" value={det.mobile} onChange={(e) => setDet({ ...det, mobile: e.target.value })} autoComplete="tel" data-testid="visit-mobile" /></label>
        {err && <p className="wz-err" role="alert" data-testid="visit-error">{err}</p>}
        <button type="button" className="wz-btn" disabled={busy} onClick={() => void saveDetails()} data-testid="visit-details-go">Continue</button>
        <p className="wz-chint"><a className="wz-linkish" href={tightenHref}>Back</a></p>
      </main>
    );
  }

  if (screen === "request") {
    const pre = props.zone === "pre_arranged";
    return (
      <main className="wz-wrap" data-testid="visit-request">
        {brand}
        <h1>{pre && props.suburb ? `We visit ${props.suburb} by arrangement` : "Request a time"}</h1>
        <p>{pre ? "Tell us which days suit you and we will confirm a time with you." : props.calendar === "unavailable" ? "We can't show live times just now. Tell us which days suit you and we will come back to you with a time." : "Tell us which days suit you and we will come back to you with a time."}</p>
        {props.calendar && props.calendar !== "ok" && <p className="wz-chint" data-testid="visit-calendar-state" data-state={props.calendar} />}
        <p className="wz-lbl">Days that suit</p>
        <div className="wz-chips" data-testid="visit-pref-days">
          {DAYS.map(([label, d]) => (
            <button key={d} type="button" className={`wz-chip${prefs.includes(d) ? " on" : ""}`} aria-pressed={prefs.includes(d)} data-testid={`visit-day-${d}`}
              onClick={() => setPrefs((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]))}>{label}</button>
          ))}
        </div>
        <p className="wz-lbl">Time of day</p>
        <div className="wz-chips" data-testid="visit-pref-part">
          {PARTS.map(([label, key]) => (
            <button key={key} type="button" className={`wz-chip${part === key ? " on" : ""}`} aria-pressed={part === key} data-testid={`visit-part-${key}`} onClick={() => setPart(key)}>{label}</button>
          ))}
        </div>
        {err && <p className="wz-err" role="alert" data-testid="visit-error">{err}</p>}
        <button type="button" className="wz-btn" disabled={busy || !prefs.length || !part} onClick={() => void sendRequest()} data-testid="visit-request-send">Send my request</button>
        <p className="wz-chint">{notBookable ? <a className="wz-linkish" href={tightenHref}>Back to your estimate</a> : <button type="button" className="wz-linkish" onClick={() => setScreen("calendar")} data-testid="visit-request-back">Back to the calendar</button>}</p>
      </main>
    );
  }

  if (screen === "request_sent") {
    return (
      <main className="wz-wrap" data-testid="visit-request-sent">
        {brand}
        <div className="wz-sent-status" aria-hidden="true">✓</div>
        <h1>Thank you, we have your request</h1>
        <p>We will be in touch within one working day to arrange your site visit.</p>
        <p className="wz-chint"><a className="wz-linkish" href={tightenHref}>Back to your estimate</a></p>
      </main>
    );
  }

  if (screen === "out_of_area") {
    return (
      <main className="wz-wrap" data-testid="visit-out">
        {brand}
        <h1>We don&rsquo;t currently visit {props.suburb ?? "that area"}</h1>
        <p>We are sorry, this address is outside the area we cover for site visits. You are welcome to send us a message and we will let you know if we can help.</p>
        <button type="button" className="wz-btn" onClick={() => setScreen(hasContact ? "message" : "details")} data-testid="visit-message-go">Send us a message</button>
        <p className="wz-chint"><a className="wz-linkish" href={tightenHref}>Back to your estimate</a></p>
      </main>
    );
  }

  if (screen === "message") {
    return (
      <main className="wz-wrap" data-testid="visit-message">
        {brand}
        <h1>Send us a message</h1>
        <p>Tell us a little about your project and we will reply by email or phone.</p>
        <label className="wz-field"><span>Your message</span><textarea value={message} rows={5} onChange={(e) => setMessage(e.target.value)} data-testid="visit-message-text" /></label>
        {err && <p className="wz-err" role="alert" data-testid="visit-error">{err}</p>}
        <button type="button" className="wz-btn" disabled={busy} onClick={() => void sendMessage()} data-testid="visit-message-send">Send my message</button>
        <p className="wz-chint"><button type="button" className="wz-linkish" onClick={() => setScreen(props.zone === "out_of_area" ? "out_of_area" : "calendar")}>Back</button></p>
      </main>
    );
  }

  if (screen === "message_sent") {
    return (
      <main className="wz-wrap" data-testid="visit-message-sent">
        {brand}
        <div className="wz-sent-status" aria-hidden="true">✓</div>
        <h1>Thank you, your message is with us</h1>
        <p>We will reply within one working day.</p>
        <p className="wz-chint"><a className="wz-linkish" href={tightenHref}>Back to your estimate</a></p>
      </main>
    );
  }

  if (screen === "expired") {
    return (
      <main className="wz-wrap" data-testid="visit-expired">
        {brand}
        <h1>That time has been released</h1>
        <p>The ten minutes to enter your code ran out, so the time is free for others again. Pick a time and we will send a new code.</p>
        <button type="button" className="wz-btn" disabled={busy} onClick={() => { setHold(null); setCode(""); void refresh().then(() => setScreen("calendar")); }} data-testid="visit-expired-back">Back to the calendar</button>
      </main>
    );
  }

  if (screen === "code" && hold) {
    return (
      <main className="wz-wrap" data-testid="visit-code">
        {brand}
        <h1>Confirm it&rsquo;s you</h1>
        {summary(hold.slot)}
        <p>We have sent a 6-digit code by text to {hold.maskedMobile}. Enter it to book your visit.</p>
        <label className="wz-field"><span>Code from your text</span>
          <input className="wz-numin" inputMode="numeric" maxLength={6} value={code} autoComplete="one-time-code" data-testid="visit-code-input"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
        {err && <p className="wz-err" role="alert" data-testid="visit-error">{err}</p>}
        {note && <p className="wz-note" data-testid="visit-note">{note}</p>}
        <button type="button" className="wz-btn" disabled={busy || code.length !== 6} onClick={() => void confirm()} data-testid="visit-confirm">Book my visit</button>
        <p className="wz-chint">
          <button type="button" className="wz-linkish" disabled={busy} onClick={() => void resend()} data-testid="visit-resend">Send a new code</button>
          {" · "}
          <button type="button" className="wz-linkish" disabled={busy} onClick={() => { setScreen("calendar"); setErr(""); }} data-testid="visit-code-back">Back</button>
          {secondsLeft != null && <span style={{ marginLeft: 8, opacity: 0.7 }} data-testid="visit-hold-clock">Held for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</span>}
        </p>
      </main>
    );
  }

  if (screen === "done" && hold) {
    return (
      <main className="wz-wrap" data-testid="visit-done">
        {brand}
        <div className="wz-sent-status" aria-hidden="true">✓</div>
        <h1>Your site visit is booked</h1>
        {summary(hold.slot)}
        <p>We have sent the details by text, and a calendar invitation by email. We will send a reminder by text the evening before. If you need to cancel, decline the invitation or call us.</p>
        <p className="wz-chint"><a className="wz-linkish" href={tightenHref}>Back to your estimate</a></p>
      </main>
    );
  }

  // calendar
  if (!days.length) {
    return (
      <main className="wz-wrap" data-testid="visit-request">
        {brand}
        <h1>Request a time</h1>
        <p>We have nothing free in {props.suburb ?? "your area"} in the next three weeks. Tell us which days suit you and we will come back to you with a time.</p>
        <button type="button" className="wz-btn" onClick={() => setScreen("request")} data-testid="visit-request-go">Request a time</button>
        <p className="wz-chint">Rather not wait for a visit? <a className="wz-linkish" href={tightenHref}>Tighten your price online</a></p>
      </main>
    );
  }
  return (
    <main className="wz-wrap" data-testid="visit-calendar">
      {brand}
      <h1>Choose a time for your site visit</h1>
      <p>These are the times we are in {props.suburb ?? "your area"} and nearby.</p>
      <div className="wz-chips" role="tablist" aria-label="Day" data-testid="visit-days">
        {days.map((d, i) => {
          const s = short(d);
          return (
            <button key={d.date} type="button" role="tab" aria-selected={i === dayIx} className={`wz-chip${i === dayIx ? " on" : ""}`} data-testid="visit-day" data-date={d.date}
              onClick={() => { setDayIx(i); setPick(null); }}>
              <i>{s.dow}</i> <b>{s.num}</b> <i>{s.mon}</i>
            </button>
          );
        })}
      </div>
      <div className="wz-slots" data-testid="visit-times">
        {cur?.slots.map((s) => (
          <button key={s.startsAt} type="button" className={`wz-slot${pick?.startsAt === s.startsAt ? " on" : ""}`} aria-pressed={pick?.startsAt === s.startsAt} data-testid="visit-time" data-starts-at={s.startsAt}
            onClick={() => setPick(s)}>{s.timeWords}</button>
        ))}
      </div>
      {err && <p className="wz-err" role="alert" data-testid="visit-error">{err}</p>}
      <button type="button" className="wz-btn" disabled={!pick || busy || !hasContact && false} onClick={() => void book()} data-testid="visit-book">
        {pick ? `Book ${pick.dayWords.split(" ")[0]} at ${pick.timeWords}` : "Choose a time"}
      </button>
      <p className="wz-chint"><button type="button" className="wz-linkish" onClick={() => setScreen("request")} data-testid="visit-none-suit">None of these suit? Request a different time</button></p>
      <p className="wz-chint">Rather not wait for a visit? <a className="wz-linkish" href={tightenHref} data-testid="visit-tighten">Tighten your price online</a></p>
      {tel && <p className="wz-chint">Or call us on <a className="wz-linkish" href={tel}>{props.companyPhone}</a>.</p>}
    </main>
  );
}

const LOCAL = (m: string) => m;
function localMobile(e164: string): string {
  if (/^\+61\d{9}$/.test(e164)) { const d = `0${e164.slice(3)}`; return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`; }
  return LOCAL(e164);
}
