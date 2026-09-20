"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import DateField from "@/app/components/DateField";
import { PRESET_LABEL, RANGE_PRESETS, type RangePreset } from "@/lib/reporting/core";
import { RANGE_COOKIE, rangeCookieValue } from "@/lib/reporting/rangeCookie";
import "@/app/components/datefield.css";

/**
 * The period chips — Week · Month · Quarter · Year · Custom — and, under
 * Custom, a start and an end day each behind the CRM's mini calendar
 * (Tom, 20 Sep 2026: "a calendar pops up for start and end date"). A chip
 * is a link, so the period is in the URL and every export carries it; the
 * choice is also written to the `dash_range` cookie so it holds across the
 * dashboards (lib/reporting/rangeCookie.ts).
 */
export default function RangePicker({ preset, from, to, today }: { preset: RangePreset; from: string; to: string; today: string }) {
  const router = useRouter();
  // The pickers start on the period in the URL; a new URL is a new mount (the key below), so no effect resets them.
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  useEffect(() => {
    try { document.cookie = `${RANGE_COOKIE}=${rangeCookieValue(preset, from, to)}; path=/; max-age=31536000; samesite=lax`; } catch { /* a browser that refuses cookies simply forgets the period */ }
  }, [preset, from, to]);

  const href = (p: RangePreset) => (p === "custom" ? `/home?preset=custom&from=${from}&to=${to}` : `/home?preset=${p}`);
  const apply = () => {
    const [a, b] = f <= t ? [f, t] : [t, f];
    router.push(`/home?preset=custom&from=${a}&to=${b}`);
  };

  return (
    <>
      <div className="periods" role="group" aria-label="Period">
        {RANGE_PRESETS.map((p) => (
          <Link key={p} href={href(p)} className="chip" aria-pressed={p === preset} data-testid={`range-${p}`}>{PRESET_LABEL[p]}</Link>
        ))}
      </div>
      {preset === "custom" && (
        <div className="custom" data-testid="range-custom-form" key={`${from}|${to}`}>
          <span>From</span>
          <DateField value={f} onChange={setF} max={today} ariaLabel="From day" className="chip" testId="range-from" />
          <span>To</span>
          <DateField value={t} onChange={setT} min={f} max={today} ariaLabel="To day" className="chip" testId="range-to" />
          <button type="button" className="chip" onClick={apply} data-testid="range-apply">Apply</button>
        </div>
      )}
    </>
  );
}
