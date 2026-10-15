import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blockRows, inductionStrings, parseInduction, MODULE_COUNT } from "./source";

const md = readFileSync(resolve(__dirname, "../../docs/induction/induction-v1.md"), "utf8");

describe("induction source — the committed export parses into 13 modules", () => {
  const file = parseInduction(md);

  it("is Version 1, approved 13 Oct 2026, thirteen modules in order", () => {
    expect(file.version).toBe(1);
    expect(file.approvedOn).toBe("2026-10-13");
    expect(file.modules.map((m) => m.no)).toEqual(Array.from({ length: MODULE_COUNT }, (_, i) => i + 1));
    expect(file.modules.map((m) => m.key)).toEqual(["m01", "m02", "m03", "m04", "m05", "m06", "m07", "m08", "m09", "m10", "m11", "m12", "m13"]);
  });

  it("carries the Read-and-confirm statements the doc prints (counts per module)", () => {
    expect(file.modules.map((m) => m.statements.length)).toEqual([5, 4, 10, 6, 6, 6, 6, 6, 5, 6, 4, 3, 5]);
    expect(file.modules[2].statements[9].text).toMatch(/^If I cannot come or will be late/);
    expect(file.modules[5].statements[3].text).toContain("Red: no more job offers. We meet to go through the level of finish expected on my current job.");
  });

  it("every module has one tick line", () => {
    for (const m of file.modules) expect(m.tick, m.key).toMatch(/\S/);
    expect(file.modules[0].tick).toBe("I have set up my account.");
    expect(file.modules[12].tick).toBe("I will work safely and so will my crew.");
  });

  it("module 5 names the six standards sections instead of its own ticks", () => {
    expect(file.modules[4].standardsSections).toEqual(["levels", "rules", "time", "interior", "exterior", "defect"]);
    for (const m of file.modules) if (m.key !== "m05") expect(m.standardsSections, m.key).toEqual([]);
  });

  it("the worker version is the doc's selection (⚑17)", () => {
    const by = Object.fromEntries(file.modules.map((m) => [m.key, m]));
    expect(by.m01.workerLines).toEqual([]);
    expect(by.m02.workerLines).toEqual([1]);
    expect(by.m02.workerExtra.map((x) => x.text)).toEqual(["My contractor accepts the job, raises variations and invoices. I paint, take photos and tick my surfaces."]);
    expect(by.m03.workerLines).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(by.m04.workerLines).toEqual([1, 2]);
    expect(by.m05.workerLines).toEqual([1, 2, 3, 4, 5, 6]);
    expect(by.m06.workerLines).toEqual([1, 2]);
    expect(by.m07.workerLines).toEqual([1, 2, 5, 6]);
    expect(by.m08.workerLines).toEqual([]);
    expect(by.m08.workerExtra).toHaveLength(1);
    expect(by.m09.workerLines).toEqual([1, 2, 3]);
    expect(by.m10.workerLines).toEqual([3, 4]);
    expect(by.m11.workerLines).toEqual([]);
    expect(by.m12.workerLines).toEqual([]);
    expect(by.m13.workerLines).toEqual([1, 2, 3, 5]);
    expect(by.m13.workerExtra.map((x) => x.text)).toEqual(["I have a white card."]);
  });

  it("the string map has one key per title, statement, tick and worker extra", () => {
    const strings = inductionStrings(file);
    const expected = file.modules.reduce((n, m) => n + 1 + m.statements.length + 1 + m.workerExtra.length, 0);
    expect(Object.keys(strings)).toHaveLength(expected);
    expect(strings["m03.s1"]).toMatch(/^I am a guest/);
    expect(strings["m02.w1"]).toMatch(/^My contractor accepts/);
    for (const v of Object.values(strings)) expect(v).toMatch(/\S/);
  });

  it("block rows mirror the string map and carry the audiences", () => {
    const rows = blockRows(file);
    const strings = inductionStrings(file);
    expect(rows).toHaveLength(Object.keys(strings).length);
    const m11 = rows.filter((r) => r.module_key === "m11");
    expect(m11.every((r) => r.audiences.join() === "contractor")).toBe(true);
    const m07s5 = rows.find((r) => r.module_key === "m07" && r.line_key === "s5")!;
    expect(m07s5.audiences).toEqual(["contractor", "worker"]);
    const m07s3 = rows.find((r) => r.module_key === "m07" && r.line_key === "s3")!;
    expect(m07s3.audiences).toEqual(["contractor"]);
    expect(rows.find((r) => r.module_key === "m13" && r.line_key === "w1")!.audiences).toEqual(["worker"]);
  });

  it("refuses a file that breaks the format, naming the module", () => {
    expect(() => parseInduction(md.replace("### Tick\n\nI have set up my account.", "### Tick\n\n"))).toThrow(/module 1.*Tick/);
    expect(() => parseInduction(md.replace("Lines: 1, 2, 5, 6", "Lines: 1, 2, 5, 9"))).toThrow(/module 7.*line 9/);
    expect(() => parseInduction(md.replace("Version: 1", "Version: x"))).toThrow(/Version/);
  });
});
