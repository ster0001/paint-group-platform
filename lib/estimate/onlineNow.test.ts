import { describe, expect, it } from "vitest";
import { journeyFromRow } from "@/lib/wizard/journey";
import { buildOnlineNow, sectionOf } from "./onlineNow";

const now = new Date("2026-11-11T03:00:00Z"); // 2pm Melbourne
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const j = (over: Record<string, unknown>) => journeyFromRow({ id: "s1", bucket: "online_now", last_seen_at: ago(1), visits: 1, ...over });

describe("Online now & dropped (brief §4.3)", () => {
  it("live is a heartbeat in the last five minutes, whatever the bucket", () => {
    expect(sectionOf(j({ last_seen_at: ago(4), bucket: "priced_no_request" }), now)).toBe("online");
    expect(sectionOf(j({ last_seen_at: ago(6) }), now)).toBeNull();
  });
  it("a session is in the first section it qualifies for", () => {
    expect(sectionOf(j({ last_seen_at: ago(2), visits: 3 }), now)).toBe("online");
    expect(sectionOf(j({ last_seen_at: ago(20), bucket: "needs_help", visits: 3 }), now)).toBe("needs_help");
    expect(sectionOf(j({ last_seen_at: ago(20), bucket: "priced_no_request", visits: 2 }), now)).toBe("came_back");
    expect(sectionOf(j({ last_seen_at: ago(20), bucket: "priced_no_request" }), now)).toBe("priced");
  });
  it("came back counts only when they were back today (Melbourne), not yesterday", () => {
    // 03:00Z is 14:00 Melbourne; 16 h earlier is 22:00 the day before there.
    expect(sectionOf(j({ last_seen_at: ago(16 * 60), bucket: "dropped", visits: 2 }), now)).toBeNull();
  });
  it("Dropped is today's anonymous drop-outs, shown by suburb only", () => {
    const anon = j({ last_seen_at: ago(90), bucket: "dropped", dropped_at: ago(30), suburb: "Fairfield", name: null });
    const named = j({ id: "s2", last_seen_at: ago(90), bucket: "dropped", dropped_at: ago(30), suburb: "Fairfield", name: "Sam" });
    const view = buildOnlineNow([anon, named], now);
    const dropped = view.find((s) => s.section === "dropped")!;
    expect(dropped.rows.map((r) => r.who)).toEqual(["Fairfield"]);
  });
  it("a converted session is on none of them, and sections come in the brief's order", () => {
    expect(sectionOf(j({ converted_at: ago(1) }), now)).toBeNull();
    expect(buildOnlineNow([], now).map((s) => s.label)).toEqual(["Online now", "Needs help", "Came back after dropping out", "Priced, no request", "Dropped today"]);
  });
});
