import { LIVE_STATS } from "@/lib/marketing/liveStats";

/** §4.8 — pulse dot + four tiles from the config constants (static now; the count-up lands in session 6). */
export default function LiveStrip() {
  const tiles = [LIVE_STATS.estimatesThisWeek, LIVE_STATS.jobsOnSite, LIVE_STATS.pricesHonoured, LIVE_STATS.minutesToPrice] as const;
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
              <span className="big" data-count={t.value} data-suffix={"suffix" in t ? t.suffix : ""}>{t.value}{"suffix" in t ? t.suffix : ""}</span>
              <b>{t.label}</b><small>{t.sub}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
