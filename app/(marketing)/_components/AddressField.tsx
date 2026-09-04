"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAddressLookup, type AddressSuggestion } from "@/app/components/useAddressLookup";
import Chip from "./Chip";
import { track } from "@/lib/analytics";
import type { Mode } from "@/lib/marketing/estimateLink";
import {
  GHOST_EXAMPLES, GHOST_GAP_MS, GHOST_START_DELAY_MS, applyGhostStep, ghostInitial, ghostSchedule, stopGhost,
  type GhostState,
} from "@/lib/marketing/ghostEstimator";

/**
 * The universal address field (brief §1, §4.2) — used in the hero, the
 * closing CTA and the project page. Residential and commercial are pushed
 * equally: the home/business choice is a pair of chips INSIDE the field,
 * never a page-level toggle.
 *
 * Tom's rule (4 Sep): this component knows nothing about the wizard. It
 * hands `onSubmit(address, mode)` to the page, and the page decides where
 * to go and fires `see_price` before navigating.
 *
 * Suggestions come from the ONE lookup brain the wizard uses
 * (app/components/useAddressLookup) — never a second copy. Events fired
 * here carry `where` only; the typed text never leaves with an event (§5).
 *
 * `ghost` (hero only): the self-typing estimator. The schedule and state
 * machine are lib/marketing/ghostEstimator (tested); this plays it after
 * first paint, stops it for good the instant the visitor touches the field
 * or a chip, and never starts it under reduced motion.
 */
export default function AddressField({
  where,
  showChips = false,
  initialMode = "home",
  ghost = false,
  onSubmit,
}: {
  where: "hero" | "bottom" | "project";
  showChips?: boolean;
  initialMode?: Mode;
  ghost?: boolean;
  onSubmit: (address: string, mode: Mode) => void;
}) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<Mode>(initialMode);
  const typedOnce = useRef(false);
  const { suggestions, open, setOpen, lookup, resolve } = useAddressLookup();
  const inputId = useId();

  // ---- the ghost loop -------------------------------------------------------
  const [g, setG] = useState<GhostState>(ghostInitial);
  const gRef = useRef<GhostState>(ghostInitial);
  const timers = useRef<number[]>([]);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!ghost) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const clearTimers = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
    const commit = (next: GhostState) => { gRef.current = next; setG(next); };
    const playExample = (index: number) => {
      if (stoppedRef.current) return;
      const steps = ghostSchedule(GHOST_EXAMPLES[index]);
      for (const step of steps) {
        timers.current.push(window.setTimeout(() => {
          if (stoppedRef.current) return;
          commit(applyGhostStep(gRef.current, step));
          if (step.kind === "clear") {
            timers.current.push(window.setTimeout(() => playExample(gRef.current.index), GHOST_GAP_MS));
          }
        }, step.at));
      }
    };
    // After first paint: the H1 is the LCP element and the loop must not delay it.
    timers.current.push(window.setTimeout(() => playExample(0), GHOST_START_DELAY_MS));
    return clearTimers;
  }, [ghost]);

  function stopGhostNow() {
    if (!ghost || stoppedRef.current) return;
    stoppedRef.current = true;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    const next = stopGhost(gRef.current);
    gRef.current = next; setG(next);
    setMode("home");
    track("ghost_stopped", { where });
  }

  // Stopped is a STATE (stopGhost sets status "stopped"); the ref is only for the timers.
  const ghosting = ghost && (g.status === "typing" || g.status === "result" || g.status === "fading");
  const shownValue = ghosting ? g.text : value;
  const shownMode: Mode = ghosting ? g.mode : mode;
  const resultOn = ghosting && g.status === "result" && g.result;

  function onChange(text: string) {
    stopGhostNow();
    setValue(text);
    if (!typedOnce.current && text.trim()) {
      typedOnce.current = true;
      track("address_typed", { where });
    }
    lookup(text);
  }

  async function pick(s: AddressSuggestion) {
    const resolved = await resolve(s);
    setValue(resolved ? resolved.address.formatted : [s.main, s.secondary].filter(Boolean).join(", "));
    track("address_selected", { where });
  }

  function choose(next: Mode) {
    stopGhostNow();
    setMode(next);
    track(next === "home" ? "mode_home" : "mode_business", { where });
  }

  return (
    <>
      <form
        className={`field${ghosting && g.status === "typing" ? " typing" : ""}`}
        autoComplete="off"
        onPointerDown={stopGhostNow}
        onSubmit={(e) => {
          e.preventDefault();
          stopGhostNow();
          setOpen(false);
          onSubmit(value.trim(), mode);
        }}
      >
        <span aria-hidden="true">📍</span>
        <input
          id={inputId}
          placeholder={ghosting ? "" : "Type your address"}
          aria-label="Address"
          data-ev="address_typed"
          data-ghosting={ghosting ? "true" : undefined}
          value={shownValue}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => { stopGhostNow(); if (suggestions.length) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        <button className="btn btn-cyan" type="submit" data-ev="see_price">See my price →</button>
      </form>

      {ghost && (
        <div className={`ghost${resultOn ? " on" : ""}`} aria-hidden="true" data-testid="ghost-result">
          {g.result && (
            <>
              <span className="gaddr">{g.result.address}</span>
              <span className="garrow">→</span>
              <span className="gprice">{g.result.price}</span>
              <span className="gtime">{g.result.time}</span>
            </>
          )}
        </div>
      )}

      <div id={`${inputId}-suggest`} className={`suggest${open && suggestions.length ? " open" : ""}`} role="listbox" aria-label="Address suggestions">
        {open && suggestions.map((s) => (
          <button
            key={s.placeId}
            type="button"
            role="option"
            aria-selected={false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void pick(s)}
          >
            <b>{s.main}</b>{s.secondary && <span> {s.secondary}</span>}
          </button>
        ))}
      </div>

      {showChips && (
        <div className="chips" role="group" aria-label="This is">
          <span className="mono" style={{ color: "var(--color-muted)" }}>This is</span>
          <Chip pressed={shownMode === "home"} data-mode="home" data-ev="mode_home" onClick={() => choose("home")}>My home</Chip>
          <Chip pressed={shownMode === "business"} data-mode="business" data-ev="mode_business" onClick={() => choose("business")}>A business or property I manage</Chip>
        </div>
      )}
    </>
  );
}
