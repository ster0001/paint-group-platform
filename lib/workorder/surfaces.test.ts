import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allSurfacesDone, describeArea, gatedRows, jobNeedsAfterPhotos, jobNeedsBeforePhotos, nextState,
  progressByHeading, progressOf, seedRowsFromDoc, statusFromState,
  ticksBySurfaceKey, SURFACE_STATE_LABEL, tickNeedsBeforePhotos, type SurfaceRow,
} from "./surfaces";
import type { WorkOrderDoc, WOArea } from "./snapshot";

const area = (title: string, labels: string[], coats = 2, finishCode: string | null = "PG-3"): WOArea => ({
  id: title.toLowerCase(),
  title,
  finishCode,
  finishOverridden: false,
  photos: [],
  surfaces: labels.map((label, i) => ({
    key: `${title.toLowerCase()}:${i}`,
    label, coats, product: "Weathershield", prep: "", hours: 2, status: "not_started" as const,
  })),
});

const doc = (areas: WOArea[]) => ({ version: 1, areas } as unknown as WorkOrderDoc);

const rows = (spec: [string, string, SurfaceRow["state"]][]): SurfaceRow[] =>
  spec.map(([heading, label, state], i) => ({ id: String(i), heading, label, state }));

describe("seeding the tick list from the document", () => {
  it("makes one row per surface, in document order", () => {
    const seeded = seedRowsFromDoc(doc([area("Front", ["Walls", "Windows"]), area("Left", ["Eaves"])]));
    expect(seeded.map((r) => `${r.heading}/${r.label}`)).toEqual([
      "Front/Walls", "Front/Windows", "Left/Eaves",
    ]);
    expect(seeded.map((r) => r.sort)).toEqual([0, 1, 2]);
  });

  it("keeps the document's own surface key, so re-seeding matches rows up", () => {
    const seeded = seedRowsFromDoc(doc([area("Front", ["Walls"])]));
    expect(seeded[0].surfaceKey).toBe("front:0");
  });

  it("describes an elevation from what the document actually knows", () => {
    expect(describeArea(area("Front", ["Walls", "Windows", "Door"]))).toBe("3 surfaces · 2 coats · PG-3");
  });

  it("says nothing it cannot support", () => {
    // No finish code and mixed coats: no invented measurements, no empty label.
    const a = area("Back", ["Walls", "Fence"], 2, null);
    a.surfaces[1].coats = 3;
    expect(describeArea(a)).toBe("2 surfaces · 2–3 coats");
  });

  it("handles a single surface without mangling the plural", () => {
    expect(describeArea(area("Left", ["Eaves"], 1))).toBe("1 surface · 1 coat · PG-3");
  });

  it("lets a caller pass richer heading text when it has it", () => {
    const seeded = seedRowsFromDoc(doc([area("Front", ["Walls"])]), () => "12 × 2.6 m · wb 75 / render 25");
    expect(seeded[0].headingMeta).toBe("12 × 2.6 m · wb 75 / render 25");
  });
});

describe("only real work is tickable", () => {
  it("takes rows from areas' surfaces and nothing else", () => {
    // A doc carrying a line-item-shaped block alongside its areas: allowances,
    // traffic management, skip hire. A painter must never be asked to mark a
    // scaffold hire as "prepped", and the progress bar must mean work done.
    const withLineItems = {
      version: 1,
      areas: [area("Front", ["Walls"])],
      // Line items live outside `areas` by construction — this asserts the
      // seeder reads only `areas`, so nothing else can leak in.
      lines: [{ label: "Traffic management", cents: 120_000 }],
      exclusions: ["Right side — not painting"],
    } as unknown as WorkOrderDoc;

    const rows = seedRowsFromDoc(withLineItems);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Walls");
    expect(rows.some((r) => r.label.toLowerCase().includes("traffic"))).toBe(false);
  });

  it("skips a surface with no label — that is not work anybody can tick", () => {
    const a = area("Front", ["Walls", ""]);
    expect(seedRowsFromDoc(doc([a]))).toHaveLength(1);
  });

  it("the builder never puts a non-area block in the document", () => {
    // The upstream half of the same rule, pinned so a refactor cannot drop it.
    const builder = readFileSync(
      resolve(process.cwd(), "app/quote/QuoteBuilder.tsx"), "utf8");
    expect(builder).toContain('if (b.kind !== "area" || b.isOption) continue;');
  });
});

describe("progress is derivable from the data alone", () => {
  const list = rows([
    ["Front", "Walls", "done"], ["Front", "Windows", "done"],
    ["Left", "Eaves", "done"], ["Left", "Walls", "prepped"], ["Left", "Windows", "todo"],
  ]);

  it("counts done over total", () => {
    expect(progressOf(list)).toEqual({ done: 3, total: 5, pct: 60 });
  });

  it("does not count prepped as done — the bar must not flatter the job", () => {
    expect(progressOf(rows([["Front", "Walls", "prepped"]]))).toEqual({ done: 0, total: 1, pct: 0 });
  });

  it("counts each elevation separately for its own 7/7", () => {
    const byHeading = progressByHeading(list);
    expect(byHeading.get("Front")).toEqual({ done: 2, total: 2, pct: 100 });
    expect(byHeading.get("Left")).toEqual({ done: 1, total: 3, pct: 33 });
  });

  it("survives an empty list without dividing by zero", () => {
    expect(progressOf([])).toEqual({ done: 0, total: 0, pct: 0 });
    expect(allSurfacesDone([])).toBe(false);
  });

  it("only calls the job done when every surface is", () => {
    expect(allSurfacesDone(list)).toBe(false);
    expect(allSurfacesDone(rows([["Front", "Walls", "done"], ["Left", "Eaves", "done"]]))).toBe(true);
  });
});

describe("the tap cycle", () => {
  it("advances todo → prepped → done", () => {
    expect(nextState("todo")).toBe("prepped");
    expect(nextState("prepped")).toBe("done");
  });

  it("wraps back to todo, so a mis-tap can be undone on the phone", () => {
    expect(nextState("done")).toBe("todo");
  });
});

describe("the before photos, per job (Tom, 30 Sep)", () => {
  const two = rows([["Front", "Walls", "todo"], ["Right", "Walls", "todo"]]);

  it("asks once for the job, not per elevation", () => {
    expect(jobNeedsBeforePhotos(two, false)).toBe(true);
    expect(jobNeedsBeforePhotos(two, true)).toBe(false);
  });

  it("one before photo anywhere unlocks every row", () => {
    expect(tickNeedsBeforePhotos(two[1], true)).toBe(false);
    expect(tickNeedsBeforePhotos(two[1], false)).toBe(true);
  });

  it("a job of only 'photos not required' rows asks for nothing", () => {
    const fuel = rows([["Site", "Fuel allowance", "todo"]]).map((r) => ({ ...r, photosOptional: true }));
    expect(jobNeedsBeforePhotos(fuel, false)).toBe(false);
    expect(tickNeedsBeforePhotos(fuel[0], false)).toBe(false);
  });
});

describe("live ticks on the job sheet", () => {
  // The snapshot's per-surface status is frozen at issue and never written
  // again, so a job sheet that reads it says "Not started" over finished work.
  it("keys the ticks by the document's own surface key", () => {
    expect(ticksBySurfaceKey([
      { surface_key: "front:0", state: "done" },
      { surface_key: "front:1", state: "prepped" },
    ])).toEqual({ "front:0": "done", "front:1": "prepped" });
  });

  it("skips a rectification row, which has no counterpart in the document", () => {
    expect(ticksBySurfaceKey([
      { surface_key: null, state: "todo" },
      { surface_key: "front:0", state: "done" },
    ])).toEqual({ "front:0": "done" });
  });

  it("says the same three things the document does", () => {
    expect(statusFromState("todo")).toBe("not_started");
    expect(statusFromState("prepped")).toBe("in_progress");
    expect(statusFromState("done")).toBe("complete");
    expect(SURFACE_STATE_LABEL.done).toBe("Complete");
  });
});

// ---- the finished-photo prompt ----------------------------------------------

describe("the after photos, per job (Tom, 30 Sep)", () => {
  const rowsOf = (state: "todo" | "prepped" | "done") => [
    { id: "1", heading: "Front", label: "Render", state, rectification: false },
    { id: "2", heading: "Left", label: "Trim", state, rectification: false },
  ] as SurfaceRow[];

  it("asks once every working row is done, and not before", () => {
    expect(jobNeedsAfterPhotos(rowsOf("done"), false)).toBe(true);
    expect(jobNeedsAfterPhotos(rowsOf("prepped"), false)).toBe(false);
  });

  it("stops asking once an after photo is on the job", () => {
    expect(jobNeedsAfterPhotos(rowsOf("done"), true)).toBe(false);
  });

  it("a removed row does not hold the job back", () => {
    const rows = [...rowsOf("done"), { id: "3", heading: "Left", label: "Gate", state: "todo", removed: true } as SurfaceRow];
    expect(jobNeedsAfterPhotos(rows, false)).toBe(true);
  });

  it("no surfaces is not 'finished'", () => {
    expect(jobNeedsAfterPhotos([], false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Photo rules (Tom, 24 Sep 2026): "photos not required" lines — the twin of
// wo_tick_surface's arithmetic (per JOB since 20270207).
// ---------------------------------------------------------------------------
describe("photos not required on a line", () => {
  const fuel: SurfaceRow = { id: "f", heading: "Allowances", label: "Fuel allowance", state: "todo", photosOptional: true };
  const walls: SurfaceRow = { id: "w", heading: "Front", label: "Walls", state: "todo" };
  const trims: SurfaceRow = { id: "t", heading: "Front", label: "Trims", state: "todo", photosOptional: true };

  it("optional rows are not gated rows", () => {
    expect(gatedRows([fuel, walls, trims]).map((r) => r.id)).toEqual(["w"]);
  });

  it("ticking an optional row never needs the before photos; the photo row does", () => {
    expect(tickNeedsBeforePhotos(fuel, false)).toBe(false);
    expect(tickNeedsBeforePhotos(trims, false)).toBe(false);
    expect(tickNeedsBeforePhotos(walls, false)).toBe(true);
    expect(tickNeedsBeforePhotos(walls, true)).toBe(false);
  });

  it("the after photos are asked for when the PHOTO rows complete, whatever the optional ones say", () => {
    expect(jobNeedsAfterPhotos([{ ...walls, state: "done" }, trims, fuel], false)).toBe(false); // trims/fuel still todo → not all working rows done
    expect(jobNeedsAfterPhotos([{ ...walls, state: "done" }, { ...trims, state: "done" }, { ...fuel, state: "done" }], false)).toBe(true);
    expect(jobNeedsAfterPhotos([{ ...fuel, state: "done" }], false)).toBe(false);
  });
});
