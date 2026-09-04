"use client";

import { useState, type InputHTMLAttributes } from "react";

/**
 * A number box you can actually edit (Tom, 4 Sep 2026).
 *
 * The builder's number inputs were CONTROLLED by the parsed number: delete
 * the last digit of "3" and the box became "" → `Number("")` → 0 (or the
 * calculated fallback) → React wrote "0" straight back, so the first digit
 * could never be removed — you had to type in front of it.
 *
 * This keeps the TEXT while the box has focus and only hands a number up
 * when the text parses. An empty box commits `empty` (null for "back to
 * auto", 0 for a plain figure) but keeps SHOWING empty until blur, when it
 * settles on whatever the parent holds. Everything else — min/max/step,
 * className, placeholder — passes straight through.
 */
export default function NumInput({
  value, onCommit, empty = null, className, ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  /** The parent's number; null/undefined shows blank (or the placeholder). */
  value: number | null | undefined;
  /** Called with a finite number as you type, or `empty` when the box is cleared. */
  onCommit: (n: number | null) => void;
  /** What an empty box means to the parent. */
  empty?: number | null;
}) {
  const shown = value == null || !Number.isFinite(value) ? "" : String(value);
  const [focused, setFocused] = useState(false);
  // The draft only matters while focused; unfocused, the box mirrors the
  // parent directly, so nothing has to be kept in sync by an effect.
  const [draft, setDraft] = useState(shown);
  return (
    <input
      {...rest}
      type="number"
      className={className}
      value={focused ? draft : shown}
      onFocus={(e) => { setFocused(true); setDraft(shown); rest.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
      onChange={(e) => {
        const t = e.target.value;
        setDraft(t);
        if (t === "" || t === "-" || t === ".") { onCommit(empty); return; }
        const n = Number(t);
        if (Number.isFinite(n)) onCommit(n);
      }}
    />
  );
}
