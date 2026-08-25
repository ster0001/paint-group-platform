"use client";

import { useAddressLookup, type PickedAddress, type AddressSuggestion } from "@/app/components/useAddressLookup";

/**
 * A1: the wizard's address-aware first field. Types like a plain input —
 * and IS one whenever the lookup is unavailable (no key, offline, quota).
 * The lookup brain is shared (app/components/useAddressLookup); this file
 * is only the wizard's skin over it.
 */

export type { PickedAddress };

export default function AddressField({ value, placeholder, onText, onPick }: {
  value: string;
  placeholder: string;
  /** Plain typing — behaves exactly like the old input. */
  onText: (text: string) => void;
  /** A suggestion was chosen and resolved. */
  onPick: (address: PickedAddress, inServiceArea: boolean | null) => void;
}) {
  const { suggestions, open, setOpen, lookup, resolve } = useAddressLookup();

  async function pick(s: AddressSuggestion) {
    const resolved = await resolve(s);
    if (resolved) onPick(resolved.address, resolved.inServiceArea);
    else onText(`${s.main}, ${s.secondary}`);
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
