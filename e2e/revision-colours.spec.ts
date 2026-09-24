import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, rpcAsJson, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 24 Sep 2026: "if colours are added in the revise scope section, after
 * a client has accepted a job, this needs to be updated on the client's
 * profile, as well as for the contractor so it is fully transparent for
 * everybody."
 *
 * The customer's Colours tab, the painter's job sheet and the PC Materials
 * card all read work_orders.wo_snapshot (+ the colours mirror). The revision
 * builder saves its computed job sheet on the working scope (working_state.
 * woDoc); wo_sync_scope_colours (20270199) folds the colour fields into the
 * live snapshot after every save. This drives the RPCs the save action calls,
 * with the shape the builder writes.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let job: LoopFixture | null = null;

type Snapshot = {
  materials: { product: string; colourKey?: string; colourName: string; colourHex: string; colourStatus: string }[];
  areas: { id: string; surfaces: { key: string; colourName?: string; colourHex?: string; colourKey?: string }[] }[];
};
const snapshot = async () => {
  const { data } = await db!.from("work_orders").select("wo_snapshot, colours").eq("id", job!.workOrderId).single();
  return data as { wo_snapshot: Snapshot; colours: Record<string, { name?: string; hex?: string; status?: string }> | null };
};

test.describe.configure({ mode: "serial" });

test.describe("colours chosen in the revision working scope reach the job", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    // The fixture's sheet: ONE product, Weathershield, colour still TBC.
    job = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls", "Windows"] }]);
    const opened = await rpcAsJson<{ error?: string; created?: boolean }>(staff!, "wo_open_working_scope", { p_estimate_id: job.estimateId });
    expect(opened.error).toBeUndefined();
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("a colour decided for a TBC product lands on the sheet, confirmed, for the customer and the painter", async () => {
    // The builder's save: the working state carries its computed job sheet.
    const woDoc = {
      version: 1,
      materials: [{
        product: "Weathershield", colourKey: "Weathershield||Natural White", photoUrl: "", litres: 10, coverageMissing: false,
        colourName: "Natural White", colourHex: "#F1EDE4", colourStatus: "tbc", colourMatch: null,
      }],
      areas: [{
        id: "a0", title: "Front", finishCode: "PG-3", finishOverridden: false, photos: [],
        surfaces: [
          { key: "a0:0", label: "Walls", coats: 2, product: "Weathershield", colourName: "Natural White", colourHex: "#F1EDE4", colourKey: "Weathershield||Natural White", prep: "", hours: 1, status: "not_started" },
          { key: "a0:1", label: "Windows", coats: 2, product: "Weathershield", colourName: "Natural White", colourHex: "#F1EDE4", colourKey: "Weathershield||Natural White", prep: "", hours: 1, status: "not_started" },
        ],
      }],
    };
    expect(await rpcAs(staff!, "wo_save_working_scope", { p_estimate_id: job!.estimateId, p_state: { blocks: [], woDoc } })).toBe("ok");
    expect(await rpcAs(staff!, "wo_sync_scope_colours", { p_estimate_id: job!.estimateId })).toBe("ok:synced:1");

    const { wo_snapshot: snap, colours } = await snapshot();
    const row = snap.materials.find((m) => m.product === "Weathershield")!;
    expect(row.colourName).toBe("Natural White");
    expect(row.colourHex).toBe("#F1EDE4");
    expect(row.colourStatus).toBe("confirmed");
    expect(row.colourKey).toBe("Weathershield||Natural White");
    // Every surface painted in it says so too — the per-surface truth the
    // colour register and the job sheet group by.
    for (const s of snap.areas[0].surfaces) {
      expect(s.colourName).toBe("Natural White");
      expect(s.colourKey).toBe("Weathershield||Natural White");
    }
    // The mirror the PC Materials card and the register read.
    expect(colours?.["Weathershield||Natural White"]).toMatchObject({ name: "Natural White", status: "confirmed" });

    // Nothing to do twice.
    expect(await rpcAs(staff!, "wo_sync_scope_colours", { p_estimate_id: job!.estimateId })).toBe("ok:unchanged");
    const { data: ev } = await db!.from("wo_events").select("meta").eq("work_order_id", job!.workOrderId).eq("type", "scope_colours_synced");
    expect((ev ?? []).length).toBe(1);
  });

  test("a new product×colour is added only when a surface painted in it is on the job", async () => {
    const woDoc = {
      version: 1,
      materials: [
        { product: "Weathershield", colourKey: "Weathershield||Natural White", photoUrl: "", litres: 10, coverageMissing: false, colourName: "Natural White", colourHex: "#F1EDE4", colourStatus: "confirmed", colourMatch: null },
        // Windows re-specced in Aquanamel — a surface the job HAS (a0:1).
        { product: "Aquanamel", colourKey: "Aquanamel||Vivid White", photoUrl: "", litres: 4, coverageMissing: false, colourName: "Vivid White", colourHex: "#FFFFFF", colourStatus: "tbc", colourMatch: null },
        // A pergola nobody has signed for yet — its surface (a9:0) is not on the job.
        { product: "Solarguard", colourKey: "Solarguard||Monument", photoUrl: "", litres: 4, coverageMissing: false, colourName: "Monument", colourHex: "#323639", colourStatus: "tbc", colourMatch: null },
      ],
      areas: [
        { id: "a0", title: "Front", finishCode: "PG-3", finishOverridden: false, photos: [], surfaces: [
          { key: "a0:0", label: "Walls", coats: 2, product: "Weathershield", colourName: "Natural White", colourHex: "#F1EDE4", colourKey: "Weathershield||Natural White", prep: "", hours: 1, status: "not_started" },
          { key: "a0:1", label: "Windows", coats: 2, product: "Aquanamel", colourName: "Vivid White", colourHex: "#FFFFFF", colourKey: "Aquanamel||Vivid White", prep: "", hours: 1, status: "not_started" },
        ] },
        { id: "a9", title: "Pergola", finishCode: "PG-3", finishOverridden: false, photos: [], surfaces: [
          { key: "a9:0", label: "Beams", coats: 2, product: "Solarguard", colourName: "Monument", colourHex: "#323639", colourKey: "Solarguard||Monument", prep: "", hours: 1, status: "not_started" },
        ] },
      ],
    };
    expect(await rpcAs(staff!, "wo_save_working_scope", { p_estimate_id: job!.estimateId, p_state: { blocks: [], woDoc } })).toBe("ok");
    expect(await rpcAs(staff!, "wo_sync_scope_colours", { p_estimate_id: job!.estimateId })).toBe("ok:synced:1");

    const { wo_snapshot: snap } = await snapshot();
    expect(snap.materials.map((m) => m.product).sort()).toEqual(["Aquanamel", "Weathershield"]);
    expect(snap.materials.find((m) => m.product === "Aquanamel")).toMatchObject({ colourName: "Vivid White", colourStatus: "confirmed" });
    expect(snap.areas[0].surfaces.find((s) => s.key === "a0:1")).toMatchObject({ colourName: "Vivid White", colourKey: "Aquanamel||Vivid White" });
    // The pergola's paint waits for the customer's signature on that addition.
    expect(snap.materials.some((m) => m.product === "Solarguard")).toBe(false);
  });

  test("the painter cannot run the sync — it is the office's save", async () => {
    expect(await rpcAs(contractor!, "wo_sync_scope_colours", { p_estimate_id: job!.estimateId })).toBe("error:not_staff");
  });
});
