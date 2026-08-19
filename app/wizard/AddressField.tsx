"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A1: the wizard's address-aware first field. Types like a plain input —
 * and IS one whenever the lookup is unavailable (no key, offline, quota):
 * the first failed request turns suggestions off for the session and the
 * field keeps working by hand. Suggestions come from the server proxy
 * (/api/places/*) — no Google key or SDK ever reaches the browser.
 */

export type PickedAddress = {
  street: string;
  suburb: string;
  state: string;
  postcode: string;
  formatted: string;
};

export default function AddressField({ value, placeholder, onText, onPick }: {
  value: string;
  placeholder: string;
  /** Plain typing — behaves exactly like the old input. */
  onText: (text: string) => void;
  /** A suggestion was chosen and resolved. */
  onPick: (address: PickedAddress, inServiceArea: boolean | null) => void;
}) {
  const [suggestions, setSuggestions] = useState<Array<{ placeId: string; main: string; secondary: string }>>([]);
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(true);
  const sessionRef = useRef<string>(crypto.randomUUID());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  function lookup(text: string) {
    if (!available || text.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      try {
        const res = await fetch("/api/places/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: text.trim(), sessionToken: sessionRef.current }),
        });
        if (!res.ok) {
          // 503 = not configured; anything else = down. Either way: plain input.
          if (res.status === 503) setAvailable(false);
          setSuggestions([]);
          setOpen(false);
          return;
        }
        const j = (await res.json()) as { suggestions?: Array<{ placeId: string; main: string; secondary: string }> };
        if (seq !== seqRef.current) return; // a newer keystroke superseded us
        setSuggestions(j.suggestions ?? []);
        setOpen((j.suggestions ?? []).length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      }
    }, 250);
  }

  async function pick(s: { placeId: string; main: string; secondary: string }) {
    setOpen(false);
    setSuggestions([]);
    try {
      const res = await fetch("/api/places/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: s.placeId, sessionToken: sessionRef.current }),
      });
      sessionRef.current = crypto.randomUUID(); // a session ends at details
      if (!res.ok) { onText(`${s.main}, ${s.secondary}`); return; }
      const j = (await res.json()) as { address: PickedAddress; inServiceArea: boolean | null };
      onPick(j.address, j.inServiceArea);
    } catch {
      onText(`${s.main}, ${s.secondary}`);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        className="wz-field"
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={(e) => { onText(e.target.value); lookup(e.target.value); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
      />
      {open && (
        <div className="wz-suggest">
          {suggestions.map((s) => (
            <button key={s.placeId} type="button" className="wz-suggest-row" onMouseDown={(e) => { e.preventDefault(); void pick(s); }}>
              <b>{s.main}</b>
              {s.secondary && <span> {s.secondary}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
