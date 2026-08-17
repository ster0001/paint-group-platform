/**
 * The finish-level mapping. This decides what prep a contractor is contractually
 * held to on site, so the FIN-1 case below is a business rule, not a default.
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
  // The rate card calls FIN-4 "Premium" while the spec calls PG-3 "Premium".
  // The numbers are what map; the words clash at different rungs.
  expect(finishFromModifier("FIN-2")).toBe("PG-2");
  expect(finishFromModifier("FIN-3")).toBe("PG-3");
  expect(finishFromModifier("FIN-4")).toBe("PG-4");
  expect(FINISH_LEVELS["PG-3"].name).toBe("Premium");
  expect(FINISH_LEVELS["PG-4"].name).toBe("Showcase");
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
  expect(finishLevel("PG-4")?.name).toBe("Showcase");
  expect(finishLevel("pg-2")?.code).toBe("PG-2");
  expect(finishLevel("PG-9")).toBeNull();
  expect(finishLevel(null)).toBeNull();
});

test("every level states both what to do and how it will be judged", () => {
  // A level with no acceptance test is unenforceable at walkthrough, which is
  // the whole point of the standard.
  for (const code of FINISH_ORDER) {
    const level = FINISH_LEVELS[code];
    expect(level.prep.length).toBeGreaterThan(0);
    expect(level.acceptance.length).toBeGreaterThan(0);
    expect(level.summary.trim()).not.toBe("");
  }
});

test("the levels get stricter as the number rises", () => {
  expect(FINISH_ORDER).toEqual(["PG-2", "PG-3", "PG-4"]);
  // The viewing distance in the acceptance test tightens with the level.
  expect(FINISH_LEVELS["PG-3"].acceptance.join(" ")).toContain("1.5 m");
  expect(FINISH_LEVELS["PG-4"].acceptance.join(" ")).toContain("0.5 m");
});

test("the default level is the ordinary residential repaint", () => {
  expect(DEFAULT_FINISH).toBe("PG-3");
});
