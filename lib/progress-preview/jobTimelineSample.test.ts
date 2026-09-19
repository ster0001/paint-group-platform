/**
 * The never-fork proof for the estimate's live-progress phone (brief v4 rule
 * 1, acceptance 8): the phone renders the SAME JobTimeline the portals use,
 * and its sample path never signs or reads storage. `timeline.shared.test.ts`
 * still pins that both portal routes import that one component.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { signPhotosByIds } = vi.hoisted(() => ({
  signPhotosByIds: vi.fn<() => Promise<Map<string, never>>>(async () => { throw new Error("the sample path must never sign a photo"); }),
}));
vi.mock("@/lib/portal/data", () => ({
  melbourneTodayYmd: () => "2026-09-19",
  signPhotosByIds,
}));

import JobTimeline from "@/app/account/(portal)/JobTimeline";
import { buildProgressPreview, type ProgressPreviewInput } from "./build";
import { SAMPLE_PROJECT, sampleTimeline } from "./timelineItems";

const input: ProgressPreviewInput = {
  contactName: "Ben Guptill",
  jobAddress: "43 Keith Street, Alphington VIC 3078",
  areas: [{ title: "Lounge", photos: ["https://x.test/estimate-media/p1.jpg", "https://x.test/estimate-media/p2.jpg"] }, { title: "Dining", photos: [] }],
  paints: [],
  references: null,
};

describe("JobTimeline in sample mode", () => {
  // A block body on purpose: a hook that RETURNS the mock hands vitest a
  // "cleanup function" it then calls — which looked like a storage call.
  beforeEach(() => { signPhotosByIds.mockClear(); });

  it("renders the five sample updates through the real feed markup, with the estimate's own photo URLs, and touches no storage", async () => {
    const preview = buildProgressPreview(input, "residential")!;
    const sample = sampleTimeline(preview);
    const html = renderToStaticMarkup(await JobTimeline({ project: SAMPLE_PROJECT, companyPhone: "", sample }));

    expect(html.match(/class="tl-item /g)).toHaveLength(5);
    expect(html).toContain("Day 1 · 8:05am");
    expect(html).toContain("Set-up and protection");
    expect(html).toContain('src="https://x.test/estimate-media/p1.jpg"');
    expect(html).toContain("Before · your photo");
    // Feed only: none of the portal page chrome around it.
    expect(html).not.toContain("Day by day");
    expect(html).not.toContain("Who&#x27;s at your home");
    expect(html).not.toContain("CHECKED AND SENT BY THE OFFICE");
    expect(signPhotosByIds).not.toHaveBeenCalled();
  });

  it("the portals' own path still signs through storage exactly as before", async () => {
    signPhotosByIds.mockImplementationOnce(async () => new Map<string, never>());
    const html = renderToStaticMarkup(await JobTimeline({ project: SAMPLE_PROJECT, companyPhone: "" }));
    expect(signPhotosByIds).toHaveBeenCalledTimes(1);
    expect(html).toContain("Day by day");
  });
});
