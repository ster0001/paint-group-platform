import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("import csv reader", () => {
  it("reads quoted JSON payloads with commas, quotes and newlines", () => {
    const text = 'event_key,payload\r\nk1,"{""text"": ""rang, left v/m"", ""n"": 1}"\r\nk2,"line one\nline two"\r\n';
    expect(parseCsv(text)).toEqual([
      { event_key: "k1", payload: '{"text": "rang, left v/m", "n": 1}' },
      { event_key: "k2", payload: "line one\nline two" },
    ]);
  });
  it("tolerates a BOM, LF endings, no trailing newline and blank lines", () => {
    expect(parseCsv("﻿a,b\n1,2\n\n3,")).toEqual([{ a: "1", b: "2" }, { a: "3", b: "" }]);
  });
  it("refuses a ragged row", () => {
    expect(() => parseCsv("a,b\n1,2,3\n")).toThrow(/3 fields/);
    expect(() => parseCsv('a\n"open')).toThrow(/unterminated/);
  });
});
