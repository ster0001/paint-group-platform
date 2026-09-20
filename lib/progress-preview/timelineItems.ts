/**
 * Turns a ProgressPreview into what the shared portal timeline renders:
 * `TimelineItem`s for JobTimeline's `sample` prop, the "Day N · time" headings
 * and the photo map (public URLs straight from the snapshot — nothing is
 * signed, nothing is read from storage). Pure.
 *
 * One chip per item is what the real timeline supports, so an update's chips
 * are joined into one label ("SWMS on site ✓ · Tenant notice posted ✓").
 */
import type { TimelineItem } from "@/lib/portal/timeline";
import type { PortalProject } from "@/lib/portal/data";
import type { GridPhoto } from "@/app/account/(portal)/project/PhotoGrid";
import type { SampleTimeline } from "@/app/account/(portal)/JobTimeline";
import type { ProgressPreview } from "./build";

export type { SampleTimeline };

/** The synthetic project JobTimeline is handed in sample mode: no dates, no
 *  painter, no report, no rows — nothing for it to sign or fetch. */
export const SAMPLE_PROJECT: PortalProject = {
  estimateId: "sample",
  title: "",
  stage: "in_progress",
  startDate: null,
  endDate: null,
  painterFirstName: null,
  reportToken: null,
  timeline: {
    surfaces: [], updates: [], photos: [], variations: [],
    underwayAt: null, readyAt: null, qaPassedAt: null, walkthroughFor: null, signedAt: null,
    depositPaidOn: null, depositCents: null,
  },
  photoRows: [],
};

/** A fixed, obviously-synthetic calendar so `at`/`dayYmd` sort and group like real ones. */
const SAMPLE_DAY_YMD = (n: number) => `2000-01-${String(n).padStart(2, "0")}`;

export function sampleTimeline(preview: ProgressPreview): SampleTimeline {
  const photos = new Map<string, GridPhoto>();
  const items: TimelineItem[] = [];
  const headings: string[] = [];
  let photoN = 0;

  preview.updates.forEach((u, i) => {
    const dayNumber = Number(u.day.replace(/\D/g, "")) || i + 1;
    const dayYmd = SAMPLE_DAY_YMD(dayNumber);
    const photoIds: string[] = [];
    for (const p of u.photos) {
      const id = `pp-${++photoN}`;
      photos.set(id, { id, thumbUrl: p.url, fullUrl: p.url, caption: p.tag, area: "" });
      photoIds.push(id);
    }
    items.push({
      key: `sample:${i + 1}`,
      at: `${dayYmd}T02:00:00Z`,
      dayYmd,
      // The feed's dot: `live` draws the cyan ring of work under way, `done`
      // the filled emerald of a milestone (the walkthrough / handover card).
      live: !u.milestone,
      title: u.title,
      body: u.body,
      chip: u.chips.length ? { cls: u.milestone ? "emerald" : "cyan", label: u.chips.join(" · ") } : null,
      photoIds,
      cta: null,
      amountCents: null,
    });
    headings.push(`${u.day} · ${u.time}`);
  });

  return { items, headings, photos };
}
