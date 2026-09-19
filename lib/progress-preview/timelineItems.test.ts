import { describe, expect, it } from "vitest";
import { buildProgressPreview, type ProgressPreviewInput } from "./build";
import { sampleTimeline } from "./timelineItems";

const input: ProgressPreviewInput = {
  contactName: "Ben Guptill",
  jobAddress: "43 Keith Street, Alphington VIC 3078",
  areas: [
    { title: "Lounge", photos: ["https://x.test/p1.jpg", "https://x.test/p2.jpg", "https://x.test/p3.jpg"] },
    { title: "Dining", photos: [] },
  ],
  paints: [],
  references: [{ label: "PO", value: "4471" }],
};

describe("sampleTimeline", () => {
  it("one item per update, headings 'Day N · time', photos mapped by id with the tag as caption", () => {
    const preview = buildProgressPreview(input, "residential")!;
    const t = sampleTimeline(preview);
    expect(t.items).toHaveLength(5);
    expect(t.headings).toEqual(["Day 1 · 8:05am", "Day 2 · 4:40pm", "Day 3 · 4:15pm", "Day 5 · 4:30pm", "Day 7 · 11:20am"]);
    expect(t.items.map((i) => i.title)).toEqual(preview.updates.map((u) => u.title));
    expect(t.items[0].photoIds).toEqual(["pp-1", "pp-2"]);
    expect(t.items[1].photoIds).toEqual(["pp-3"]);
    expect(t.photos.get("pp-1")).toEqual({ id: "pp-1", thumbUrl: "https://x.test/p1.jpg", fullUrl: "https://x.test/p1.jpg", caption: "Before · your photo", area: "" });
    expect([...t.photos.values()].every((p) => p.thumbUrl.startsWith("https://x.test/"))).toBe(true);
  });
  it("sorts and groups like real items; work under way is live (cyan ring), the milestone is done (emerald)", () => {
    const t = sampleTimeline(buildProgressPreview(input, "residential")!);
    for (let i = 1; i < t.items.length; i++) expect(t.items[i].at > t.items[i - 1].at).toBe(true);
    expect(t.items.map((i) => i.live)).toEqual([true, true, true, true, false]);
    expect(t.items[4].chip).toBeNull();
    expect(t.items.every((i) => i.cta === null && i.amountCents === null)).toBe(true);
    expect(t.items.every((i) => !i.key.startsWith("update:"))).toBe(true);
  });
  it("commercial chips join into the one chip the feed supports", () => {
    const t = sampleTimeline(buildProgressPreview(input, "commercial")!);
    expect(t.items[0].chip).toEqual({ cls: "cyan", label: "SWMS on site ✓ · Tenant notice posted ✓" });
    expect(t.photos.get("pp-1")?.caption).toBe("Before · site photo");
  });
});
