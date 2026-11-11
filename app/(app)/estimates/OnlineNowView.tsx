import Link from "next/link";
import { BrandPill } from "@/app/components/BrandPill";
import type { OnlineView } from "@/lib/estimate/onlineNow";

const idle = (m: number) => (m < 1 ? "active now" : m < 60 ? `${m} min idle` : m < 1440 ? `${Math.floor(m / 60)} h idle` : `${Math.floor(m / 1440)} d idle`);

/** Estimates tab session 4 (brief §4.3): the five sections, in order, each with its rows. */
export default function OnlineNowView({ view }: { view: OnlineView }) {
  return (
    <div className="mt-4 space-y-6" data-testid="online-now">
      {view.map((s) => (
        <section key={s.section} data-testid={`online-${s.section}`} data-count={s.rows.length}>
          <h2 className="flex items-baseline gap-2 text-sm font-semibold text-gray-800">
            {s.section === "online" && <i className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />}
            {s.label} <span className="font-mono text-xs font-normal text-gray-500">{s.rows.length}</span>
          </h2>
          {s.rows.length === 0 ? <p className="mt-1 text-xs text-gray-400">Nobody right now</p> : (
            <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
              {s.rows.map((r) => (
                <li key={r.id}>
                  <Link href={r.href} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-gray-50" data-testid={`online-row-${r.id}`}>
                    <span className="min-w-0 flex-1 truncate font-medium text-gray-900">{r.who}</span>
                    {r.jobType && <span className="text-xs capitalize text-gray-500">{r.jobType}</span>}
                    <span className="text-xs text-gray-600">{r.step}</span>
                    <span className="font-mono text-xs text-gray-500">{idle(r.idleMinutes)}</span>
                    {r.cameBack > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">Came back ×{r.cameBack}</span>}
                    <BrandPill brand={r.brand} always />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
