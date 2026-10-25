"use client";

import { useEffect, useRef, useState } from "react";
import { clientId } from "./clientId";

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
  const sessionRef = useRef<string>(clientId());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  /** The one autocomplete call. null = the lookup is unavailable or down (plain input). */
  async function fetchSuggestions(text: string): Promise<AddressSuggestion[] | null> {
    try {
      const res = await fetch("/api/places/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: text.trim(), sessionToken: sessionRef.current }),
      });
      if (!res.ok) {
        // 503 = not configured; anything else = down. Either way: plain input.
        if (res.status === 503) setAvailable(false);
        return null;
      }
      const j = (await res.json()) as { suggestions?: AddressSuggestion[] };
      return j.suggestions ?? [];
    } catch {
      return null;
    }
  }

  function lookup(text: string) {
    if (!available || text.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      const list = await fetchSuggestions(text);
      if (seq !== seqRef.current) return; // a newer keystroke superseded us
      setSuggestions(list ?? []);
      setOpen((list ?? []).length > 0);
    }, 250);
  }

  /**
   * Tom, 25 Oct 2026: an address that arrived as WORDS (typed on the homepage
   * and submitted without picking a suggestion) is looked up once and its
   * top match resolved — the suburb and postcode then carry on into the
   * wizard instead of "We couldn't look that address up". null = no
   * confident match or no lookup; the words stay as typed.
   */
  async function resolveText(text: string): Promise<{ address: PickedAddress; inServiceArea: boolean | null } | null> {
    if (!available || text.trim().length < 3) return null;
    const list = await fetchSuggestions(text);
    if (!list || list.length === 0) return null;
    return resolve(list[0]);
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
      sessionRef.current = clientId(); // a session ends at details
      if (!res.ok) return null;
      return (await res.json()) as { address: PickedAddress; inServiceArea: boolean | null };
    } catch {
      sessionRef.current = clientId();
      return null;
    }
  }

  return { suggestions, open, setOpen, lookup, resolve, resolveText };
}
