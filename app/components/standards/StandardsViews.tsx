import Link from "next/link";
import {
  LEVELS, RULE_PAGES, levelName, sectionHref, surfaceHref, surfacesOn,
  type Level, type SectionKey, type Side, type StandardSurface, type Standards,
} from "@/lib/standards/model";
import "./standards.css";

/**
 * The finish standards screens, shared by the painter portal and PC Command
 * (ruling S12: the painter and the PC read the same record). Server
 * components; the host passes `base` so every link stays in its own shell.
 * Built to design/reference/contractor-status-standards-mockup.html: a
 * surface grid with an Interior / Exterior switch, a surface page with a level
 * switch (or locked to a job's level with "See other levels"), and the six
 * rule pages. Wording is the approved file's, never shortened here.
 */

export function StandardsIndex({ standards, base, side, intro }: {
  standards: Standards; base: "portal" | "pc"; side: Side; intro?: React.ReactNode;
}) {
  const root = base === "portal" ? "/portal/help/standards" : "/pc/standards";
  return (
    <div className="std" data-testid="standards-index">
      <div className="std-head">
        <span className="std-eyebrow">Help</span>
        <h1>Finish standards</h1>
      </div>
      {intro}
      <div className="std-card">
        <div className="std-row">
          <span className="std-pill">Version {standards.version.no}</span>
          <span className="std-pill">Approved {longDate(standards.version.publishedOn)}</span>
        </div>
        <p className="std-eyebrow" style={{ marginTop: 4 }}>Find a surface</p>
        <nav className="std-seg" aria-label="Interior or exterior">
          {(["interior", "exterior"] as const).map((k) => (
            <Link key={k} href={`${root}?side=${k}`} aria-current={side === k ? "true" : undefined} data-testid={`standards-side-${k}`}>
              {k === "interior" ? "Interior" : "Exterior"}
            </Link>
          ))}
        </nav>
        <div className="std-grid" data-testid="standards-grid">
          {surfacesOn(standards, side).map((s) => (
            <Link key={s.key} href={surfaceHref(base, s.key)} className="std-tile" data-testid={`standards-surface-${s.key}`}>
              {s.name}
            </Link>
          ))}
        </div>
      </div>
      <div className="std-card">
        <span className="std-eyebrow">The rules</span>
        <nav className="std-list" aria-label="The rules">
          {RULE_PAGES.map((p) => (
            <Link key={p.key} href={sectionHref(base, p.key)} data-testid={`standards-section-${p.key}`}>{p.title}</Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

/**
 * One surface at one level. `lock` = opened from a job's surface line: the
 * level is that job's and the switch is replaced by "See other levels".
 */
export function SurfaceStandard({ standards, surface, level, base, lock, back }: {
  standards: Standards;
  surface: StandardSurface;
  level: Level;
  base: "portal" | "pc";
  lock?: { job: string } | null;
  back: { href: string; label: string };
}) {
  const ln = levelName(standards, level);
  return (
    <div className="std" data-testid="standards-surface" data-surface={surface.key} data-level={level} data-locked={lock ? "true" : "false"}>
      <Link href={back.href} className="std-back" data-testid="standards-back">← {back.label}</Link>
      <div className="std-head">
        <span className="std-eyebrow">{surface.side === "exterior" ? "Exterior" : "Interior"}</span>
        <h1>{surface.name}</h1>
      </div>
      {lock ? (
        <div className="std-row">
          <span className="std-pill info" data-testid="standards-locked-level">Level {level} on this job</span>
          <Link href={surfaceHref(base, surface.key, { level })} className="std-link" data-testid="standards-unlock">See other levels ›</Link>
        </div>
      ) : (
        <nav className="std-seg" aria-label="Level">
          {LEVELS.map((l) => (
            <Link key={l} href={surfaceHref(base, surface.key, { level: l })} aria-current={level === l ? "true" : undefined} data-testid={`standards-level-${l}`}>
              Level {l}
            </Link>
          ))}
        </nav>
      )}
      {surface.intro && <p>{surface.intro}</p>}
      <div className="std-card every">
        <span className="std-eyebrow">Every level</span>
        <p data-testid="standards-every-level">{surface.everyLevel}</p>
      </div>
      <div className="std-card">
        <div className="std-row">
          <span className="std-eyebrow grow">Level {level} · {ln.name}</span>
          <span className="std-pill">Look test {ln.lookTest}</span>
        </div>
        <dl className="std-rows" data-testid="standards-checks">
          {surface.checks.map((c) => (
            <div key={c.sort}>
              <dt>{c.label}</dt>
              <dd>{c.text[level]}</dd>
            </div>
          ))}
        </dl>
      </div>
      {surface.note && <div className="std-note">{surface.note}</div>}
      {surface.side === "exterior" && (
        <details className="std-card">
          <summary>Rules for every exterior surface</summary>
          <ul className="std-clean" style={{ marginTop: 8 }}>
            {standards.exterior.rules.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/** A surface with all three levels side by side — the sign-off reads it this way (Step 2). */
export function SurfaceAllLevels({ surface }: { surface: StandardSurface }) {
  return (
    <details className="std-card" data-testid={`standards-all-${surface.key}`}>
      <summary>{surface.name}</summary>
      {surface.intro && <p style={{ marginTop: 8 }}>{surface.intro}</p>}
      <p style={{ marginTop: 8 }}><b>Every level:</b> {surface.everyLevel}</p>
      <dl className="std-rows" style={{ marginTop: 8 }}>
        {surface.checks.map((c) => (
          <div key={c.sort}>
            <dt>{c.label}</dt>
            <dd>
              {LEVELS.map((l) => (
                <span key={l} style={{ display: "block", marginTop: 4 }}><span className="std-lv">L{l}</span>{c.text[l]}</span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      {surface.note && <p className="std-sub" style={{ marginTop: 8, color: "var(--muted)" }}>{surface.note}</p>}
    </details>
  );
}

/** One of the rule pages. */
export function StandardsSection({ standards, section, back }: {
  standards: Standards; section: SectionKey; back: { href: string; label: string };
}) {
  const title = RULE_PAGES.find((p) => p.key === section)?.title
    ?? (section === "interior" ? "Interior surfaces" : "Exterior surfaces");
  return (
    <div className="std" data-testid="standards-section" data-section={section}>
      <Link href={back.href} className="std-back" data-testid="standards-back">← {back.label}</Link>
      <h1>{title}</h1>
      <SectionBody standards={standards} section={section} />
    </div>
  );
}

export function SectionBody({ standards, section }: { standards: Standards; section: SectionKey }) {
  switch (section) {
    case "levels": {
      const b = standards.levels;
      return (
        <>
          <p>{b.intro}</p>
          {b.items.map((item) => (
            <div className="std-card" key={item.level} data-testid={`standards-level-card-${item.level}`}>
              <div className="std-row">
                <h3 className="grow" style={{ margin: 0 }}>Level {item.level}</h3>
                <span className="std-pill">Look test {item.look_test_distance}</span>
              </div>
              <p style={{ color: "var(--muted)", fontSize: 13 }}>{item.name}</p>
              <dl className="std-rows">
                {item.summary.map((r) => <div key={r.label}><dt>{r.label}</dt><dd>{r.text}</dd></div>)}
              </dl>
            </div>
          ))}
          <div className="std-card">
            <h3>How to use the look test</h3>
            <ol className="std-clean">{b.look_test_steps.map((t) => <li key={t}>{t}</li>)}</ol>
            <p style={{ color: "var(--muted)", fontSize: 13 }}>{b.look_test_high_areas}</p>
          </div>
          <div className="std-note">{b.closing}</div>
        </>
      );
    }
    case "rules": {
      const b = standards.rules;
      return (
        <>
          <p>{b.intro}</p>
          <div className="std-card">
            <dl className="std-rows">{b.items.map((r) => <div key={r.rule}><dt>{r.rule}</dt><dd>{r.meaning}</dd></div>)}</dl>
          </div>
          <div className="std-note">{b.closing}</div>
        </>
      );
    }
    case "time": {
      const b = standards.time;
      return (
        <>
          <p>{b.intro}</p>
          <div className="std-card"><h3>Standard preparation, interior</h3><ul className="std-clean">{b.standard_preparation.interior.map((t) => <li key={t}>{t}</li>)}</ul></div>
          <div className="std-card"><h3>Standard preparation, exterior</h3><ul className="std-clean">{b.standard_preparation.exterior.map((t) => <li key={t}>{t}</li>)}</ul></div>
          <div className="std-card">
            <h3>Extra time, shown on your work order</h3>
            <p style={{ color: "var(--muted)", fontSize: 13 }}>{b.extra_time_intro}</p>
            <dl className="std-rows">
              {b.extra_time.map((x) => <div key={x.name}><dt>{x.name}</dt><dd>{x.meaning}<span className="std-sub">{x.examples}</span></dd></div>)}
            </dl>
          </div>
          <div className="std-card">
            <h3>Variations</h3>
            <p>{b.variation_intro}</p>
            <ol className="std-clean">{b.variation_steps.map((t) => <li key={t}>{t}</li>)}</ol>
          </div>
          <div className="std-note">{b.closing}</div>
        </>
      );
    }
    case "interior":
      return <p>{standards.interior.intro}</p>;
    case "exterior":
      return (
        <>
          <p>{standards.exterior.intro}</p>
          <div className="std-card"><h3>Every exterior surface</h3><ul className="std-clean">{standards.exterior.rules.map((t) => <li key={t}>{t}</li>)}</ul></div>
        </>
      );
    case "defect": {
      const b = standards.defect;
      return (
        <>
          <p>{b.intro}</p>
          <div className="std-card"><ol className="std-clean">{b.steps.map((t) => <li key={t}>{t}</li>)}</ol></div>
          <div className="std-note" data-testid="standards-small-job-note">{b.small_job_note}</div>
          <div className="std-card"><h3>Why we do this</h3><ul className="std-clean">{b.why.map((t) => <li key={t}>{t}</li>)}</ul></div>
          <div className="std-card"><h3>What counts as a defect</h3><dl className="std-rows">{b.defects.map((d) => <div key={d.defect}><dt>{d.defect}</dt><dd>{d.examples}</dd></div>)}</dl></div>
          <div className="std-note">{b.closing}</div>
        </>
      );
    }
    case "checklist":
      return (
        <>
          <p>{standards.checklist.intro}</p>
          <div className="std-card"><ol className="std-clean">{standards.checklist.items.map((t) => <li key={t}>{t}</li>)}</ol></div>
        </>
      );
    case "words":
      return (
        <div className="std-card">
          <dl className="std-rows">{standards.words.items.map((w) => <div key={w.word}><dt>{w.word}</dt><dd>{w.meaning}</dd></div>)}</dl>
        </div>
      );
  }
}

/** When the tables could not be read: say so, never "there are no standards". */
export function StandardsUnavailable({ message }: { message: string }) {
  return (
    <div className="std">
      <div className="std-head"><span className="std-eyebrow">Help</span><h1>Finish standards</h1></div>
      <div className="std-err" role="alert" data-testid="standards-unavailable">{message} Ring the office if this keeps happening.</div>
    </div>
  );
}

function longDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
