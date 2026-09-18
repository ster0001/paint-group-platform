import { test } from "vitest";
import assert from "node:assert/strict";
import { allColoursChosen, isSwmsCard, presentationHasSwmsCard, type SnapshotPaint } from "./snapshot";

const paint = (over: Partial<SnapshotPaint>): SnapshotPaint => ({
  name: "Expressions", brand: "Haymes", category: "Interior walls", role: "Walls", finish: "Matt",
  colourName: "", colourHex: "", blurb: "", properties: [], guarantee: "", photoUrl: "",
  customerVisible: true, isPrep: false, usage: [], colours: [], ...over,
});

test("allColoursChosen (Tom, 18 Sep): every topcoat decided = true; one TBC, or no topcoats, = false", () => {
  assert.equal(allColoursChosen({ paints: [paint({ colourName: "Natural White" }), paint({ name: "Ultra Trim", colourName: "Lexicon" })] }), true);
  assert.equal(allColoursChosen({ paints: [paint({ colourName: "Natural White" }), paint({ name: "Ultra Trim", colourName: "" })] }), false);
  // A colour match with no name is a decision.
  assert.equal(allColoursChosen({ paints: [paint({ colours: [{ name: "", hex: "", match: true, areas: ["Hall"] }] })] }), true);
  // Every colour on a multi-colour product must be named.
  assert.equal(allColoursChosen({ paints: [paint({ colourName: "Natural White", colours: [{ name: "Natural White", hex: "#eee", match: false, areas: ["Hall"] }, { name: "", hex: "", match: false, areas: ["Study"] }] })] }), false);
  // Prep and primers never carry a colour and never block it; but they alone are not "all colours entered".
  assert.equal(allColoursChosen({ paints: [paint({ colourName: "Natural White" }), paint({ name: "Sealer", isPrep: true })] }), true);
  assert.equal(allColoursChosen({ paints: [paint({ name: "Sealer", isPrep: true })] }), false);
  assert.equal(allColoursChosen({ paints: [] }), false);
});

test("presentationHasSwmsCard: a capability card headed or labelled SWMS claims the download", () => {
  const pres = (cards: { heading: string; attachment?: { label: string; doc_path: string } }[]) =>
    ({ presentation: { blocks: [{ kind: "capability_panel", content: { title: "", cards } }] } });
  assert.equal(presentationHasSwmsCard(pres([{ heading: "$20M public liability", attachment: { label: "Certificate of currency ↓", doc_path: "x.pdf" } }, { heading: "SWMS & site inductions", attachment: { label: "Sample SWMS ↓", doc_path: "" } }])), true);
  assert.equal(presentationHasSwmsCard(pres([{ heading: "Safety", attachment: { label: "Sample SWMS ↓", doc_path: "" } }])), true, "the label alone is enough");
  assert.equal(presentationHasSwmsCard(pres([{ heading: "$20M public liability" }])), false);
  assert.equal(presentationHasSwmsCard({ presentation: null }), false);
  assert.equal(presentationHasSwmsCard({ presentation: { blocks: [{ kind: "video", content: {} }] } }), false);
  assert.equal(isSwmsCard({ heading: "Swmsish" }), false, "whole word only");
});
