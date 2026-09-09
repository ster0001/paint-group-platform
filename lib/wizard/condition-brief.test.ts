import { describe, expect, it } from "vitest";
import { MAX_PHOTO_ASKS, MIN_BRIEF, photoAsk, readConditionBrief } from "./condition-brief";
import { SPOT_TAGS } from "./spots";

const read = (t: string) => readConditionBrief(t);

describe("it notices what needs more than the standard preparation", () => {
  /** Tom's list is the whole vocabulary: peeling, raw MDF, badly damaged, oil. */
  it("hears peeling paint however it is described", () => {
    for (const t of [
      "the paint is peeling in the bathroom",
      "some flaking near the window",
      "paint is bubbling above the shower",
      "the paint is coming off the back door",
      "a bit chipped along the hallway",
    ]) {
      expect(read(t).findings.map((f) => f.tag), t).toContain("flaking");
    }
  });

  it("hears water, mould, cracks, holes, wallpaper, rot and rust", () => {
    expect(read("there's a water mark on the hall ceiling").findings[0].tag).toBe("water");
    expect(read("a bit of mildew in the ensuite").findings[0].tag).toBe("mould");
    expect(read("a few hairline cracks in the lounge").findings[0].tag).toBe("crack");
    expect(read("a couple of holes from the old shelves").findings[0].tag).toBe("hole");
    expect(read("the wallpaper needs to come off first").findings[0].tag).toBe("wallpaper");
    expect(read("one weatherboard is rotten at the bottom").findings[0].tag).toBe("rot");
    expect(read("the gutters are rusty in places").findings[0].tag).toBe("rust");
  });

  /**
   * Written from how a homeowner describes a wall, not how a painter does.
   * Anything needing a trade word is a rule that will never fire.
   */
  it("uses only the tags the room card itself offers", () => {
    const known = new Set(SPOT_TAGS.map((t) => t.key));
    const all = read("peeling, water stain, mould, cracks, holes, wallpaper, rot and rust everywhere");
    for (const f of all.findings) expect(known.has(f.tag), f.tag).toBe(true);
  });

  it("carries the phrase that raised it, so the ask makes sense", () => {
    expect(read("there is mould behind the bath").findings[0].matched.toLowerCase()).toBe("mould");
  });
});

describe("the two cases a photo would not settle", () => {
  /**
   * Raw MDF and oil-based paint are properties of a SURFACE, not damage in a
   * place — a photo of "the raw MDF" is not a photo of a spot. Both mean real
   * extra hours, so they reach the estimator as notes instead.
   */
  it("notes raw MDF and bare timber", () => {
    expect(read("the new skirtings are raw MDF").notes.join(" ")).toMatch(/raw MDF or bare timber/);
    expect(read("bare timber on the new architraves").notes.join(" ")).toMatch(/priming/);
    expect(read("the new skirtings are raw MDF").findings).toEqual([]);
  });

  it("notes oil-based paint", () => {
    expect(read("the trims are oil based at the moment").notes.join(" ")).toMatch(/bonding primer/);
    expect(read("existing enamel on the doors").notes.join(" ")).toMatch(/bonding primer/);
  });
});

describe("when it says nothing", () => {
  it("ignores anything too short to be an answer", () => {
    expect(read("cracks").findings).toEqual([]);
    expect(read("").findings).toEqual([]);
    expect(MIN_BRIEF).toBeGreaterThan(0);
  });

  it("reads a clean description and says so", () => {
    const out = read("Three bedroom house, all in good order, just after a refresh");
    expect(out.findings).toEqual([]);
    expect(out.notes).toEqual([]);
    expect(out.readAndClear).toBe(true);
  });

  it("never invents a defect the words do not contain", () => {
    expect(read("Please paint the whole house inside, colour match throughout").findings).toEqual([]);
  });
});

describe("what we say back", () => {
  /**
   * A customer who wrote three sentences and gets six photo requests has been
   * punished for being helpful — the fastest way to teach them to write
   * nothing next time.
   */
  it("asks for at most two photos, however much they wrote", () => {
    const out = read("peeling paint, water stains, mould, cracks, holes and the wallpaper is coming off");
    expect(out.findings.length).toBeGreaterThan(MAX_PHOTO_ASKS);
    // Count what is actually ASKED FOR, not every "and" in the sentence.
    const asked = photoAsk(out).match(/photo of (.+?)\?/)![1];
    expect(asked.split(" and ")).toHaveLength(MAX_PHOTO_ASKS);
    // …and the ones it names are the first two, not a random pair.
    expect(asked).toContain(out.findings[0].label);
    expect(asked).toContain(out.findings[1].label);
  });

  it("asks, and says what a photo buys them", () => {
    const ask = photoAsk(read("the paint is peeling in the laundry"));
    expect(ask).toMatch(/Could you add a photo of the flaking paint\?/);
    expect(ask).toMatch(/we can price the repair now/);
    expect(ask).toMatch(/without one we'll still note it/);
  });

  it("says nothing at all when there is nothing to photograph", () => {
    expect(photoAsk(read("all in good order, just a refresh"))).toBe("");
  });

  it("never repeats a tag, however many rooms mention it", () => {
    const out = read("cracks in the lounge, cracks in the hall and more cracks in bed 2");
    expect(out.findings.filter((f) => f.tag === "crack")).toHaveLength(1);
  });
});
