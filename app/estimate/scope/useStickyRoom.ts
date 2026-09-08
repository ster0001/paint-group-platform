"use client";

import { useEffect, type RefObject } from "react";

/**
 * Tom, 8 Sep 2026: "the project estimate page covers more than the full
 * screen — please make it fit to screen on all screens."
 *
 * The sticky footer is `position: fixed`, so it takes no space in the flow:
 * whatever is at the bottom of the page sits UNDERNEATH it, permanently. The
 * rooms editor papered over this with `padding-bottom: 170px` on `.sc-wrap`;
 * the sides editor had none at all, and both were guesses that a taller
 * footer (the reach strip, the "you don't have to finish first" line, an open
 * call-back form) immediately outgrew.
 *
 * So measure it. The footer's real height goes on the document element as
 * `--wz-stick-h`, and the page's bottom padding is derived from it — which
 * also means the reservation grows and shrinks as the footer does.
 *
 * No React state is involved (the repo's lint rule keeps state changes out of
 * effect bodies, and a re-render per resize would be wasteful anyway) — this
 * writes one custom property.
 */
export function useStickyRoom(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--wz-stick-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    window.addEventListener("resize", set);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", set);
      root.style.removeProperty("--wz-stick-h");
    };
  }, [ref, enabled]);
}
