/**
 * Photos the office attaches for the painter (Tom, 23 Sep 2026).
 *
 * The split that matters is officePhotos(): the office's instructions and the
 * painter's own record live in ONE table, and every contractor-facing surface
 * now renders a section fed from it. A widened filter would hand a painter
 * their own before shots back as though we had sent them — so the filter is
 * tested directly, and the SQL that backs it is pinned by reading the
 * migration (the same migration-text pattern the invoicing and accounts
 * contracts use).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  officePhotos, officePhotosForArea, groupByKind,
  WO_PHOTO_KINDS, WO_PHOTO_KIND_LABEL, WO_PHOTO_KIND_ORDER, type WOPhoto,
} from "./photos";

const SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270190000000_wo_reference_photos.sql"),
  "utf8",
);

const photo = (kind: string, area = "", caption = ""): WOPhoto => ({
  id: `${kind}-${area}-${caption}`, workOrderId: "w1", url: "u", kind: kind as WOPhoto["kind"],
  area, caption, takenAt: "2026-09-23T01:00:00Z", variationId: null,
});

const mixed = [
  photo("before", "Front", "painter's own"),
  photo("reference", "Front", "scaffold this side"),
  photo("qa", "Front", "inspector"),
  photo("reference", "", "gate code"),
  photo("completion", "Front", "finished"),
  photo("progress", "Hallway", "second coat"),
  photo("variation", "Hallway", "extra door"),
];

describe("officePhotos — the office's half, and only that", () => {
  it("keeps reference photos and nothing else", () => {
    expect(officePhotos(mixed).map((p) => p.caption))
      .toEqual(["scaffold this side", "gate code"]);
  });

  it("drops EVERY kind the painter owns", () => {
    const kinds = new Set(officePhotos(mixed).map((p) => p.kind));
    for (const k of ["before", "progress", "qa", "completion", "variation"]) {
      expect(kinds.has(k as WOPhoto["kind"])).toBe(false);
    }
  });

  it("is empty rather than everything when there are no office photos", () => {
    // The failure that would matter is a filter that falls back to "all".
    expect(officePhotos(mixed.filter((p) => p.kind !== "reference"))).toEqual([]);
  });

  it("an area's photos include the ones pinned to the whole job", () => {
    expect(officePhotosForArea(mixed, "Front").map((p) => p.caption))
      .toEqual(["scaffold this side", "gate code"]);
  });

  it("an area's photos exclude another area's", () => {
    expect(officePhotosForArea([...mixed, photo("reference", "Hallway", "other")], "Front")
      .map((p) => p.caption)).not.toContain("other");
  });
});

describe("the kind is a first-class kind, not a caption convention", () => {
  it("is known, labelled for a painter, and ordered first", () => {
    expect(WO_PHOTO_KINDS).toContain("reference");
    expect(WO_PHOTO_KIND_LABEL.reference).toBe("From the office");
    expect(WO_PHOTO_KIND_ORDER[0]).toBe("reference");
  });

  it("groups on its own rather than falling in with the painter's record", () => {
    const groups = groupByKind(mixed);
    expect(groups[0].kind).toBe("reference");
    expect(groups[0].photos).toHaveLength(2);
  });
});

describe("the SQL keeps the promises the TypeScript makes", () => {
  it("adds the enum value idempotently, before anything uses it", () => {
    expect(SQL).toMatch(/alter type public\.wo_photo_kind add value if not exists 'reference';/);
    const enumAt = SQL.indexOf("add value if not exists 'reference'");
    const fnAt = SQL.indexOf("create or replace function public.wo_record_reference_photo");
    expect(enumAt).toBeGreaterThan(-1);
    expect(enumAt).toBeLessThan(fnAt);
  });

  it("writing one is staff-only, and refused on a closed job", () => {
    const fn = SQL.slice(SQL.indexOf("wo_record_reference_photo"), SQL.indexOf("wo_delete_reference_photo"));
    expect(fn).toContain("if not public.is_staff() then return 'error:not_staff'");
    expect(fn).toContain("error:closed");
  });

  it("deleting is scoped to OUR photos — the painter's record is not ours to delete", () => {
    const fn = SQL.slice(SQL.indexOf("create or replace function public.wo_delete_reference_photo"));
    expect(fn).toContain("if not public.is_staff() then return 'error:not_staff'");
    expect(fn).toMatch(/if v_p\.kind <> 'reference' then return 'error:not_a_reference_photo'/);
  });

  it("the token read returns only reference photos, only while issued", () => {
    const fn = SQL.slice(SQL.indexOf("get_work_order_office_photos_by_token"));
    expect(fn).toContain("w.issued_at is not null");
    expect(fn).toMatch(/p\.kind::text = 'reference'/);
    // Paths, never URLs — the server signs them afterwards.
    expect(fn).toContain("p.storage_path");
  });

  it("anon may READ by token but never WRITE", () => {
    expect(SQL).toContain("grant execute on function public.get_work_order_office_photos_by_token(text) to anon, authenticated");
    expect(SQL).toContain("revoke execute on function public.wo_record_reference_photo(uuid, text, text, text) from public, anon");
    expect(SQL).toContain("revoke execute on function public.wo_delete_reference_photo(uuid) from public, anon");
  });

  it("registers itself in the production ledger (CLAUDE.md law)", () => {
    expect(SQL).toContain(
      "insert into public._prod_migrations(name) values ('20270190000000_wo_reference_photos.sql') on conflict (name) do nothing",
    );
  });

  it("starts with a lock timeout so a busy table fails loudly", () => {
    expect(SQL).toMatch(/^set lock_timeout = '15s';/m);
  });
});
