import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { melbourneDay, parsePreset, rangeLabel, rangeShortLabel, resolveRange, runMetric, type MetricResult, type RangePreset } from "@/lib/reporting/core";
import { RANGE_COOKIE, parseRangeCookie } from "@/lib/reporting/rangeCookie";
import RangePicker from "./RangePicker";
import { loadDashboard, loadRoles } from "@/lib/reporting/load";
import { METRICS, SECTION_TITLE, SWITCHES_ON, metricsForSection } from "@/lib/reporting/registry";
import { ROLE_LABEL, sectionsFor, seesMoney, type DashboardSection } from "@/lib/reporting/roles";
import { buildTarget } from "@/lib/reporting/metrics/target";
import { buildFunnel } from "@/lib/reporting/metrics/funnel";
import { activityRows, familiesFor } from "@/lib/reporting/metrics/activity";
import TargetCard from "./TargetCard";
import FunnelCard from "./FunnelCard";
import ActivityFeed from "./ActivityFeed";
import { anomalyCards, buildStrip, type StripCard } from "@/lib/reporting/strip";
import type { DashboardRole } from "@/lib/reporting/roles";
import type { DashboardLoad } from "@/lib/reporting/load";
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

export default async function HomePage({ searchParams }: { searchParams: Promise<{ preset?: string; from?: string; to?: string; who?: string; family?: string; q?: string }> }) {
  const sp = await searchParams;
  // The period: the URL first, then the remembered choice, then this month.
  const remembered = parseRangeCookie((await cookies()).get(RANGE_COOKIE)?.value);
  const fromUrl: RangePreset | null = parsePreset(sp.preset) ?? (sp.from && sp.to ? "custom" : null);
  const preset: RangePreset = fromUrl ?? remembered?.preset ?? "month";
  const custom = fromUrl ? { from: sp.from, to: sp.to } : { from: remembered?.from, to: remembered?.to };
  const now = requestNow();
  const range = resolveRange(preset, now, custom);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const profileRes = await supabase.from("profiles").select("name").eq("id", user?.id ?? "").maybeSingle();
  if (profileRes.error) reportError(profileRes.error, { where: "home.profile", bestEffort: true });
  const firstName = (((profileRes.data as { name?: string | null } | null)?.name) ?? user?.email ?? "").split(/[\s@]/)[0] || "there";

  const roles = await loadRoles(supabase);
  const sections = sectionsFor(roles);

  const who: "mine" | "team" | undefined = sp.who === "mine" || sp.who === "team" ? sp.who : undefined;
  const viewer = { userId: user?.id ?? null, who, family: sp.family ?? null, q: sp.q ?? null };
  const loaded = await loadDashboard(supabase, roles, ["needs_doing", ...sections], range, now, viewer);
  const failures = loaded.failures;
  const metricInput = roles.length > 0 ? loaded : null;
  const periodResults: MetricResult[] = [];

  const qs = (extra: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams();
    p.set("preset", preset); if (preset === "custom") { p.set("from", range.from); p.set("to", range.to); }
    const whoNow = loaded.input.sales?.who; if (whoNow) p.set("who", whoNow);
    if (sp.family) p.set("family", sp.family); if (sp.q) p.set("q", sp.q);
    for (const [k, v] of Object.entries(extra)) { if (v == null || v === "") p.delete(k); else p.set(k, v); }
    return p.toString();
  };
  const exportHrefFor = (key: string) => `/api/reporting/export?metric=${encodeURIComponent(key)}&${qs({})}`;
  const target = metricInput && sections.includes("sales") && seesMoney(roles) ? buildTarget(metricInput.input, range) : null;
  const funnel = metricInput && sections.includes("funnel") ? buildFunnel(metricInput.input, range) : null;
  const activityAll = metricInput && sections.includes("activity") ? activityRows(metricInput.input, range) : null;

  const tilesBySection = new Map<DashboardSection, TileData[]>();
  if (metricInput) {
    for (const s of sections) {
      const tiles: TileData[] = [];
      for (const def of metricsForSection(s)) {
        try {
          const r: MetricResult = runMetric(def, metricInput.input, range, roles);
          if (r.kind === "period" && !def.display) periodResults.push(r);
          tiles.push({
            key: r.key, kind: r.kind, title: r.title, definition: r.definition, unit: r.unit, gst: r.gst,
            value: r.value, compare: r.compare, compareRange: r.compareRange, note: r.note, href: r.href,
            columns: def.columns.map((c) => ({ key: String(c.key), label: c.label })),
            rows: (r.rows as Record<string, unknown>[]).slice(0, MAX_ROWS_ON_PAGE), rowCount: r.rows.length,
            exportHref: exportHrefFor(def.key),
            display: def.display ?? "tile",
          });
        } catch {
          // ForbiddenError: the section map and the metric's roles disagree — the metric wins; the tile is simply absent.
        }
      }
      tilesBySection.set(s, tiles);
    }
  }

  // Session 5: a period tile off its comparison by the Settings threshold is a strip card (owner/admin).
  const comparedWith = (r: MetricResult) => (r.compareRange ? rangeShortLabel(r.compareRange) : "last period");
  const extraCards = anomalyCards(periodResults, loaded.input.thresholds?.anomalyPct ?? 25, comparedWith);

  const compareLabel = (() => {
    const first = [...tilesBySection.values()].flat().find((t) => t.compareRange);
    return first?.compareRange ? ` · compared with ${rangeLabel(first.compareRange)}` : "";
  })();

  return (
    <div className="home wrap" data-testid="home" data-roles={roles.join(" ")} data-timings={JSON.stringify(loaded.timings ?? {})}>
      <header className="top">
        <h1>
          {greeting(now)}, <span data-testid="home-name">{firstName}</span>
          <small data-testid="home-range">{rangeLabel(range)}{compareLabel}</small>
        </h1>
        <RangePicker preset={preset} from={range.from} to={range.to} today={melbourneDay(now)} />
      </header>

      {roles.length === 0 && (
        <div className="empty" data-testid="home-no-roles">
          <div className="l">No dashboard roles yet</div>
          <p>The master user ticks Owner, Admin, Project coordinator, Sales or Finance against your login on Settings → Staff logins. Until then there is nothing here to show.</p>
        </div>
      )}

      {roles.length > 0 && (
        <Suspense fallback={<div className="todo" data-testid="needs-doing-pending"><h2><b>Working out</b> what needs you today…</h2></div>}>
          <NeedsDoing queue={loaded.queue} consoleCards={loaded.strip.consoleCards} extra={extraCards} roles={roles} />
        </Suspense>
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
            <h2 id={`section-${s}`}>
              {SECTION_TITLE[s]}
              <em>{live ? (tiles.some((t) => t.kind === "now") && !tiles.some((t) => t.kind === "period") ? "right now" : "this period") : ""}</em>
            </h2>
            {live ? (
              <>
                {s === "sales" && (
                  <div className="who" role="group" aria-label="Whose estimates" style={{ marginTop: 10 }}>
                    <Link href={`/home?${qs({ who: "mine" })}`} className="chip" aria-pressed={loaded.input.sales?.who === "mine"} data-testid="who-mine">Mine</Link>
                    <Link href={`/home?${qs({ who: "team" })}`} className="chip" aria-pressed={loaded.input.sales?.who === "team"} data-testid="who-team">Team</Link>
                  </div>
                )}
                {s === "activity" && activityAll ? (
                  <ActivityFeed
                    rows={activityAll.slice(0, 60)} total={activityAll.length}
                    families={familiesFor(roles)} family={sp.family ?? null} q={sp.q ?? null}
                    hrefFor={(p) => `/home?${qs({ family: p.family ?? null, q: p.q === undefined ? sp.q : p.q })}#section-activity`}
                    exportHref={exportHrefFor("activity.events")} now={now}
                  />
                ) : s === "funnel" && funnel ? (
                  <FunnelCard data={funnel} exportHref={exportHrefFor("funnel.wizard_sessions")} />
                ) : (
                  <HomeTiles tiles={tiles} />
                )}
                {s === "sales" && target && <TargetCard data={target} />}
              </>
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

/**
 * Session 6: the strip streams. The CRM work queue is the slowest read on the
 * page (fifteen sequential round trips inside the one evaluator) and nothing
 * but these cards needs it, so the sections render first and this fills in
 * when the queue resolves. Same cards, same order, same evaluator.
 */
async function NeedsDoing({ queue, consoleCards, extra, roles }: { queue: DashboardLoad["queue"]; consoleCards: DashboardLoad["strip"]["consoleCards"]; extra: StripCard[]; roles: DashboardRole[] }) {
  const q = queue ? await queue : { items: [], failure: null, ms: 0 };
  const cards = buildStrip({ workItems: q.items, consoleCards, extra }, roles);
  return (
    <div className="todo" data-testid="needs-doing" data-queue-ms={q.ms}>
      <h2><b data-testid="needs-doing-count">{cards.length} thing{cards.length === 1 ? "" : "s"}</b> need you today</h2>
      {q.failure && <p className="quiet" data-testid="needs-doing-failure">The CRM work queue could not be read ({q.failure.message}) — these are the job cards only.</p>}
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
  );
}
