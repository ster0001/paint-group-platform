import { describe, expect, it } from "vitest";
import { areaGroups, buildProgressPreview, firstNameOf, messagingSetFor, splitAddress, type ProgressPreviewInput } from "./build";
import { COMMERCIAL_BANNED_WORDS, EXAMPLE_LABEL, ILLUSTRATION_LINE, PHOTO_TAG, templateStrings } from "./templates";

// A stand-in for the 43 Keith Street estimate (brief acceptance 1). Sample
// data only — no real customer data lives in this repo.
const ben = (): ProgressPreviewInput => ({
  contactName: "Ben Guptill",
  jobAddress: "43 Keith Street, Alphington VIC 3078",
  areas: [
    { title: "Lounge", photos: ["https://x.test/estimate-media/p1.jpg", "https://x.test/estimate-media/p2.jpg"] },
    { title: "Dining", photos: ["https://x.test/estimate-media/p3.jpg"] },
    { title: "Bed 1", photos: [] },
    { title: "Bed 2", photos: ["https://x.test/estimate-media/p4.jpg"] },
    { title: "Bed 3", photos: [] },
    { title: "Hallway", photos: [] },
    { title: "Study", photos: [] },
    { title: "Kitchen", photos: [] },
  ],
  paints: [
    { name: "Expressions Ceiling", brand: "Haymes", category: "Interior ceilings", role: "Ceilings", isPrep: false },
    { name: "Wash & Wear", brand: "Dulux", category: "Interior walls", role: "Walls", isPrep: false },
    { name: "Ultra Prep", brand: "Haymes", category: "Prep & primers", role: "Primer", isPrep: true },
  ],
  references: null,
});

const PAINTER = { name: "Jacob", photoUrl: "https://x.test/estimate-media/jacob.jpg" };

/** Every string the phone shows, flattened. */
function allStrings(p: NonNullable<ReturnType<typeof buildProgressPreview>>): string[] {
  return [
    p.label, p.line, p.lead.role, p.lead.name ?? "", p.header.address, p.header.sub, p.header.brandRight,
    ...(p.header.rail ?? []), ...(p.header.docs ?? []), p.texts.first, p.texts.last, p.link, p.summary,
    ...p.updates.flatMap((u) => [u.day, u.time, u.title, u.body, ...u.chips, ...u.photos.map((ph) => ph.tag)]),
  ];
}

describe("messagingSetFor (brief §4, F5)", () => {
  it("trade account → commercial", () => expect(messagingSetFor("trade")).toBe("commercial"));
  it("residential account → residential", () => expect(messagingSetFor("residential")).toBe("residential"));
  it("no account → residential", () => {
    expect(messagingSetFor(null)).toBe("residential");
    expect(messagingSetFor(undefined)).toBe("residential");
  });
});

describe("splitAddress / firstNameOf", () => {
  it("splits a Places address into street and suburb", () => {
    expect(splitAddress("43 Keith Street, Alphington VIC 3078")).toEqual({ street: "43 Keith Street", suburb: "Alphington" });
    expect(splitAddress("1 Smith St, Coburg VIC 3058")).toEqual({ street: "1 Smith St", suburb: "Coburg" });
  });
  it("keeps a comma-less address as the street line", () => {
    expect(splitAddress("116 Coppin Street Richmond VIC 3121")).toEqual({ street: "116 Coppin Street Richmond", suburb: "" });
  });
  it("a bare suburb is not a street", () => {
    expect(splitAddress("Alphington")).toEqual({ street: "", suburb: "Alphington" });
    expect(splitAddress("")).toEqual({ street: "", suburb: "" });
  });
  it("first name is the first token", () => {
    expect(firstNameOf("Ben Guptill")).toBe("Ben");
    expect(firstNameOf("  Mary-Anne  O'Neil ")).toBe("Mary-Anne");
    expect(firstNameOf("")).toBe("");
  });
});

describe("areaGroups (brief §5 fewer than 3 areas)", () => {
  it("never repeats an area within one group", () => {
    const g = areaGroups(["Lounge", "Dining"]);
    for (const grp of [g.a, g.b, g.c]) expect(new Set(grp).size).toBe(grp.length);
    expect(g.a).toEqual(["Lounge", "Dining"]);
  });
  it("one area is used once per group", () => {
    const g = areaGroups(["Studio"]);
    expect(g).toEqual({ a: ["Studio"], b: ["Studio"], c: ["Studio"], single: "Studio" });
  });
  it("no areas → empty groups", () => {
    expect(areaGroups([])).toEqual({ a: [], b: [], c: [], single: "" });
  });
  it("strips the Exterior prefix for display", () => {
    expect(areaGroups(["Exterior - Front", "Exterior - Rear"]).a).toEqual(["Front", "Rear"]);
  });
});

describe("buildProgressPreview — the example estimate (acceptance 1)", () => {
  const p = buildProgressPreview(ben(), "residential", PAINTER)!;

  it("both texts and the header carry the first name and street address", () => {
    expect(p.texts.first).toBe("Good morning Ben. Jacob and the team have arrived at 43 Keith Street. Follow today's progress: paintgroup.com.au/j/43-keith-street");
    expect(p.texts.last).toBe("Ben, 43 Keith Street is finished. Your walkthrough with Jacob is at 2pm today.");
    expect(p.header.address).toBe("43 Keith Street");
    expect(p.header.sub).toBe("Alphington · for Ben Guptill");
  });
  it("updates name real rooms from the estimate, in order", () => {
    expect(p.updates[0].body).toBe("Floors covered, furniture moved to the centre of each room and wrapped. Filling and sanding under way in the Lounge and Dining.");
    expect(p.updates[1].body).toBe("Cracks filled and sanded in the Bed 1, Bed 2 and Bed 3.");
    expect(p.updates[2].body).toBe("Two coats of Haymes Expressions Ceiling in the Lounge and Dining.");
    expect(p.updates[3].body).toBe("Dulux Wash & Wear going on in the Hallway, Study and Kitchen, in the colours you chose at your consultation.");
    expect(p.updates[4].body).toBe("2pm today with Jacob. You'll walk every room together, and anything you spot is put right before the final invoice.");
  });
  it("at least two of the customer's own photos appear, tagged as theirs", () => {
    const photos = p.updates.flatMap((u) => u.photos);
    expect(photos.length).toBeGreaterThanOrEqual(2);
    for (const ph of photos) expect(ph.tag).toBe(PHOTO_TAG.residential);
  });
  it("label and line are present and exactly the ruled wording", () => {
    expect(p.label).toBe(EXAMPLE_LABEL);
    expect(p.line).toBe(ILLUSTRATION_LINE.residential);
  });
  it("leaves no placeholder unfilled", () => {
    for (const s of allStrings(p)) expect(s).not.toMatch(/\{[a-z_]+\}/);
  });
  it("is pure: same input, same output, input untouched", () => {
    const a = ben();
    const frozen = JSON.stringify(a);
    const one = buildProgressPreview(a, "residential", PAINTER);
    const two = buildProgressPreview(a, "residential", PAINTER);
    expect(one).toEqual(two);
    expect(JSON.stringify(a)).toBe(frozen);
  });
});

describe("photos (F2 / F13)", () => {
  it("snapshot order, at most two per update, never the same photo twice", () => {
    const p = buildProgressPreview(ben(), "residential")!;
    const urls = p.updates.flatMap((u) => u.photos.map((ph) => ph.url));
    expect(urls).toEqual(["https://x.test/estimate-media/p1.jpg", "https://x.test/estimate-media/p2.jpg", "https://x.test/estimate-media/p3.jpg", "https://x.test/estimate-media/p4.jpg"]);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of p.updates) expect(u.photos.length).toBeLessThanOrEqual(2);
    expect(p.photosUsed).toBe(4);
  });
  it("fewer photos than slots: later updates simply have none", () => {
    const input = ben();
    input.areas = input.areas.map((a, i) => ({ ...a, photos: i === 0 ? ["https://x.test/only.jpg"] : [] }));
    const p = buildProgressPreview(input, "residential")!;
    expect(p.updates[0].photos.map((ph) => ph.url)).toEqual(["https://x.test/only.jpg"]);
    expect(p.updates.slice(1).every((u) => u.photos.length === 0)).toBe(true);
  });
  it("zero photos: the phone still plays, text only", () => {
    const input = ben();
    input.areas = input.areas.map((a) => ({ ...a, photos: [] }));
    const p = buildProgressPreview(input, "residential")!;
    expect(p).not.toBeNull();
    expect(p.updates.every((u) => u.photos.length === 0)).toBe(true);
    expect(p.photosUsed).toBe(0);
  });
  it("a duplicate URL in the snapshot is placed once", () => {
    const input = ben();
    input.areas = [{ title: "Lounge", photos: ["https://x.test/a.jpg", "https://x.test/a.jpg", "https://x.test/b.jpg"] }];
    const urls = buildProgressPreview(input, "residential")!.updates.flatMap((u) => u.photos.map((ph) => ph.url));
    expect(urls).toEqual(["https://x.test/a.jpg", "https://x.test/b.jpg"]);
  });
  it("commercial photos carry the site-photo tag", () => {
    const p = buildProgressPreview(ben(), "commercial")!;
    for (const ph of p.updates.flatMap((u) => u.photos)) expect(ph.tag).toBe(PHOTO_TAG.commercial);
  });
});

describe("fallbacks (brief §5)", () => {
  it("no first name: texts open 'Good morning.' with no name; header has no 'for'", () => {
    const p = buildProgressPreview({ ...ben(), contactName: "" }, "residential", PAINTER)!;
    expect(p.texts.first.startsWith("Good morning. Jacob and the team")).toBe(true);
    expect(p.texts.last).toBe("43 Keith Street is finished. Your walkthrough with Jacob is at 2pm today.");
    expect(p.header.sub).toBe("Alphington");
  });
  it("no street address: 'your property' in copy, suburb alone in the header", () => {
    const p = buildProgressPreview({ ...ben(), jobAddress: "Alphington" }, "residential", PAINTER)!;
    expect(p.texts.first).toContain("arrived at your property.");
    expect(p.header.address).toBe("Alphington");
    expect(p.link).toBe("paintgroup.com.au/j/your-property");
  });
  it("neither street nor suburb: the section does not render", () => {
    expect(buildProgressPreview({ ...ben(), jobAddress: "" }, "residential")).toBeNull();
    expect(buildProgressPreview({ ...ben(), jobAddress: "   " }, "commercial")).toBeNull();
  });
  it("fewer than 3 areas: no area repeated within one update, sentence still reads", () => {
    const input = ben();
    input.areas = [{ title: "Lounge", photos: [] }, { title: "Dining", photos: [] }];
    const p = buildProgressPreview(input, "residential")!;
    expect(p.updates[1].body).toBe("Cracks filled and sanded in the Lounge and Dining.");
    expect(p.updates[3].body).toBe("Dulux Wash & Wear going on in the Lounge and Dining, in the colours you chose at your consultation.");
  });
  it("no areas at all: the area clause drops cleanly", () => {
    const p = buildProgressPreview({ ...ben(), areas: [] }, "residential")!;
    expect(p.updates[0].body).toBe("Floors covered, furniture moved to the centre of each room and wrapped. Filling and sanding under way.");
    expect(p.updates[1].body).toBe("Cracks filled and sanded.");
    expect(p.updates[2].body).toBe("Two coats of Haymes Expressions Ceiling.");
  });
  it("no matching product: generic wording, no placeholder", () => {
    const p = buildProgressPreview({ ...ben(), paints: [] }, "residential")!;
    expect(p.updates[2].body).toBe("Two coats of ceiling paint in the Lounge and Dining.");
    expect(p.updates[3].body.startsWith("wall paint going on")).toBe(true);
  });
  it("exterior job: exterior templates with elevation names", () => {
    const input = ben();
    input.areas = [{ title: "Exterior - Front", photos: [] }, { title: "Exterior - Rear", photos: [] }, { title: "Exterior - Left", photos: [] }];
    input.paints = [{ name: "Weathershield", brand: "Dulux", category: "Exterior walls", role: "Walls", isPrep: false }];
    const p = buildProgressPreview(input, "residential", PAINTER)!;
    expect(p.updates[0].title).toBe("Wash-down and protection");
    expect(p.updates[0].body).toBe("Gardens, paths and windows covered. Wash-down under way on the Front and Rear.");
    expect(p.updates[2].title).toBe("Priming");
    expect(p.updates[3].body).toBe("Dulux Weathershield going on to the Front, Rear and Left, in the colours you chose at your consultation.");
    expect(p.updates[4].body).toContain("walk around the whole property");
  });
  it("interior plus exterior: interior templates with one update mentioning the exterior", () => {
    const input = ben();
    input.areas = [{ title: "Lounge", photos: [] }, { title: "Exterior - Front", photos: [] }, { title: "Dining", photos: [] }];
    const p = buildProgressPreview(input, "residential")!;
    expect(p.updates[0].title).toBe("Set-up and protection");
    expect(p.updates[0].body).toContain("in the Lounge and Dining.");
    const mentions = p.updates.filter((u) => /Outside, the Front washed down/.test(u.body));
    expect(mentions).toHaveLength(1);
  });
  it("long names and addresses are carried whole (the renderer ellipsises)", () => {
    const addr = "1234 Verylongstreetnameavenue Boulevard Crescent Parade, Upper Ferntree Gully VIC 3156";
    expect(addr.length).toBeGreaterThanOrEqual(60);
    const p = buildProgressPreview({ ...ben(), jobAddress: addr, contactName: "Bartholomew-Alexander Fitzgerald-Montgomery" }, "residential")!;
    expect(p.header.address).toBe("1234 Verylongstreetnameavenue Boulevard Crescent Parade");
    expect(p.header.sub).toBe("Upper Ferntree Gully · for Bartholomew-Alexander Fitzgerald-Montgomery");
    expect(p.texts.first).toContain("Good morning Bartholomew-Alexander.");
  });
});

describe("escaping (rule 7, acceptance 7)", () => {
  it("markup in a name or address is carried as literal text, never interpreted", () => {
    const nasty = `<script>alert("x")</script> O'Brien`;
    const p = buildProgressPreview({ ...ben(), contactName: nasty, jobAddress: `12 <b>Bold</b> St, "Quoted" Suburb VIC 3000` }, "residential", PAINTER)!;
    expect(p.texts.first).toContain(`Good morning <script>alert("x")</script>.`);
    expect(p.header.address).toBe("12 <b>Bold</b> St");
    expect(p.header.sub).toContain(`"Quoted" Suburb`);
    // No entity-encoding either: the builder returns plain text, the renderer's text nodes do the rest.
    for (const s of allStrings(p)) expect(s).not.toMatch(/&(lt|gt|quot|amp);/);
  });
});

describe("demo painter (F1, acceptance 6d)", () => {
  it("set in Settings with a photo: name and photo show, role as ruled", () => {
    const res = buildProgressPreview(ben(), "residential", PAINTER)!;
    expect(res.lead).toEqual({ name: "Jacob", role: "Your lead painter", initial: "J", photoUrl: PAINTER.photoUrl });
    const com = buildProgressPreview(ben(), "commercial", PAINTER)!;
    expect(com.lead.role).toBe("Site supervisor");
    expect(com.texts.first).toContain("Jacob is your site supervisor.");
  });
  it("unset: generic fallback, 'the team have arrived', no name anywhere", () => {
    const p = buildProgressPreview(ben(), "residential", null)!;
    expect(p.lead).toEqual({ name: null, role: "Your lead painter", initial: "Y", photoUrl: null });
    expect(p.texts.first).toBe("Good morning Ben. The team have arrived at 43 Keith Street. Follow today's progress: paintgroup.com.au/j/43-keith-street");
    expect(p.texts.last).toBe("Ben, 43 Keith Street is finished. Your walkthrough is at 2pm today.");
    expect(p.updates[4].body).toBe("2pm today. You'll walk every room with your lead painter, and anything you spot is put right before the final invoice.");
    expect(allStrings(p).some((s) => s.includes("Jacob"))).toBe(false);
  });
  it("set but without a photo: treated as unset", () => {
    const p = buildProgressPreview(ben(), "residential", { name: "Jacob", photoUrl: "" })!;
    expect(p.lead.name).toBeNull();
  });
});

describe("commercial set (brief §6b)", () => {
  const trade = (): ProgressPreviewInput => ({
    ...ben(),
    contactName: "Priya Nair",
    organisationName: "Sample Property Group",
    jobAddress: "210 High Street, Northcote VIC 3070",
    areas: [
      { title: "Reception", photos: ["https://x.test/s1.jpg"] }, { title: "Lift lobby", photos: [] }, { title: "Corridors", photos: [] },
      { title: "Stairwell", photos: [] }, { title: "Open-plan office", photos: [] }, { title: "Boardroom", photos: [] }, { title: "Meeting rooms", photos: [] },
    ],
    references: [{ label: "PO", value: "4471" }, { label: "Owner", value: "KS-43" }],
  });

  it("PO and owner reference show only when on the estimate", () => {
    const p = buildProgressPreview(trade(), "commercial", PAINTER)!;
    expect(p.texts.first).toBe("210 High Street (PO 4471): Paint Group signed in on site at 6:30am. Jacob is your site supervisor. Live progress: paintgroup.com.au/j/210-high-street");
    expect(p.texts.last).toBe("210 High Street (PO 4471): works complete and site cleared. Handover walkthrough at 2pm. Completion report to follow.");
    expect(p.header.sub).toBe("Northcote · PO 4471 · Owner ref KS-43");
    expect(p.header.brandRight).toBe("Sample Property Group");
    expect(p.header.rail).toEqual(["Pre-start", "In progress", "Quality check", "Walkthrough", "Closed"]);
    expect(p.header.docs).toEqual(["Certificate of currency", "SWMS", "Daily reports"]);
  });
  it("trade with no PO or owner reference: no reference anywhere (acceptance 9)", () => {
    const p = buildProgressPreview({ ...trade(), references: null }, "commercial", PAINTER)!;
    expect(p.texts.first.startsWith("210 High Street: Paint Group signed in")).toBe(true);
    expect(p.header.sub).toBe("Northcote");
    for (const s of allStrings(p)) {
      expect(s).not.toMatch(/\bPO\b/);
      expect(s).not.toMatch(/owner ref/i);
      expect(s).not.toContain("4471");
    }
  });
  it("areas flow through the commercial updates, stages set for the rail", () => {
    const p = buildProgressPreview(trade(), "commercial")!;
    expect(p.updates[0].body).toContain("protected in Reception and Lift lobby.");
    expect(p.updates[1].body.startsWith("Corridors, Stairwell and Open-plan office patched")).toBe(true);
    expect(p.updates[2].title).toBe("After-hours works, Reception");
    expect(p.updates[3].title).toBe("Boardroom, Meeting rooms and Reception");
    expect(p.updates.map((u) => u.stage)).toEqual([1, 1, 1, 2, 3]);
    expect(p.updates[0].chips).toEqual(["SWMS on site ✓", "Tenant notice posted ✓"]);
    expect(p.updates[2].chips).toEqual(["Out of hours ✓", "On programme ✓", "Variations 0"]);
  });
  it("no organisation: header falls back to the contact name / 'Your job'", () => {
    const p = buildProgressPreview({ ...trade(), organisationName: null }, "commercial")!;
    expect(p.header.brandRight).toBe("Your job");
  });
  it("residential stages are null and the rail absent", () => {
    const p = buildProgressPreview(ben(), "residential")!;
    expect(p.header.rail).toBeNull();
    expect(p.updates.every((u) => u.stage === null)).toBe(true);
  });
});

describe("templates (acceptance 13b)", () => {
  it("the commercial template wording contains no residential room words", () => {
    const re = new RegExp(`\\b(${COMMERCIAL_BANNED_WORDS.join("|")})\\b`, "i");
    for (const s of templateStrings("commercial")) expect(s, s).not.toMatch(re);
  });
  it("every template placeholder is one the builder fills", () => {
    const known = new Set(["first_name", "street_address", "lead", "areas_a", "areas_b", "areas_c", "area", "exterior_areas", "ceiling_product", "wall_product", "po", "link"]);
    for (const set of ["residential", "commercial"] as const) {
      for (const s of templateStrings(set)) {
        for (const m of s.matchAll(/\{([a-z_]+)\}/g)) expect(known.has(m[1]), `${set}: {${m[1]}}`).toBe(true);
      }
    }
  });
  it("label and illustration lines are the ruled wording", () => {
    expect(EXAMPLE_LABEL).toBe("Example of your live updates");
    expect(ILLUSTRATION_LINE.residential.startsWith("For illustration only.")).toBe(true);
    expect(ILLUSTRATION_LINE.commercial.startsWith("For illustration only.")).toBe(true);
    expect(ILLUSTRATION_LINE.commercial).toContain("programme");
  });
});

describe("accessible summary", () => {
  it("narrates label, both texts, every update and the illustration line", () => {
    const p = buildProgressPreview(ben(), "residential", PAINTER)!;
    expect(p.summary.startsWith("Example of your live updates.")).toBe(true);
    expect(p.summary).toContain(p.texts.first);
    expect(p.summary).toContain(p.texts.last);
    for (const u of p.updates) expect(p.summary).toContain(`${u.day}, ${u.time}: ${u.title}.`);
    expect(p.summary.endsWith(ILLUSTRATION_LINE.residential)).toBe(true);
  });
});
