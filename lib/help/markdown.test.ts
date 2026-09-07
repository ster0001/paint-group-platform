import { describe, expect, it } from "vitest";
import { helpToText, parseHelp, stripFrontMatter } from "./markdown";

const SAMPLE = `---
feature: scheduling
role: contractor
title: T
summary: S
---

## What this is for
One short paragraph with **bold** and a [link](../self-invoicing/contractor.md).

## Steps
1. Tap **Accept — lock it in**.
   ![](media/contractor-01.png)
2. Second step
   continues here.
   ![](media/contractor-02.png)

- Amber — waiting.
- Cyan — done.

![](media/contractor-walkthrough.gif)
`;

describe("help markdown", () => {
  it("strips the front-matter", () => {
    expect(stripFrontMatter(SAMPLE).startsWith("\n## What this is for")).toBe(true);
  });

  it("parses headings, paragraphs with inline bold/links, numbered steps with their screenshots, bullets and images", () => {
    const blocks = parseHelp(SAMPLE);
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "h", "list", "list", "img"]);
    const para = blocks[1];
    if (para.t !== "p") throw new Error("expected paragraph");
    expect(para.lines[0].some((i) => i.t === "b" && i.v === "bold")).toBe(true);
    expect(para.lines[0].some((i) => i.t === "a" && i.href === "../self-invoicing/contractor.md")).toBe(true);
    const steps = blocks[3];
    if (steps.t !== "list") throw new Error("expected list");
    expect(steps.ordered).toBe(true);
    expect(steps.items).toHaveLength(2);
    expect(steps.items[0].images).toEqual([{ src: "media/contractor-01.png", alt: "" }]);
    expect(steps.items[1].lines).toHaveLength(2);
    const bullets = blocks[4];
    if (bullets.t !== "list") throw new Error("expected list");
    expect(bullets.ordered).toBe(false);
    expect(bullets.items).toHaveLength(2);
    expect(blocks[5]).toEqual({ t: "img", src: "media/contractor-walkthrough.gif", alt: "" });
  });

  it("flattens to searchable text", () => {
    const text = helpToText(parseHelp(SAMPLE));
    expect(text).toContain("Tap Accept — lock it in.");
    expect(text).toContain("What this is for");
  });
});
