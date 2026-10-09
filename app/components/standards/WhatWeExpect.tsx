import Link from "next/link";
import { groupExpectations, type Expectation } from "@/lib/standards/model";

/**
 * "What we expect on this job" — ONE drop-down at the top of the work order,
 * for the painter and PC Command alike (Tom, 9 Oct 2026: "1 drop down document
 * … to save scrolling"). Closed it is a single row; open it reads as one
 * document: each standard once at its level, the rooms it covers, the checks
 * in plain words, and a link to the full standard. Server-safe; the only
 * interaction is the browser's own <details>.
 */
export default function WhatWeExpect({ items, mode }: { items: Expectation[]; mode: "portal" | "pc" }) {
  if (items.length === 0) return null;
  const sections = groupExpectations(items);
  const levels = [...new Set(items.map((i) => i.level))];
  return (
    <details
      className={`std wwe wwe-${mode}`}
      data-testid="what-we-expect"
      data-count={items.length}
      data-sections={sections.length}
    >
      <summary className="wwe-head" data-testid="what-we-expect-toggle">
        <div>
          <span className="std-eyebrow">Finish standards</span>
          <h2>What we expect on this job</h2>
          <p className="wwe-intro">
            {sections.length} {sections.length === 1 ? "standard" : "standards"} · {items.length} {items.length === 1 ? "line" : "lines"} in the scope
          </p>
        </div>
        <span className="std-pill info">{levels.length === 1 ? `Level ${levels[0]}` : "Mixed levels"}</span>
      </summary>
      <div className="wwe-doc">
        {sections.map((sec) => (
          <section key={sec.key} className="wwe-sec" data-testid={`wwe-std-${sec.key}`} data-surface={sec.surfaceKey} data-level={sec.level}>
            <h3>{sec.surfaceName} <span className="wwe-meta">· Level {sec.level}</span></h3>
            <ul className="wwe-lines">
              {sec.lines.map((l) => (
                <li key={l.key} data-testid={`wwe-line-${l.key}`}><b>{l.area}</b> · {l.label}</li>
              ))}
            </ul>
            <p className="wwe-every"><span className="std-eyebrow">Every level</span> {sec.everyLevel}</p>
            <dl className="std-rows">
              {sec.checks.map((c) => (
                <div key={c.label}><dt>{c.label}</dt><dd>{c.text}</dd></div>
              ))}
            </dl>
            <p className="wwe-foot">
              <span className="std-pill">Look test {sec.lookTest}</span>
              <Link href={sec.href} className="std-link" data-testid={`wwe-open-${sec.key}`}>Open the full standard ›</Link>
            </p>
          </section>
        ))}
      </div>
    </details>
  );
}
