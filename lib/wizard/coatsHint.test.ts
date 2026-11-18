import { describe, expect, it } from "vitest";
import { DEFAULT_PAINT_SYSTEMS, deriveSystem, topcoatsOf } from "@/lib/pricing/systems";
import { boldCoats, coatsPhrase, exteriorColourCoats, interiorColourCoats } from "./coatsHint";

describe("the coats said beside the colours question (Tom, 19 Nov 2026)", () => {
  it("reads the shipped paint-systems table — the walls' row inside, the exterior row outside", () => {
    expect(interiorColourCoats("same")).toBe("One coat — a freshen up");
    expect(interiorColourCoats("new")).toBe("Two coats on what's changing");
    expect(interiorColourCoats("deciding")).toBe("Priced as new colours — two coats");
    expect(boldCoats(true)).toBe("An undercoat and two coats under the new colour");
    expect(boldCoats(false)).toBe("Two coats — a similar depth of colour");
    expect(exteriorColourCoats("same")).toBe("One full coat — colour-matched");
    expect(exteriorColourCoats("new")).toBe("Two full coats, standard preparation");
    expect(exteriorColourCoats("bold")).toBe("Two full coats — a third if the colour needs it, agreed before we start");
  });
  it("says the number the engine derives for that answer (topcoats, the undercoat named)", () => {
    // the tick earns the bold coat (Tom, 10 Sep): a bold walls answer reaches the engine as the walls' dark-to-light tick
    const walls = (intent: "same" | "new" | "bold") => deriveSystem("walls", { colourIntent: intent === "bold" ? "new" : intent, condition: "wear", darkToLight: intent === "bold" });
    const exterior = (intent: "same" | "new" | "bold") => deriveSystem("exterior", { colourIntent: intent === "bold" ? "new" : intent, condition: "wear", darkToLight: intent === "bold" });
    const n = (s: string) => ({ one: 1, two: 2, three: 3 }[s.match(/\b(one|two|three)\b/i)![1].toLowerCase()]);
    expect(n(interiorColourCoats("same"))).toBe(topcoatsOf(walls("same").coats, walls("same").undercoat));
    expect(n(interiorColourCoats("new"))).toBe(topcoatsOf(walls("new").coats, walls("new").undercoat));
    expect(n(boldCoats(true))).toBe(topcoatsOf(walls("bold").coats, walls("bold").undercoat));
    expect(/undercoat/.test(boldCoats(true))).toBe(walls("bold").undercoat);
    for (const k of ["same", "new", "bold"] as const) expect(n(exteriorColourCoats(k))).toBe(topcoatsOf(exterior(k).coats, exterior(k).undercoat));
  });
  it("follows a changed table", () => {
    const systems = { ...DEFAULT_PAINT_SYSTEMS, walls: { ...DEFAULT_PAINT_SYSTEMS.walls, new: { coats: 3, undercoat: true, sentence: "x" } } };
    expect(interiorColourCoats("new", systems)).toBe("An undercoat and two coats on what's changing");
    expect(coatsPhrase({ coats: 1, undercoat: false })).toBe("one coat");
    expect(coatsPhrase({ coats: 4, undercoat: true })).toBe("an undercoat and three coats");
  });
});
