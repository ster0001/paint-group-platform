import CountUp from "../_components/CountUp";
import { LIVE_STATS } from "@/lib/marketing/liveStats";

/** §4.8 — pulse dot + four tiles from the config constants; each counts up on enter (CountUp). */
export default function LiveStrip() {
  const tiles = [LIVE_STATS.estimatesThisWeek, LIVE_STATS.jobsOnSite, LIVE_STATS.minutesToPrice] as const;
  return (
    <section className="sec light" id="live">
      <div className="wrap">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="dot" aria-hidden="true" /><span className="mono">Live from the Paint Group platform</span>
          <span style={{ color: "var(--color-tmut)", fontSize: 14 }}>· {LIVE_STATS.updatedLabel}</span>
        </div>
        <div className="live" data-todo="9.4">
          {tiles.map((t) => (
            <div className="tile" key={t.label}>
              <CountUp value={t.value} suffix={"suffix" in t ? t.suffix : ""} />
              <b>{t.label}</b><small>{t.sub}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
