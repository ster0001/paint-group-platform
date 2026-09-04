"use client";

import { useId, useRef, useState } from "react";
import { useAddressLookup, type AddressSuggestion } from "@/app/components/useAddressLookup";
import Chip from "./Chip";
import { track } from "@/lib/analytics";
import type { Mode } from "@/lib/marketing/estimateLink";

/**
 * The universal address field (brief §1, §4.2) — used in the hero and the
 * closing CTA. Residential and commercial are pushed equally: the
 * home/business choice is a pair of chips INSIDE the field, never a
 * page-level toggle.
 *
 * Tom's rule (4 Sep): this component knows nothing about the wizard. It
 * hands `onSubmit(address, mode)` to the page, and the page decides where
 * to go and fires `see_price` before navigating.
 *
 * Suggestions come from the ONE lookup brain the wizard uses
 * (app/components/useAddressLookup) — never a second copy. Events fired
 * here carry `where` only; the typed text never leaves with an event (§5).
 *
 * Session 6 adds the self-typing ghost loop on top of this field.
 */
export default function AddressField({
  where,
  showChips = false,
  initialMode = "home",
  onSubmit,
}: {
  where: "hero" | "bottom" | "project";
  showChips?: boolean;
  initialMode?: Mode;
  onSubmit: (address: string, mode: Mode) => void;
}) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<Mode>(initialMode);
  const typedOnce = useRef(false);
  const { suggestions, open, setOpen, lookup, resolve } = useAddressLookup();
  const inputId = useId();

  function onChange(text: string) {
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
    setMode(next);
    track(next === "home" ? "mode_home" : "mode_business", { where });
  }

  return (
    <>
      <form
        className="field"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(false);
          onSubmit(value.trim(), mode);
        }}
      >
        <span aria-hidden="true">📍</span>
        <input
          id={inputId}
          placeholder="Type your address"
          aria-label="Address"
          data-ev="address_typed"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => { if (suggestions.length) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        <button className="btn btn-cyan" type="submit" data-ev="see_price">See my price →</button>
      </form>

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
          <Chip pressed={mode === "home"} data-mode="home" data-ev="mode_home" onClick={() => choose("home")}>My home</Chip>
          <Chip pressed={mode === "business"} data-mode="business" data-ev="mode_business" onClick={() => choose("business")}>A business or property I manage</Chip>
        </div>
      )}
    </>
  );
}
