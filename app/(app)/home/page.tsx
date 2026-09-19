import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PRESET_LABEL, RANGE_PRESETS, rangeLabel, resolveRange, runMetric, type MetricResult, type RangePreset } from "@/lib/reporting/core";
import { loadMetricInput, loadRoles, loadStripSources } from "@/lib/reporting/load";
import { METRICS, SECTION_TITLE, SWITCHES_ON, metricsForSection } from "@/lib/reporting/registry";
import { ROLE_LABEL, sectionsFor, type DashboardSection } from "@/lib/reporting/roles";
import { buildStrip } from "@/lib/reporting/strip";
import { requestNow } from "@/lib/time/requestClock";
import { reportError } from "@/lib/monitoring/report";
import HomeTiles, { type TileData } from "./HomeTiles";
import "./home.css";

export const dynamic = "force-dynamic";

/**
 * Home dashboard v2 · session 1 — the shell (brief Part D, session 1;
 * `design/reference/home-dashboard-light-mockup.html` is the build target).
 *
 * Header: the range chips and what the period is compared with. The strip:
 * the existing evaluators, picked per role. Then the sections the login's
 * roles cover, in the mockup's order — a section whose module has not
 * shipped says what it waits on (acceptance 14). Every number on this page
 * is a metric's `value`, every list its `rows`, every export the one route.
 * Role gating is the metric's own (`runMetric`), not this page's.
 */
const MAX_ROWS_ON_PAGE = 200;

const greeting = (now: Date) => {
  const h = Number(new Intl.DateTimeFormat("en-AU", { hour: "numeric", hour12: false, timeZone: "Australia/Melbourne" }).format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default async function HomePage({ searchParams }: { searchParams: Promise<{ preset?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const preset: RangePreset = (RANGE_PRESETS as readonly string[]).includes(sp.preset ?? "") ? (sp.preset as RangePreset) : "this_month";
  const now = requestNow();
  const range = resolveRange(preset, now, { from: sp.from, to: sp.to });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const profileRes = await supabase.from("profiles").select("name").eq("id", user?.id ?? "").maybeSingle();
  if (profileRes.error) reportError(profileRes.error, { where: "home.profile", bestEffort: true });
  const firstName = (((profileRes.data as { name?: string | null } | null)?.name) ?? user?.email ?? "").split(/[\s@]/)[0] || "there";

  const roles = await loadRoles(supabase);
  const sections = sectionsFor(roles);

  const [strip, metricInput] = await Promise.all([
    loadStripSources(supabase, roles, now),
    sections.some((s) => metricsForSection(s).length > 0) ? loadMetricInput(supabase, range, now) : Promise.resolve(null),
  ]);
  const cards = buildStrip({ workItems: strip.workItems, consoleCards: strip.consoleCards }, roles);
  const failures = [...strip.failures, ...(metricInput?.failures ?? [])];

  const tilesBySection = new Map<DashboardSection, TileData[]>();
  if (metricInput) {
    for (const s of sections) {
      const tiles: TileData[] = [];
      for (const def of metricsForSection(s)) {
        try {
          const r: MetricResult = runMetric(def, metricInput.input, range, roles);
          tiles.push({
            key: r.key, kind: r.kind, title: r.title, definition: r.definition, unit: r.unit, gst: r.gst,
            value: r.value, compare: r.compare, compareRange: r.compareRange, href: r.href,
            columns: def.columns.map((c) => ({ key: String(c.key), label: c.label })),
            rows: (r.rows as Record<string, unknown>[]).slice(0, MAX_ROWS_ON_PAGE), rowCount: r.rows.length,
            exportHref: `/api/reporting/export?metric=${encodeURIComponent(def.key)}&preset=${preset}${sp.from ? `&from=${sp.from}` : ""}${sp.to ? `&to=${sp.to}` : ""}`,
          });
        } catch {
          // ForbiddenError: the section map and the metric's roles disagree — the metric wins; the tile is simply absent.
        }
      }
      tilesBySection.set(s, tiles);
    }
  }

  const compareLabel = (() => {
    const first = [...tilesBySection.values()].flat().find((t) => t.compareRange);
    return first?.compareRange ? ` · compared with ${rangeLabel(first.compareRange)}` : "";
  })();
  const chipHref = (p: RangePreset) => (p === "custom" ? `/home?preset=custom&from=${range.from}&to=${range.to}` : `/home?preset=${p}`);

  return (
    <div className="home wrap" data-testid="home" data-roles={roles.join(" ")}>
      <header className="top">
        <h1>
          {greeting(now)}, <span data-testid="home-name">{firstName}</span>
          <small data-testid="home-range">{rangeLabel(range)}{compareLabel}</small>
        </h1>
        <div className="periods" role="group" aria-label="Period">
          {RANGE_PRESETS.map((p) => (
            <Link key={p} href={chipHref(p)} className="chip" aria-pressed={p === preset} data-testid={`range-${p}`}>{PRESET_LABEL[p]}</Link>
          ))}
        </div>
        {preset === "custom" && (
          <form className="custom" action="/home" method="get" data-testid="range-custom-form">
            <input type="hidden" name="preset" value="custom" />
            <label>From <input type="date" name="from" defaultValue={range.from} /></label>
            <label>To <input type="date" name="to" defaultValue={range.to} /></label>
            <button type="submit" className="chip">Apply</button>
          </form>
        )}
      </header>

      {roles.length === 0 && (
        <div className="empty" data-testid="home-no-roles">
          <div className="l">No dashboard roles yet</div>
          <p>The master user ticks Owner, Admin, Project coordinator, Sales or Finance against your login on Settings → Staff logins. Until then there is nothing here to show.</p>
        </div>
      )}

      {roles.length > 0 && (
        <div className="todo" data-testid="needs-doing">
          <h2><b data-testid="needs-doing-count">{cards.length} thing{cards.length === 1 ? "" : "s"}</b> need you today</h2>
          {cards.length === 0 ? (
            <p className="quiet">Nothing is waiting on you right now.</p>
          ) : (
            <div className="cards">
              {cards.map((c) => (
                <div key={c.key} className="tcard" data-testid="needs-doing-card">
                  <div className={`sev ${c.severity === "critical" ? "c" : c.severity === "amber" ? "a" : "i"}`}>{c.label}</div>
                  <div className="t">{c.title}</div>
                  <div className="s">{c.detail}</div>
                  <Link className="act" href={c.action.href}>{c.action.label}</Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {failures.length > 0 && (
        <div className="empty warn" role="status" data-testid="home-load-failure">
          <div className="l">Some of this page could not be read</div>
          <p>{failures.map((f) => `${f.where}: ${f.message}`).join(" · ")} — the numbers below leave those out rather than showing zero.</p>
        </div>
      )}

      {sections.filter((s) => s !== "needs_doing").map((s) => {
        const tiles = tilesBySection.get(s) ?? [];
        const live = metricsForSection(s).length > 0;
        return (
          <section key={s} data-testid={`section-${s}`} data-section={s}>
            <h2>
              {SECTION_TITLE[s]}
              <em>{live ? (tiles.some((t) => t.kind === "now") && !tiles.some((t) => t.kind === "period") ? "right now" : "this period") : ""}</em>
            </h2>
            {live ? (
              <HomeTiles tiles={tiles} />
            ) : (
              <div className="empty" data-testid={`switches-on-${s}`}>
                <div className="l">Switches on when {SWITCHES_ON[s] ?? "its module"} ships</div>
                <p>Nothing on this page fakes a number. This section reads from a module that is not live yet; it lights up the day it lands, with no change here.</p>
              </div>
            )}
          </section>
        );
      })}

      {roles.length > 0 && (
        <p className="hint" data-testid="home-roles-hint">
          You are seeing the {roles.map((r) => ROLE_LABEL[r]).join(" + ")} view · {METRICS.length} metric{METRICS.length === 1 ? "" : "s"} live · every number reads from the event logs; nothing on this page is typed in.
        </p>
      )}
    </div>
  );
}
