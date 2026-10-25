"use client";

import { useState } from "react";
import { COLOUR_HELP_LABEL, EXTRA_NOTE_MAX, type JobExtra } from "@/lib/wizard/extras";

/**
 * The whole-job extras sheet — plan §4.5.
 *
 * "Named extras price; unusual ones flag." The two are deliberately different
 * controls, because they behave differently and the customer must be able to
 * see which is which: the listed ones show a price and change the range, the
 * sentence shows no price and says so.
 *
 * The list is derived from the rate card, so an empty card means an empty
 * sheet — a tick that cannot price is a lie. The note box is always there,
 * because "something we haven't listed" is exactly what a card cannot cover.
 */
export default function JobExtras({
  offer, on, counts = {}, colourHelp, note, busy, onToggle, onCount, onColourHelp, onNote,
}: {
  offer: JobExtra[];
  on: string[];
  /** Tom, 25 Oct 2026 (item 13): how many of each ticked extra (two air vents). */
  counts?: Record<string, number>;
  colourHelp: boolean;
  note: string;
  busy?: boolean;
  onToggle: (code: string, on: boolean) => void;
  onCount?: (code: string, count: number) => void;
  onColourHelp: (want: boolean) => void;
  onNote: (note: string) => void;
}) {
  const [draft, setDraft] = useState(note);
  const dirty = draft.trim() !== note.trim();
  const chosen = new Set(on);

  const groups = [...new Set(offer.map((e) => e.group))];

  return (
    <section className="sc-rc il-card sc-extras" data-card="extras" data-testid="extras-card">
      <div className="sc-hd il-hd">
        <b>Anything we haven&rsquo;t listed</b>
        <span className="il-pill">OPTIONAL</span>
      </div>
      <p className="wz-note" style={{ margin: "2px 0 12px" }}>
        A feature wall, a ceiling rose, mould to treat — name it and we&rsquo;ll price it. Anything unusual, tell us
        below and one of our people will price it properly rather than guess.
      </p>

      {groups.map((group) => (
        <div className="il-q" key={group}>
          <p className="il-ql">{group}</p>
          <div className="sc-chips">
            {offer.filter((e) => e.group === group).map((e) => {
              const isOn = chosen.has(e.code);
              const slug = e.code.replace(/\s+/g, "-").toLowerCase();
              const n = counts[e.code] ?? 1;
              return (
                <span key={e.code} className={`sc-extra-chip ${isOn ? "on" : ""}`}>
                  <button
                    type="button"
                    className={`sd-chip il-chip ${isOn ? "on" : ""}`}
                    aria-pressed={isOn}
                    disabled={busy}
                    data-testid={`extra-${slug}`}
                    onClick={() => onToggle(e.code, !isOn)}
                  >{e.label} · ${e.priceDollars}{isOn && n > 1 ? ` × ${n}` : ""}</button>
                  {/* Tom, 25 Oct 2026 (item 13): how many — on the sheet, where the tick is. */}
                  {isOn && onCount && (
                    <span className="sc-st" data-testid={`extra-count-${slug}`}>
                      <button type="button" aria-label={`fewer ${e.label.toLowerCase()}`} disabled={busy || n <= 1} onClick={() => onCount(e.code, n - 1)}>−</button>
                      <b>{n}</b>
                      <button type="button" aria-label={`more ${e.label.toLowerCase()}`} disabled={busy || n >= 20} onClick={() => onCount(e.code, n + 1)}>+</button>
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      ))}

      <div className="il-q">
        <p className="il-ql">Colours</p>
        <div className="sc-chips">
          <button
            type="button"
            className={`sd-chip il-chip ${colourHelp ? "on" : ""}`}
            aria-pressed={colourHelp}
            disabled={busy}
            data-testid="extra-colour-help"
            onClick={() => onColourHelp(!colourHelp)}
          >{COLOUR_HELP_LABEL}</button>
        </div>
      </div>

      <div className="il-q" data-testid="extra-note-block">
        <p className="il-ql">
          Something else?
          <span className="il-hm"> Tell us in your own words. We won&rsquo;t put a price on it until a person has read it.</span>
        </p>
        <textarea
          className="sc-extra-note"
          rows={3}
          maxLength={EXTRA_NOTE_MAX}
          value={draft}
          placeholder="e.g. a mural in the hallway, or the garage roller door"
          data-testid="extra-note"
          onChange={(ev) => setDraft(ev.target.value)}
        />
        <button
          type="button"
          className="sd-chip il-chip"
          disabled={busy || !dirty}
          data-testid="extra-note-save"
          onClick={() => onNote(draft.trim().slice(0, EXTRA_NOTE_MAX))}
        >{dirty ? "Add this" : "Added ✓"}</button>
      </div>
    </section>
  );
}
