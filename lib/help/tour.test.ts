import { describe, expect, it } from "vitest";
import { parseTour, tourProblems } from "./tour";

const SAMPLE = `---
feature: _tours
role: contractor
title: Show me around
summary: S
---

## Welcome
target: /portal
First line.
Second line.

## Requests
target: /portal/requests
Offers land here.
`;

describe("tour markdown", () => {
  it("parses cards with a target and a joined body", () => {
    const cards = parseTour(SAMPLE);
    expect(cards).toEqual([
      { title: "Welcome", target: "/portal", body: "First line. Second line." },
      { title: "Requests", target: "/portal/requests", body: "Offers land here." },
    ]);
    expect(tourProblems(cards)).toEqual([]);
  });

  it("names what is wrong", () => {
    expect(tourProblems([])).toHaveLength(1);
    expect(tourProblems([{ title: "X", target: "portal", body: "" }])).toEqual([
      'card 1 "X": target must be a route starting with /',
      'card 1 "X": no body text',
    ]);
  });
});
