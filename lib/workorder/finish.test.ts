/**
 * The finish-level mapping. This decides what prep a contractor is contractually
 * held to on site, so the FIN-1 case below is a business rule, not a default.
 * The WORDS of each level are pinned to the approved guide in
 * lib/standards/source.test.ts; this file is about the mapping.
 */
import { test, expect } from "vitest";
import {
  finishFromModifier,
  finishLevel,
  FINISH_LEVELS,
  FINISH_ORDER,
  DEFAULT_FINISH,
} from "./finish.ts";

test("FIN-n maps to PG-n by NUMBER, not by the label", () => {
  // The rate card calls FIN-4 "Premium" while the guide calls Level 3 "Our
  // standard finish" and Level 4 "Premium finish". The numbers are what map.
  expect(finishFromModifier("FIN-2")).toBe("PG-2");
  expect(finishFromModifier("FIN-3")).toBe("PG-3");
  expect(finishFromModifier("FIN-4")).toBe("PG-4");
  expect(FINISH_LEVELS["PG-3"].name).toBe("Our standard finish");
  expect(FINISH_LEVELS["PG-4"].name).toBe("Premium finish");
});

test("FIN-1 is deliberately unmapped", () => {
  // Promoting it to PG-2 would hold a contractor to more prep than the customer
  // paid for. The work order says "no PG level" instead.
  expect(finishFromModifier("FIN-1")).toBeNull();
});

test("an unrecognised or missing modifier gives no level rather than a guess", () => {
  expect(finishFromModifier(null)).toBeNull();
  expect(finishFromModifier(undefined)).toBeNull();
  expect(finishFromModifier("")).toBeNull();
  expect(finishFromModifier("FIN-9")).toBeNull();
  expect(finishFromModifier("PG-3")).toBeNull(); // already a PG code, not a modifier
});

test("modifier codes are matched regardless of case or stray spacing", () => {
  expect(finishFromModifier(" fin-4 ")).toBe("PG-4");
  expect(finishFromModifier("Fin-2")).toBe("PG-2");
});

test("finishLevel is a safe lookup — a bad code never throws on a work order", () => {
  expect(finishLevel("PG-4")?.name).toBe("Premium finish");
  expect(finishLevel("pg-2")?.code).toBe("PG-2");
  expect(finishLevel("PG-9")).toBeNull();
  expect(finishLevel(null)).toBeNull();
});

test("every level has its five summary rows and a look-test distance", () => {
  for (const code of FINISH_ORDER) {
    const level = FINISH_LEVELS[code];
    expect(level.rows.map((r) => r.label)).toEqual([
      "Filling", "Sanding", "Gaps (caulking)", "Old problems (old runs, old paint on glass, old brush marks)", "Look test",
    ]);
    expect(level.lookTest).toMatch(/^\d(\.\d)? m$/);
  }
});

test("the levels get stricter as the number rises", () => {
  expect(FINISH_ORDER).toEqual(["PG-2", "PG-3", "PG-4"]);
  expect(FINISH_LEVELS["PG-2"].lookTest).toBe("3 m");
  expect(FINISH_LEVELS["PG-3"].lookTest).toBe("1.5 m");
  expect(FINISH_LEVELS["PG-4"].lookTest).toBe("0.5 m");
});

test("the default level is the ordinary residential repaint", () => {
  expect(DEFAULT_FINISH).toBe("PG-3");
});
