"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { showcaseMediaUrl } from "@/lib/showcase/format";
import {
  STORY_AREAS, STORY_BEATS, STORY_CAPTIONS, STORY_END_MS, storyFinalState, storyStateAt, type StoryState,
} from "@/lib/marketing/progressStory";

/** How long the signed-off frame holds before the story goes round again. */
const LOOP_HOLD_MS = 1800;

/**
 * §4.7 — the phone playback. ONE clock (`elapsed`, advanced by
 * requestAnimationFrame, paused while the tab is hidden) and every visual is
 * `storyStateAt(elapsed)` from lib/marketing/progressStory — a single state
 * machine on a single timeline, so captions and phone beats cannot drift.
 * Framer Motion animates the transitions between those states (banner,
 * photos, variation card, sign-off, signature path).
 *
 * Starts when 50% in view, then keeps playing on repeat (Tom, 5 Sep: no
 * Replay control, just loop) with a short hold on the last frame. Fires
 * progress_story_start once, progress_story_complete at the end of every
 * pass. Reduced motion: the final frame with the eight captions listed. The phone is aria-hidden; the
 * caption list is the accessible text and is always in the DOM.
 */
export default function ProgressStory({ photos = [] }: { photos?: string[] }) {
  const reduced = useReducedMotion();
  const [elapsed, setElapsed] = useState(-1); // -1 = not started
  const [played, setPlayed] = useState(false);
  const [finished, setFinished] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const clock = useRef<{ running: boolean; last: number | null; raf: number | null }>({ running: false, last: null, raf: null });
  const completedFired = useRef(false);

  // ---- the clock -----------------------------------------------------------
  const tick = (ts: number) => {
    const c = clock.current;
    if (!c.running) return;
    if (c.last == null) c.last = ts;
    const dt = ts - c.last;
    c.last = ts;
    setElapsed((e) => {
      const next = Math.min(STORY_END_MS, e + dt);
      if (next >= STORY_END_MS) c.running = false;
      return next;
    });
    if (c.running) c.raf = requestAnimationFrame(tick);
  };
  const start = () => {
    const c = clock.current;
    if (c.raf != null) cancelAnimationFrame(c.raf);
    c.running = true; c.last = null;
    c.raf = requestAnimationFrame(tick);
  };
  const pause = () => { clock.current.running = false; clock.current.last = null; if (clock.current.raf != null) cancelAnimationFrame(clock.current.raf); };

  function play(replay: boolean) {
    completedFired.current = false;
    setFinished(false);
    setElapsed(0);
    setPlayed(true);
    if (!replay) track("progress_story_start");
    start();
  }

  // Plays once, when half of it is in view.
  useEffect(() => {
    if (reduced || played) return;
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); play(false); }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, played]);

  // Pause on tab blur, resume on return (the brief's rule).
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) pause();
      else if (played && elapsed >= 0) {
        if (elapsed < STORY_END_MS) start();
        else { completedFired.current = false; setFinished(false); setElapsed(0); start(); }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [played, finished, elapsed]);

  useEffect(() => () => pause(), []);

  useEffect(() => {
    if (elapsed >= STORY_END_MS && !completedFired.current) {
      completedFired.current = true;
      setFinished(true);
      track("progress_story_complete");
      // Hold the signed-off frame, then go again from the top.
      const t = window.setTimeout(() => {
        if (document.hidden) return; // resumes via visibilitychange
        completedFired.current = false;
        setFinished(false);
        setElapsed(0);
        start();
      }, LOOP_HOLD_MS);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  const s: StoryState = reduced ? storyFinalState() : storyStateAt(elapsed);
  const caption = s.captionIndex >= 0 ? STORY_BEATS[s.captionIndex].caption : "";

  return (
    <div ref={root} className="wrap storywrap" data-testid="story" data-story-state={reduced ? "reduced" : finished ? "done" : played ? "playing" : "idle"}>
      <div className="storycopy">
        <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }}>Your portal · one job, start to finish · demo data</div>
        <h2>Watch it happen from wherever you are.</h2>
        <p className="lead" style={{ marginTop: 14 }}>This is what five days looks like from your phone.</p>
        <ol className={`capsr${reduced ? " shown" : ""}`} data-testid="story-captions">
          {STORY_CAPTIONS.map((c) => <li key={c}>{c}</li>)}
        </ol>
      </div>

      {/* The changing line is its own grid child: beside the phone on a
          phone screen (Tom, 5 Sep), under the copy on desktop. */}
      {!reduced && (
        <div className="caption motion-only" aria-hidden="true" data-testid="story-caption">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={s.captionIndex} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }} style={{ display: "block" }}>
              {caption}
            </motion.span>
          </AnimatePresence>
        </div>
      )}

      <Phone s={s} reduced={Boolean(reduced)} photos={photos} />
    </div>
  );
}

function Phone({ s, reduced, photos }: { s: StoryState; reduced: boolean; photos: string[] }) {
  const dur = (d: number) => (reduced ? 0 : d);
  return (
    <div className="device" aria-hidden="true" data-testid="story-phone" data-day={s.day}>
      <div className="notch" />
      <motion.div className="banner" animate={{ y: s.banner ? 40 : "-140%" }} transition={{ duration: dur(.5), ease: [.2, .9, .3, 1] }} initial={false}>
        {s.banner && <><b>{s.banner.bold}</b> {s.banner.text}</>}
      </motion.div>
      <div className="ptop">
        <div><b>12 Elm Street, Northcote</b><div className="mono" style={{ color: "var(--color-muted)" }}>Interior · 4 rooms + hallway · $9,180 inc. GST</div></div>
        <span className="pill green" data-testid="story-day">Day {s.day} of 5</span>
      </div>
      <div className="ptrack"><motion.i animate={{ width: `${s.progress}%` }} transition={{ duration: dur(.9), ease: [.2, .8, .2, 1] }} initial={false} style={{ display: "block", height: "100%", background: "var(--color-cyan)" }} /></div>
      <div className="pareas">
        {STORY_AREAS.map((a) => {
          const st = s.areas[a.key];
          return (
            <div key={a.key} className="parea" data-a={a.key} data-s={st.state}>
              <span><b>{a.label}</b><small>{st.sub}</small></span>
              <span className={`state ${st.state}`}>{st.state === "todo" ? "To do" : st.state === "prepped" ? "Prepped" : "Done"}</span>
            </div>
          );
        })}
      </div>
      <div className="pphotos">
        {["Prep · floors covered", "Living room · masked up"].slice(0, s.photos).map((c, i) => (
          <motion.i key={c} title={c} initial={reduced ? false : { x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: dur(.5), delay: dur(.12 + i * .18), ease: [.2, .8, .2, 1] }}
            style={photos[i] ? { backgroundImage: `url(${showcaseMediaUrl(photos[i])})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined} />
        ))}
      </div>
      {s.update !== null && (
        <div className="pupd"><span className="mono" style={{ color: "var(--color-cyan)" }}>Today&rsquo;s update · Felipe M.</span><span>{s.update}</span></div>
      )}
      <AnimatePresence>
        {s.variation !== "hidden" && (
          <motion.div className="pvar" initial={reduced ? false : { y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ duration: dur(.45), ease: [.2, .8, .2, 1] }} style={{ transform: "none", opacity: 1 }}>
            <div className="row"><span className="mono" style={{ color: "var(--color-muted)" }}>Variation #2</span><span className={`pill${s.variation === "approved" ? " green" : ""}`}>{s.variation === "approved" ? "Approved" : "Waiting for you"}</span></div>
            <b>Small patch of rot behind the fascia. Replace, prime, paint to match</b>
            <div className="row"><span className="money">+ $486</span><span className={`pbtn${s.variation === "pressed" ? " press" : ""}${s.variation === "approved" ? " ok" : ""}`}>{s.variation === "approved" ? "Approved ✓" : "Approve $486"}</span></div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {s.signed && (
          <motion.div className="psign" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: dur(.5) }} style={{ opacity: 1 }}>
            <div className="mono" style={{ color: "var(--color-emerald)" }}>Signed off · 12 Elm Street</div>
            <svg viewBox="0 0 260 70" className="sig">
              <motion.path d="M8 48 C 30 10, 48 62, 70 30 S 110 60, 130 28 S 170 10, 190 44 S 230 60, 252 22" fill="none" stroke="#EDF0F2" strokeWidth="2.5" strokeLinecap="round"
                initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: dur(1.6), ease: "easeInOut" }} style={{ strokeDasharray: "none", strokeDashoffset: 0 }} />
            </svg>
            <div className="row"><span>Final invoice</span><span className="money">$9,180</span></div>
            <small style={{ color: "var(--color-muted)" }}>inc. GST · due now · thank you</small>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
