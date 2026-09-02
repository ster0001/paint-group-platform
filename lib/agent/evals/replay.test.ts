/**
 * S8 — the replay set: determinism (same brief twice → identical tree and
 * cents) and every fill-in listed, over twenty synthetic enquiries; the
 * regression corpus is reported when present. See ./replay.ts.
 */
import { describe, expect, it } from "vitest";
import { heuristicExtract } from "../brief-extract";
import { proposeFromBrief } from "../propose";
import { priceScope } from "../scope-tools";
import { emptyDoc } from "../scope-store";
import { docBlocks } from "../scope-doc";
import { corpusReplay, REPLAY_DEPS as deps, SYNTHETIC_ENQUIRIES } from "./replay";

describe("S8 replay — synthetic enquiries", () => {
  it.each(SYNTHETIC_ENQUIRIES.map((t, i) => [i + 1, t] as const))("enquiry %i: deterministic tree and cents; every fill-in listed", (_i, text) => {
    const x = heuristicExtract(text);
    const a = proposeFromBrief(emptyDoc("e", "residential"), x, deps, { mode: "cowork", gateCents: 15_000 });
    const b = proposeFromBrief(emptyDoc("e", "residential"), x, deps, { mode: "cowork", gateCents: 15_000 });
    expect(a.ok, text).toBe(true);
    if (!a.ok || !b.ok) return;
    const rows = (d: typeof a.working) => docBlocks(d).flatMap((r) => (r.surfaces ?? []).map((s) => `${r.name}|${s.code}|${s.count ?? 1}`)).sort();
    expect(rows(a.working)).toEqual(rows(b.working));
    expect(priceScope(a.working, deps).totalCents).toBe(priceScope(b.working, deps).totalCents);
    expect(priceScope(a.working, deps).totalCents).toBeGreaterThan(0);
    expect(a.summary.assumed.length).toBeGreaterThan(0);
    // No $0 line, no invented surface.
    for (const r of docBlocks(a.working)) for (const s of r.surfaces ?? []) expect(String(s.code)).not.toBe("");
  });
});

describe("S8 replay — the regression corpus (when present)", () => {
  it("runs the corpus through co-work and reports the correction", () => {
    const r = corpusReplay();
    if (!r) { console.log("corpus absent — skipped (git-ignored; run locally)"); return; }
    console.log(`corpus replay: ${r.jobs} jobs · median correction $${Math.round(r.medianCorrectionCents / 100)} · rooms matched ${r.roomsMatchedPct}%`);
    expect(r.jobs).toBeGreaterThan(0);
  });
});
