"use client";

import { useEffect, useRef, useState } from "react";

/** §4.8 — count up on enter: 900 ms, ease-out cubic. Reduced motion (or no IntersectionObserver) shows the final number at once. */
export default function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLSpanElement | null>(null);
  const played = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || played.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    // Server-rendered with the final number (no layout shift, works without JS);
    // the first animation frame starts the count from 0 once the tile is in view.
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || played.current) return;
      played.current = true;
      io.disconnect();
      let t0: number | null = null;
      const step = (ts: number) => {
        if (t0 == null) t0 = ts;
        const p = Math.min(1, (ts - t0) / 900);
        setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [value]);

  return <span ref={ref} className="big" data-count={value} data-suffix={suffix}>{shown}{suffix}</span>;
}
