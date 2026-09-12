import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_SEGMENTS, commercialAssumedList, commercialRestatement, commercialRoomList, defaultCommercialAnswers,
  commercialSurfaceKeys, kindLeavesForBrief, openCount, parseSegments, routeTag, segmentByKey, segmentTiles,
} from "./segments";
import { DEFAULT_QUICK_LOOK } from "./quick-look";

/**
 * C12 — the segments as data.
 *
 * ⚑ The mirror test: `DEFAULT_SEGMENTS` must equal the migration's seed, row
 * for row. The SQL is the source; the mirror only exists so a database that
 * has not run the migration renders the same eight tiles. Drift here means
 * two truths, and the screen would follow whichever loaded.
 */

const SQL = readFileSync(new URL("../../supabase/migrations/20270140000000_commercial_segments.sql", import.meta.url), "utf8");
/** C14 extends the brief configs with `update … set brief = brief || $j${…}$j$ where key = '…'` — applied here so the mirror still equals the live rows. */
const SQL_C14 = readFileSync(new URL("../../supabase/migrations/20270141000000_commercial_briefs.sql", import.meta.url), "utf8");

function seedRows(): unknown[] {
  // Each row: ('key', position, 'name', 'hint', 'route', tile, $j${config}$j$, $j${brief}$j$ | null, $j${typicals}$j$ | '{}'::jsonb)
  const body = SQL.slice(SQL.indexOf("insert into public.commercial_segments"), SQL.indexOf("on conflict (key) do update"));
  const rows: unknown[] = [];
  const re = /\('([a-z]+)', (\d+), '((?:[^']|'')*)', '((?:[^']|'')*)', '(range|brief)', (true|false), (\$j\$[\s\S]*?\$j\$|'\{\}'::jsonb),\s*(null|\$j\$[\s\S]*?\$j\$),\s*(\$j\$[\s\S]*?\$j\$|'\{\}'::jsonb)\)/g;
  const json = (s: string) => (s.startsWith("$j$") ? JSON.parse(s.slice(3, -3)) : s === "null" ? null : {});
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    rows.push({
      key: m[1], position: Number(m[2]), name: m[3].replace(/''/g, "'"), tile_hint: m[4].replace(/''/g, "'"),
      route: m[5], tile: m[6] === "true", config: json(m[7]), brief: json(m[8]), typicals: json(m[9]),
    });
  }
  const patch = /set brief = brief \|\| \$j\$([\s\S]*?)\$j\$::jsonb, updated_at = now\(\) where key = '([a-z]+)'/g;
  let p: RegExpExecArray | null;
  while ((p = patch.exec(SQL_C14))) {
    const row = rows.find((r) => (r as { key: string }).key === p![2]) as { brief: Record<string, unknown> | null } | undefined;
    if (row?.brief) row.brief = { ...row.brief, ...JSON.parse(p[1]) };
  }
  return rows;
}

describe("the mirror equals the seed", () => {
  it("parses the nine rows out of the migration — eight tiles and the exterior route", () => {
    expect(seedRows()).toHaveLength(9);
  });

  it("row for row, field for field", () => {
    const fromSql = parseSegments(seedRows());
    expect(fromSql.map((s) => s.key)).toEqual(DEFAULT_SEGMENTS.map((s) => s.key));
    for (const s of fromSql) {
      const mirror = DEFAULT_SEGMENTS.find((d) => d.key === s.key)!;
      expect(s, s.key).toEqual(mirror);
    }
  });

  it("the seed carries no partition or frontage question, and every range tile has the areas it renders", () => {
    for (const s of DEFAULT_SEGMENTS) {
      if (s.route !== "range" || s.config.pattern === "warehouse") continue;
      expect(s.config.counts?.length, s.key).toBeGreaterThan(0);
      for (const [key] of s.config.counts!) expect(s.typicals.rooms[key], `${s.key}.${key}`).toBeDefined();
      for (const label of s.config.also ?? []) expect(s.typicals.alsoSize[label], `${s.key}: ${label}`).toBeDefined();
      expect(s.config.surf?.length, s.key).toBeGreaterThan(0);
      expect(s.config.hours.length, s.key).toBeGreaterThan(0);
    }
  });
});

describe("loading and lookup", () => {
  it("falls back to the mirror on an empty or unusable read", () => {
    expect(parseSegments([])).toBe(DEFAULT_SEGMENTS);
    expect(parseSegments(null)).toBe(DEFAULT_SEGMENTS);
    expect(parseSegments([{ key: "x" }])).toBe(DEFAULT_SEGMENTS);
  });

  it("orders loaded rows by position and drops a malformed one", () => {
    const rows = [
      { key: "b", position: 2, name: "B", route: "range" },
      { key: "a", position: 1, name: "A", route: "brief" },
      { key: "bad", position: 0, name: "Bad", route: "sideways" },
    ];
    expect(parseSegments(rows).map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("tiles are the rows flagged as tiles — exterior is a route, not a tile", () => {
    expect(segmentTiles(DEFAULT_SEGMENTS).map((s) => s.key)).not.toContain("exterior");
    expect(segmentTiles(DEFAULT_SEGMENTS)).toHaveLength(8);
    expect(segmentByKey(DEFAULT_SEGMENTS, "exterior")?.route).toBe("brief");
  });

  it("the tag is derived from the route", () => {
    expect(routeTag("range")).toBe("ONLINE · OR WE VISIT");
    expect(routeTag("brief")).toBe("WE VISIT");
  });

  it("resolves phase 7a's keys", () => {
    expect(segmentByKey(DEFAULT_SEGMENTS, "healthcare")?.key).toBe("health");
    expect(segmentByKey(DEFAULT_SEGMENTS, "industrial")?.key).toBe("warehouse");
    expect(segmentByKey(DEFAULT_SEGMENTS, "nope")).toBeNull();
  });
});

describe("the office pattern's answers and room list", () => {
  const office = segmentByKey(DEFAULT_SEGMENTS, "office")!;

  it("defaults every count to the seed value and ticks the first six surfaces", () => {
    const a = defaultCommercialAnswers(office);
    expect(a.counts).toEqual({ offices: 4, open: 1, meeting: 1 });
    expect(a.surfaces).toHaveLength(6);
    expect(a.hours).toBe("business");
    expect(a.occ).toBe("vacant");
    expect(a.openHeight).toBeNull();
    expect(a.kind).toBeNull();
  });

  it("Tom's check: 4 offices, 1 open plan, 1 meeting room → six rooms, the open one from the bracket", () => {
    const rooms = commercialRoomList(office, defaultCommercialAnswers(office));
    expect(rooms.map((r) => r.name)).toEqual(["Office 1", "Office 2", "Office 3", "Office 4", "Open plan", "Meeting room"]);
    expect(rooms.filter((r) => r.open)).toHaveLength(1);
    const open = rooms.find((r) => r.open)!;
    expect(open.roomType).toBe("living");
    expect(open.L).toBe(10); // √100 for the 50–150 bracket
    expect(open.W).toBe(10);
    expect(rooms[0]).toMatchObject({ roomType: "study", L: 3.5, W: 4, outside: false });
    expect(rooms[5]).toMatchObject({ roomType: "dining", L: 4, W: 5 });
  });

  it("also-areas ride at their typicals; a flagged one is outside and unpriced", () => {
    const retail = segmentByKey(DEFAULT_SEGMENTS, "retail")!;
    const a = { ...defaultCommercialAnswers(retail), also: ["Bar", "Covered outdoor dining"] };
    const rooms = commercialRoomList(retail, a);
    const bar = rooms.find((r) => r.name === "Bar")!;
    expect(bar).toMatchObject({ roomType: "living", L: 6, W: 3, outside: false });
    const outdoor = rooms.find((r) => r.name === "Covered outdoor dining")!;
    expect(outdoor.outside).toBe(true);
    expect(outdoor.roomType).toBe("unknown");
  });

  it("a zero count seeds no rooms; the open count reads the answer", () => {
    const a = { ...defaultCommercialAnswers(office), counts: { offices: 0, open: 2, meeting: 0 } };
    const rooms = commercialRoomList(office, a);
    expect(rooms.map((r) => r.name)).toEqual(["Open plan 1", "Open plan 2"]);
    expect(openCount(office, a)).toBe(2);
    expect(openCount(office, { counts: {} })).toBe(1);
  });

  it("the ticked surfaces select substrate keys; a surface with no rate is flagged, not guessed", () => {
    const { keys, unmapped } = commercialSurfaceKeys(office, defaultCommercialAnswers(office));
    expect(keys).toEqual(["walls", "ceilings", "doors", "architraves", "windows", "skirting"]);
    expect(unmapped).toEqual([]);
    const school = segmentByKey(DEFAULT_SEGMENTS, "school")!;
    const r = commercialSurfaceKeys(school, { surfaces: ["Pinboard surrounds", "Feature walls"] });
    expect(r.keys).toEqual(["walls"]);
    expect(r.unmapped).toEqual(["Pinboard surrounds"]);
    expect(commercialSurfaceKeys(school, { surfaces: [] }).keys).toEqual(["walls"]);
    // Every seeded surface label has a mapping — a label the map does not know is a seed bug.
    for (const seg of DEFAULT_SEGMENTS) {
      for (const label of seg.config.surf ?? []) expect(label in (seg.config.surfKeys ?? {}), `${seg.key}: ${label}`).toBe(true);
    }
  });

  it("health: hospital leaves for the brief, aged care does not", () => {
    const health = segmentByKey(DEFAULT_SEGMENTS, "health")!;
    expect(kindLeavesForBrief(health, "hospital")).toBe("hospital");
    expect(kindLeavesForBrief(health, "aged")).toBeNull();
    expect(kindLeavesForBrief(office, "hospital")).toBeNull();
  });
});

describe("the reveal's words", () => {
  const office = segmentByKey(DEFAULT_SEGMENTS, "office")!;
  const q = { ...DEFAULT_QUICK_LOOK };

  it("restates the counts, the colour and the condition", () => {
    const line = commercialRestatement(office, defaultCommercialAnswers(office), q);
    expect(line).toMatch(/^Based on an office with 4 offices, 1 open plan and 1 meeting room, new colours on the walls, some wear, business hours\./);
  });

  it("lists the open-space assumption and the hours loading, and the standard height for the small rooms", () => {
    const list = commercialAssumedList(office, { ...defaultCommercialAnswers(office), hours: "after" }, 0);
    const keys = list.map((a) => a.key);
    expect(keys).toEqual(["rooms", "open", "systems", "height", "hours", "excluded"]);
    expect(list.find((a) => a.key === "open")!.why).toMatch(/A photo or two narrows this/);
    expect(commercialAssumedList(office, defaultCommercialAnswers(office), 2).find((a) => a.key === "open")!.why).toMatch(/Your photo/);
  });

  it("a school hall says its height and the platform", () => {
    const school = segmentByKey(DEFAULT_SEGMENTS, "school")!;
    const list = commercialAssumedList(school, { ...defaultCommercialAnswers(school), openHeight: "9" }, 0);
    const open = list.find((a) => a.key === "open")!;
    expect(open.what).toMatch(/over 6 m — platform or lift allowed for/);
    expect(list.map((a) => a.key)).not.toContain("height");
  });
});
