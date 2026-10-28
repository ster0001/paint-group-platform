import { test, expect } from "vitest";
import { melbourneDay, videoObjectLd, videoUploadDateFor } from "./videoLd";

test("Search Console 28 Oct 2026: every VideoObject carries uploadDate, and empty thumbnails are dropped", () => {
  const ld = videoObjectLd({ name: "Andrea - Sandringham", description: "d", thumbnailUrl: [null, "https://x/t.jpg", ""], embedUrl: "https://e", contentUrl: "https://c", uploadDate: "2026-10-01" });
  expect(ld["@type"]).toBe("VideoObject");
  expect(ld.uploadDate).toBe("2026-10-01");
  expect(ld.thumbnailUrl).toEqual(["https://x/t.jpg"]);
  expect("transcript" in ld).toBe(false);
});

test("a job's upload date: published, else completed, else created, else today in Melbourne", () => {
  expect(videoUploadDateFor({ published_at: "2026-09-03T04:00:00Z", completed_on: "2026-08-01" })).toBe("2026-09-03");
  expect(videoUploadDateFor({ published_at: null, completed_on: "2026-08-01" })).toBe("2026-08-01");
  expect(videoUploadDateFor({ published_at: null, completed_on: null, created_at: "2026-07-07T10:00:00Z" })).toBe("2026-07-07");
  const fixed = new Date("2026-10-27T23:30:00Z"); // 10:30am 28 Oct in Melbourne (+11)
  expect(videoUploadDateFor({}, fixed)).toBe("2026-10-28");
  expect(melbourneDay(new Date("2026-10-27T13:30:00Z"))).toBe("2026-10-28"); // 00:30 Melbourne
});
