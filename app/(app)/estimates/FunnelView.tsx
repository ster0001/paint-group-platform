import Link from "next/link";
import type { RangePreset } from "@/lib/reporting/core";
import type { FunnelFilter, FunnelView as FunnelData } from "@/lib/reporting/metrics/funnel";

/**
 * Estimates tab session 5 (brief §4.5): the Funnel. Server component —
 * numbers in, bars out; every number is `buildFunnelView`'s, the same module
 * the home dashboard's "Where estimates go" reads. Each chart exports through
 * THE export route with the filters on screen.
 */
const PRESETS: Array<{ key: Exclude<RangePreset, "custom">; label: string }> = [
  { key: "week", label: "This week" }, { key: "month", label: "This month" }, { key: "quarter", label: "This quarter" }, { key: "year", label: "This year" },
];
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const stepName = (k: string) => k.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const secs = (s: number | null) => (s == null ? "—" : s < 90 ? `${s}s` : `${Math.round(s / 60)} min`);

export default function FunnelView({ data, filter, preset, rangeLabel, jobTypes, sources, hrefWith, exportHref }: {
  data: FunnelData; filter: FunnelFilter; preset: RangePreset; rangeLabel: string;
  jobTypes: string[]; sources: string[];
  /** This view's URL with one parameter changed (null removes it). */
  hrefWith: (k: string, v: string | null) => string;
  exportHref: (metric: string) => string;
}) {
  const chip = (label: string, href: string, on: boolean, testId: string) => (
    <Link key={testId} href={href} data-testid={testId} aria-pressed={on}
      className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{label}</Link>
  );
  const maxViewed = Math.max(1, ...data.steps.map((s) => s.viewed));
  const ex = (metric: string) => <a href={exportHref(metric)} className="text-xs text-cyan-700 hover:underline" data-testid={`export-${metric}`}>Export CSV</a>;
  return (
    <div className="mt-4 space-y-6" data-testid="funnel-view">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5" data-testid="funnel-range">
          {PRESETS.map((p) => chip(p.label, hrefWith("preset", p.key), preset === p.key, `funnel-preset-${p.key}`))}
          <span className="ml-2 text-xs text-gray-500">{rangeLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" data-testid="funnel-filters">
          <span className="mr-1 text-xs uppercase tracking-wide text-gray-400">Brand</span>
          {chip("Paint Group", hrefWith("brand", filter.brand === "paintgroup" ? null : "paintgroup"), filter.brand === "paintgroup", "funnel-brand-paintgroup")}
          {chip("Paint Home", hrefWith("brand", filter.brand === "painthome" ? null : "painthome"), filter.brand === "painthome", "funnel-brand-painthome")}
          <span className="ml-3 mr-1 text-xs uppercase tracking-wide text-gray-400">Device</span>
          {chip("Phone", hrefWith("device", filter.device === "mobile" ? null : "mobile"), filter.device === "mobile", "funnel-device-mobile")}
          {chip("Desktop", hrefWith("device", filter.device === "desktop" ? null : "desktop"), filter.device === "desktop", "funnel-device-desktop")}
          {jobTypes.length > 0 && <span className="ml-3 mr-1 text-xs uppercase tracking-wide text-gray-400">Job</span>}
          {jobTypes.map((j) => chip(stepName(j), hrefWith("job", filter.jobType === j ? null : j), filter.jobType === j, `funnel-job-${j}`))}
          {sources.length > 0 && <span className="ml-3 mr-1 text-xs uppercase tracking-wide text-gray-400">Source</span>}
          {sources.map((s) => chip(stepName(s), hrefWith("src", filter.leadSource === s ? null : s), filter.leadSource === s, `funnel-source-${s}`))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3" data-testid="funnel-tiles">
        {([["started", "Started the wizard"], ["gave_details", "Gave their details"], ["accepted", "Accepted"]] as const).map(([k, label]) => (
          <div key={k} className="rounded-lg border border-gray-200 bg-white p-3">
            <b className="block text-2xl tabular-nums" data-testid={`funnel-tile-${k}`}>{data.tiles[k]}</b>
            <span className="text-xs text-gray-500">{label}{k !== "started" && data.tiles.started ? ` · ${pct(data.tiles[k], data.tiles.started)}%` : ""}</span>
          </div>
        ))}
      </div>

      <section data-testid="funnel-steps">
        <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold text-gray-800">Where they stop</h2>{ex("funnel.step_conversion")}</div>
        {data.steps.length === 0 ? <p className="mt-2 text-xs text-gray-400">No wizard steps recorded in this period.</p> : (
          <ul className="mt-2 space-y-1">
            {data.steps.map((s) => (
              <li key={s.step} data-testid={`funnel-step-${s.step}`} data-worst={s.worst ? "1" : "0"}>
                <details className={`rounded-md border px-3 py-2 text-sm ${s.worst ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"}`}>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="w-32 shrink-0 truncate font-medium">{stepName(s.step)}</span>
                    <span className="relative h-2 min-w-[80px] flex-1 rounded bg-gray-100">
                      <i className="absolute inset-y-0 left-0 rounded bg-gray-300" style={{ width: `${pct(s.viewed, maxViewed)}%` }} />
                      <i className={`absolute inset-y-0 left-0 rounded ${s.worst ? "bg-amber-500" : "bg-cyan-600"}`} style={{ width: `${pct(s.completed, maxViewed)}%` }} />
                    </span>
                    <span className="font-mono text-xs text-gray-600"><span data-testid="step-viewed">{s.viewed}</span> saw · <span data-testid="step-completed">{s.completed}</span> on · {s.completed_pct ?? 0}% · {secs(s.median_seconds)}</span>
                  </summary>
                  <p className="mt-2 text-xs text-gray-600" data-testid="step-devices">
                    Phone: {s.mobile ? `${s.mobile.completed} of ${s.mobile.viewed} went on` : "none"} · Desktop: {s.desktop ? `${s.desktop.completed} of ${s.desktop.viewed} went on` : "none"}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-gray-400">Amber: the three steps where most stop. Tap a step for phone against desktop. Back-taps are not recorded yet.</p>
      </section>

      <section data-testid="funnel-bands">
        <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold text-gray-800">Drop-out by price band</h2>{ex("funnel.price_bands")}</div>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-gray-500"><tr><th className="py-1 font-medium">Range seen (inc. GST)</th><th className="font-medium">Saw it</th><th className="font-medium">Did something</th><th className="font-medium">Dropped</th></tr></thead>
          <tbody>
            {data.bands.map((b) => (
              <tr key={b.band} className={`border-t border-gray-100 ${b.worst ? "bg-[#f6e3dc] text-[#7a3520]" : ""}`} data-testid={`funnel-band-${b.low_cents}`} data-worst={b.worst ? "1" : "0"}>
                <td className="py-1.5">{b.band}</td><td data-testid="band-saw">{b.saw_range}</td><td data-testid="band-acted">{b.took_action}</td><td>{b.dropped_pct == null ? "—" : `${b.dropped_pct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-gray-400">A session is placed by the middle of the first range it saw. The bands are set in Settings → Dashboard. Clay: the band that drops most.</p>
      </section>

      <section data-testid="funnel-came-back">
        <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold text-gray-800">Came back</h2>{ex("funnel.came_back")}</div>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-gray-500"><tr><th className="py-1 font-medium"></th><th className="font-medium">Sessions</th><th className="font-medium">Gave details</th><th className="font-medium">Saw a range</th><th className="font-medium">Asked for a visit or call</th><th className="font-medium">Accepted</th></tr></thead>
          <tbody>
            {data.cameBack.map((r) => (
              <tr key={r.group} className="border-t border-gray-100" data-testid={`funnel-cameback-${r.group}`}>
                <td className="py-1.5">{r.group === "came_back" ? "Came back" : "Did not come back"}</td>
                <td data-testid="cb-sessions">{r.sessions}</td><td>{r.gave_details}</td><td>{r.saw_range}</td><td>{r.asked}</td><td>{r.accepted}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-gray-400">Which link or message brought them back is recorded once the automations are built.</p>
      </section>
    </div>
  );
}
