"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ProgressPreview } from "@/lib/progress-preview/build";
import "@/app/account/account.css";
import "../progress-phone.css";

/**
 * The phone (brief v4 §7). A text arrives on the lock screen, gets tapped,
 * the job opens and the updates rise one by one, ending with the "finished"
 * text. Plays once when 40% in view, loops after a 6.5 s hold, pauses when
 * off-screen or the tab is hidden and resumes from the start. Never two
 * sequences at once — every timer carries the run id that started it.
 *
 * The feed inside the app pane is the portal's own JobTimeline, server-
 * rendered and handed in as `feed`; this component only decides how many of
 * its items are visible (`data-shown`) and scrolls the newest into view.
 *
 * Reduced motion: no animation, the final state (everything visible) — done
 * in CSS as well as here, so it holds before hydration.
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function readReducedMotion() { return window.matchMedia(REDUCED_MOTION).matches; }

// Steps: 0 lock · 1 first text in · 2 text tapped · 3 app open · 3+k k items shown · FINAL = all shown + last text.
const STEP_APP = 3;
const HOLD_BEFORE_LOOP_MS = 6500;

export default function ProgressPhone({ preview, feed }: { preview: ProgressPreview; feed: ReactNode }) {
  const n = preview.updates.length;
  const FINAL = STEP_APP + n + 1;
  const reduced = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  // `run` > 0 means a sequence is playing; each start bumps it so the effect
  // below tears the old timers down and begins again from the lock screen.
  const [run, setRun] = useState(0);
  const [rawStep, setStep] = useState(0);
  const step = reduced ? FINAL : rawStep;
  const phoneRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef({ visible: false, tabShown: true, playing: false });

  const start = useCallback(() => { activeRef.current.playing = true; setStep(0); setRun((r) => r + 1); }, []);
  const stop = useCallback(() => { activeRef.current.playing = false; setStep(0); setRun(0); }, []);

  // The runner: one timer chain per run; cancelled the moment run changes.
  useEffect(() => {
    if (run === 0 || reduced) return;
    let cancelled = false;
    let timer: number | null = null;
    const advance = (from: number) => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        const next = from >= FINAL ? 0 : from + 1; // past the end: hold, then loop from the lock screen
        setStep(next);
        advance(next);
      }, from >= FINAL ? HOLD_BEFORE_LOOP_MS : delayAfter(from, n));
    };
    advance(0);
    return () => { cancelled = true; if (timer != null) window.clearTimeout(timer); };
  }, [run, reduced, FINAL, n]);

  // Visibility: 40% of the phone in view AND the tab visible → play; otherwise stop (resume from the start).
  useEffect(() => {
    if (reduced) return;
    const el = phoneRef.current;
    if (!el) return;
    const a = activeRef.current;
    const sync = () => {
      const on = a.visible && a.tabShown;
      if (on && !a.playing) start();
      else if (!on && a.playing) stop();
    };
    const io = new IntersectionObserver((entries) => { a.visible = entries[0]?.isIntersecting ?? false; sync(); }, { threshold: 0.4 });
    io.observe(el);
    const onVis = () => { a.tabShown = document.visibilityState === "visible"; sync(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, [reduced, start, stop]);

  // Scroll the newest item into view inside the app pane.
  const shown = Math.max(0, Math.min(n, step - STEP_APP));
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    if (shown === 0) { app.scrollTop = 0; return; }
    const items = app.querySelectorAll<HTMLElement>(".tl-item");
    const li = items[shown - 1];
    const top = app.querySelector<HTMLElement>(".pp-top");
    if (!li) return;
    const y = li.getBoundingClientRect().top - app.getBoundingClientRect().top + app.scrollTop - (top?.offsetHeight ?? 0) - 14;
    // A hidden document does not run smooth scrolling at all (the scroll
    // simply never happens), so a background tab jumps instead.
    app.scrollTo({ top: Math.max(0, y), behavior: reduced || document.hidden ? "auto" : "smooth" });
  }, [shown, reduced]);

  const replay = () => { if (!reduced) start(); };

  const current = shown > 0 ? preview.updates[shown - 1] : null;
  const done = step >= FINAL;
  const lockGone = step >= STEP_APP;
  const sms1 = step === 1 ? "in" : step === 2 ? "in tap" : "";
  const { header, lead } = preview;

  return (
    <section className="pp" id="live-progress" aria-label="How you will follow your job" data-testid="live-progress" data-set={preview.set} data-step={step}>
      <p className="pp-label" data-testid="pp-label">{preview.label}</p>
      <p className="pp-sr" data-testid="pp-summary">{preview.summary}</p>

      <div className="pp-stage">
        <div className="pp-phone" aria-hidden="true" ref={phoneRef} data-testid="pp-phone">
          <div className="pp-screen">
            <div className={`pp-lock${lockGone ? " gone" : ""}`} data-testid="pp-lock">
              <div className="pp-time">{preview.lock.time}</div>
              <div className="pp-date">{preview.lock.date}</div>
              <div className={`pp-sms ${sms1}`} data-testid="pp-sms1">
                <div className="pp-ico">💬</div>
                <div><div className="pp-hd">Paint Group<span>now</span></div>{withLink(preview.texts.first, preview.link)}</div>
              </div>
            </div>

            <div className="pp-app" ref={appRef}>
              <div className="pp-top">
                <div className="pp-brand"><span>Paint Group</span><span className="pp-mono">{header.brandRight}</span></div>
                <div className="pp-addr">{header.address}</div>
                {header.sub && <div className="pp-mono pp-sub">{header.sub}</div>}
                <div className="pp-row">
                  <span className={`pp-pill ${done ? "done" : "live"}`}>{!done && <i />}{done ? header.pill.done : header.pill.inProgress}</span>
                  <span className="pp-mono">{current?.day ?? preview.updates[0]?.day ?? ""}</span>
                </div>
                <div className="pp-bar"><b style={{ width: `${current?.pct ?? 0}%` }} /></div>
                {header.rail && (
                  <div className="pp-rail">
                    {header.rail.map((s, i) => {
                      const st = current?.stage ?? 0;
                      return <span key={s} className={i < st ? "was" : i === st ? "on" : ""}>{s}</span>;
                    })}
                  </div>
                )}
              </div>
              <div className="pp-body">
                <div className="pp-lead">
                  {lead.photoUrl ? <LeadPhoto src={lead.photoUrl} /> : <div className="pp-av">{lead.initial}</div>}
                  <div><b>{lead.name ?? lead.role}</b>{lead.name && <span className="pp-mono">{lead.role}</span>}</div>
                  <span className="pp-msg">Message</span>
                </div>
                {header.docs && <div className="pp-docs">{header.docs.map((d) => <span key={d}>{d}</span>)}</div>}
                <div className="pp-feed acct" data-shown={shown} data-testid="pp-feed">{feed}</div>
              </div>
            </div>

            <div className={`pp-sms over${done ? " in" : ""}`} data-testid="pp-sms2">
              <div className="pp-ico">💬</div>
              <div><div className="pp-hd">Paint Group<span>now</span></div>{preview.texts.last}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="pp-under">
        <button type="button" className="pp-replay" onClick={replay} data-testid="pp-replay" disabled={reduced}>↻ Play again</button>
        <p className="pp-fine" data-testid="pp-line">{preview.line}</p>
      </div>
    </section>
  );
}

/** The demo painter's photo — a public URL from Settings, the way the estimate's own photos load. */
function LeadPhoto({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="pp-av" src={src} alt="" width={42} height={42} loading="lazy" />;
}

/** The mockup's timings: first text after 0.7 s, read for 3 s, tap 0.32 s, app opens 1.4 s, first item 3.2 s, then 2.7 s each. */
function delayAfter(step: number, n: number): number {
  if (step === 0) return 700;
  if (step === 1) return 3000;
  if (step === 2) return 320;
  if (step === 3) return 1400;
  const k = step - STEP_APP; // items shown so far
  return k === 1 ? 3200 : k <= n ? 2700 : 0;
}

/** The link in a text shows as a link (display only — the demo goes nowhere). */
function withLink(text: string, link: string): ReactNode {
  const i = text.indexOf(link);
  if (i < 0) return text;
  return <>{text.slice(0, i)}<u>{link}</u>{text.slice(i + link.length)}</>;
}
