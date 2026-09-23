/**
 * Correcting the level of finish on an issued job sheet (Tom, 23 Sep 2026).
 *
 * Two halves that must agree: applyFinishLevelEdit() here, and
 * wo_set_finish_level in migration 20270189. The document rule is tested
 * directly; the SQL is pinned by reading the migration, the same
 * migration-text pattern the invoicing and accounts contracts use — so undoing
 * a DB-level guarantee fails on every commit rather than on a Monday morning
 * in front of a painter.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFinishLevelEdit, CORRECTABLE_FINISH_MODIFIERS, finishFromModifier,
  isCorrectableFinishModifier,
} from "./finish";

const SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270189000000_wo_set_finish_level.sql"),
  "utf8",
);

const doc = () => ({
  levelOfFinish: "Level 3 — Good. Full prep, filled, sanded, sealed, caulked",
  finishCode: "PG-3" as string | null,
  areas: [
    { id: "a0", title: "Front", finishCode: "PG-3", finishOverridden: false },
    { id: "a1", title: "Hallway", finishCode: "PG-4", finishOverridden: true },
    { id: "a2", title: "Garage", finishCode: "PG-2", finishOverridden: true },
  ],
});

describe("applyFinishLevelEdit — the job moves, the overrides stand", () => {
  it("sets the job's standard and its label", () => {
    const out = applyFinishLevelEdit(doc(), "PG-2", "Level 2 — Standard. Light sand");
    expect(out.finishCode).toBe("PG-2");
    expect(out.levelOfFinish).toBe("Level 2 — Standard. Light sand");
  });

  it("an area that never carried an override follows the job down", () => {
    const out = applyFinishLevelEdit(doc(), "PG-2", "Level 2");
    const front = out.areas.find((a) => a.id === "a0")!;
    expect(front.finishCode).toBe("PG-2");
    expect(front.finishOverridden).toBe(false);
  });

  it("an overridden area keeps its own standard", () => {
    const out = applyFinishLevelEdit(doc(), "PG-2", "Level 2");
    const hallway = out.areas.find((a) => a.id === "a1")!;
    expect(hallway.finishCode).toBe("PG-4");
    expect(hallway.finishOverridden).toBe(true);
  });

  it("an override that now AGREES with the job stops reading as a difference", () => {
    // The Garage was pinned to PG-2 while the job was PG-3. Moving the job to
    // PG-2 makes them the same — the painter's sheet must not keep flagging
    // "this area differs" over two identical levels.
    const out = applyFinishLevelEdit(doc(), "PG-2", "Level 2");
    const garage = out.areas.find((a) => a.id === "a2")!;
    expect(garage.finishCode).toBe("PG-2");
    expect(garage.finishOverridden).toBe(false);
  });

  it("a document with no areas is left with none, not an empty list", () => {
    const out = applyFinishLevelEdit(
      { levelOfFinish: "Level 3", finishCode: "PG-3" }, "PG-4", "Level 4");
    expect(out.finishCode).toBe("PG-4");
    expect("areas" in out).toBe(false);
  });

  it("treats a pre-override document's missing flag as 'follows the job'", () => {
    const out = applyFinishLevelEdit(
      { levelOfFinish: "Level 3", finishCode: "PG-3", areas: [{ finishCode: "PG-3" }] },
      "PG-2", "Level 2");
    expect(out.areas![0]).toEqual({ finishCode: "PG-2", finishOverridden: false });
  });
});

describe("FIN-1 has no contractor standard and is never guessed", () => {
  it("is not offerable", () => {
    expect(isCorrectableFinishModifier("FIN-1")).toBe(false);
    expect(CORRECTABLE_FINISH_MODIFIERS).toEqual(["FIN-2", "FIN-3", "FIN-4"]);
  });
  it("maps to nothing, rather than being promoted to PG-2", () => {
    expect(finishFromModifier("FIN-1")).toBeNull();
  });
  it("the RPC refuses it too — not only the form", () => {
    expect(SQL).toMatch(/not in \('FIN-2', 'FIN-3', 'FIN-4'\)/);
    expect(SQL).toContain("error:bad_level");
  });
});

describe("the SQL keeps the promises the TypeScript makes", () => {
  it("maps FIN-n to PG-n, the same mapping finishFromModifier makes", () => {
    expect(SQL).toContain("'PG-' || split_part(v_code, '-', 2)");
    for (const code of CORRECTABLE_FINISH_MODIFIERS) {
      expect(finishFromModifier(code)).toBe(`PG-${code.split("-")[1]}`);
    }
  });

  it("is staff-only and refuses a closed or unissued job", () => {
    expect(SQL).toContain("if not public.is_staff() then return 'error:not_staff'");
    expect(SQL).toContain("error:closed");
    expect(SQL).toContain("error:not_issued");
  });

  it("takes the label off the rate card, never off the wire", () => {
    expect(SQL).toMatch(/from public\.modifiers where code = v_code/);
    expect(SQL).toContain("error:no_such_level");
  });

  it("cascades to areas on the same rule as applyFinishLevelEdit", () => {
    expect(SQL).toContain("'finishOverridden'");
    expect(SQL).toMatch(/coalesce\(\(a ->> 'finishOverridden'\)::boolean, false\)/);
  });

  it("never touches money or the frozen estimate", () => {
    expect(SQL).not.toMatch(/update public\.estimates/);
    expect(SQL).not.toMatch(/contractor_payment_cents\s*=/);
    expect(SQL).not.toMatch(/total_cents\s*=/);
  });

  it("anon cannot execute it", () => {
    expect(SQL).toContain("revoke execute on function public.wo_set_finish_level(uuid, text) from public, anon");
    expect(SQL).toContain("grant execute on function public.wo_set_finish_level(uuid, text) to authenticated");
  });

  it("registers itself in the production ledger (CLAUDE.md law)", () => {
    expect(SQL).toContain(
      "insert into public._prod_migrations(name) values ('20270189000000_wo_set_finish_level.sql') on conflict (name) do nothing",
    );
  });

  it("starts with a lock timeout so a busy table fails loudly", () => {
    expect(SQL).toMatch(/^set lock_timeout = '15s';/m);
  });
});
