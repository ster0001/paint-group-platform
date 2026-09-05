import { it, expect } from "vitest";
import { mdToText, parseMd } from "./md";
it("paragraphs, line breaks, bold and links; nothing else", () => {
  const b = parseMd("Hello **world**, see [this](https://x.y/z).\nSecond line\n\nNext para <b>raw</b>");
  expect(b).toHaveLength(2);
  expect(b[0][0]).toEqual([{ t: "text", v: "Hello " }, { t: "b", v: "world" }, { t: "text", v: ", see " }, { t: "a", v: "this", href: "https://x.y/z" }, { t: "text", v: "." }]);
  expect(b[0][1]).toEqual([{ t: "text", v: "Second line" }]);
  expect(b[1][0]).toEqual([{ t: "text", v: "Next para <b>raw</b>" }]);
  expect(mdToText("A **b** [c](/d)\n\nE")).toBe("A b c E");
});
