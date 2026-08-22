import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  forVariation, groupByKind, photoCaption, photoWhen, signPhotos,
  type WOPhoto, type WOPhotoRow,
} from "./photos";

const row = (over: Partial<WOPhotoRow> = {}): WOPhotoRow => ({
  id: "p1",
  work_order_id: "wo1",
  kind: "before",
  area: "Front elevation",
  caption: "",
  storage_path: "wo/wo1/1-aaaa",
  created_at: "2026-08-22T00:14:00Z", // 10:14 am in Melbourne
  variation_id: null,
  ...over,
});

/** A Supabase double that signs whatever it is handed, minus the misses. */
const db = (missing: string[] = []) => {
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths
      .filter((p) => !missing.includes(p))
      .map((p) => ({ path: p, signedUrl: `https://signed.test/${p}?token=x`, error: null })),
    error: null,
  }));
  return {
    client: { storage: { from: () => ({ createSignedUrls }) } } as unknown as SupabaseClient,
    createSignedUrls,
  };
};

describe("signing site photos", () => {
  it("signs the whole batch in one round trip", async () => {
    const { client, createSignedUrls } = db();
    const out = await signPhotos(client, [
      row({ id: "a", storage_path: "wo/wo1/a" }),
      row({ id: "b", storage_path: "wo/wo1/b" }),
    ]);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
    expect(out[0].url).toContain("https://signed.test/wo/wo1/a");
  });

  it("drops a row whose object has gone missing rather than rendering a broken tile", async () => {
    const { client } = db(["wo/wo1/gone"]);
    const out = await signPhotos(client, [
      row({ id: "here", storage_path: "wo/wo1/here" }),
      row({ id: "gone", storage_path: "wo/wo1/gone" }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["here"]);
  });

  it("never calls storage when there is nothing to sign", async () => {
    const { client, createSignedUrls } = db();
    expect(await signPhotos(client, [])).toEqual([]);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("normalises the row into what a screen needs", async () => {
    const { client } = db();
    const [p] = await signPhotos(client, [row({ caption: "second coat", variation_id: "v9" })]);
    expect(p).toMatchObject({
      workOrderId: "wo1", kind: "before", area: "Front elevation",
      caption: "second coat", variationId: "v9",
    });
  });

  it("falls back to progress for a kind it doesn't know, instead of crashing a page", async () => {
    const { client } = db();
    const [p] = await signPhotos(client, [row({ kind: "something_new" })]);
    expect(p.kind).toBe("progress");
  });
});

describe("grouping", () => {
  const photo = (over: Partial<WOPhoto>): WOPhoto => ({
    id: "x", workOrderId: "wo1", url: "u", kind: "progress", area: "", caption: "",
    takenAt: "2026-08-22T00:14:00Z", variationId: null, ...over,
  });

  it("orders kinds the way the job runs, and omits the empty ones", () => {
    const grouped = groupByKind([
      photo({ id: "1", kind: "completion" }),
      photo({ id: "2", kind: "before" }),
      photo({ id: "3", kind: "variation" }),
    ]);
    expect(grouped.map((g) => g.kind)).toEqual(["before", "variation", "completion"]);
  });

  it("picks out the photos attached to one variation", () => {
    const list = [
      photo({ id: "1", kind: "variation", variationId: "v1" }),
      photo({ id: "2", kind: "variation", variationId: "v2" }),
      photo({ id: "3" }),
    ];
    expect(forVariation(list, "v1").map((p) => p.id)).toEqual(["1"]);
  });
});

describe("labels", () => {
  const p: WOPhoto = {
    id: "x", workOrderId: "wo1", url: "u", kind: "before", area: "Front elevation",
    caption: "before start", takenAt: "2026-08-22T00:14:00Z", variationId: null,
  };

  // The suite runs under TZ=Australia/Melbourne, but the formatter is pinned
  // anyway — a photo taken at 10am must never read as yesterday.
  it("stamps the time in Melbourne, not UTC", () => {
    expect(photoWhen(p)).toContain("22 Aug");
    expect(photoWhen(p)).toMatch(/10:14/);
  });

  it("reads as where, what, when", () => {
    expect(photoCaption(p)).toBe("Front elevation · before start · " + photoWhen(p));
  });
});
