"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Address autocomplete over the server proxy (/api/places/*) — the ONE
 * lookup logic, shared by the wizard's AddressField and the builder's job
 * address modal (never fork a component: the skins differ, the brain
 * doesn't). Degrades to plain typing on any failure: the first 503 turns
 * suggestions off for the session and every input keeps working by hand.
 */

export type PickedAddress = {
  street: string;
  suburb: string;
  state: string;
  postcode: string;
  formatted: string;
};

export type AddressSuggestion = { placeId: string; main: string; secondary: string };

export function useAddressLookup() {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
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
        const j = (await res.json()) as { suggestions?: AddressSuggestion[] };
        if (seq !== seqRef.current) return; // a newer keystroke superseded us
        setSuggestions(j.suggestions ?? []);
        setOpen((j.suggestions ?? []).length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      }
    }, 250);
  }

  /** Resolve a chosen suggestion; null means "use the label as plain text". */
  async function resolve(
    s: AddressSuggestion,
  ): Promise<{ address: PickedAddress; inServiceArea: boolean | null } | null> {
    setOpen(false);
    setSuggestions([]);
    try {
      const res = await fetch("/api/places/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: s.placeId, sessionToken: sessionRef.current }),
      });
      sessionRef.current = crypto.randomUUID(); // a session ends at details
      if (!res.ok) return null;
      return (await res.json()) as { address: PickedAddress; inServiceArea: boolean | null };
    } catch {
      sessionRef.current = crypto.randomUUID();
      return null;
    }
  }

  return { suggestions, open, setOpen, lookup, resolve };
}
