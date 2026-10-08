import Link from "next/link";
import type { Expectation } from "@/lib/standards/model";

/**
 * "What we expect on this job" — ONE card at the top of the work order (Tom,
 * 9 Oct 2026): every scope line that has a finish standard, with the checks
 * for that area's level in plain words, each opening the full standard.
 * Server-safe; the only interaction is the browser's own <details>.
 */
export default function WhatWeExpect({ items, mode }: { items: Expectation[]; mode: "portal" | "pc" }) {
  if (items.length === 0) return null;
  const levels = [...new Set(items.map((i) => i.level))];
  return (
    <section className={`std wwe wwe-${mode}`} data-testid="what-we-expect" data-count={items.length}>
      <div className="wwe-head">
        <div>
          <span className="std-eyebrow">Finish standards</span>
          <h2>What we expect on this job</h2>
        </div>
        <span className="std-pill info">{levels.length === 1 ? `Level ${levels[0]}` : "Mixed levels"}</span>
      </div>
      <p className="wwe-intro">{items.length} {items.length === 1 ? "line" : "lines"} in the scope with a standard. Tap a line for the checks at this job&rsquo;s level.</p>
      <div className="wwe-list">
        {items.map((it) => (
          <details key={it.key} className="wwe-item" data-testid={`wwe-line-${it.key}`} data-surface={it.surfaceKey} data-level={it.level}>
            <summary>
              <span className="wwe-name"><b>{it.area}</b> · {it.label}</span>
              <span className="wwe-meta">{it.surfaceName} · Level {it.level}</span>
            </summary>
            <div className="wwe-body">
              <p className="wwe-every"><span className="std-eyebrow">Every level</span> {it.everyLevel}</p>
              <dl className="std-rows">
                {it.checks.map((c) => (
                  <div key={c.label}><dt>{c.label}</dt><dd>{c.text}</dd></div>
                ))}
              </dl>
              <p className="wwe-foot">
                <span className="std-pill">Look test {it.lookTest}</span>
                <Link href={it.href} className="std-link" data-testid={`wwe-open-${it.key}`}>Open the full standard ›</Link>
              </p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
