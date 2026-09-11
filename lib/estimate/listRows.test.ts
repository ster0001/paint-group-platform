import { describe, expect, it } from "vitest";
import { buildListRow, hasWizardData, LIST_SELECT, type RawListRow } from "./listRows";
import { DEFAULT_BANDS } from "@/lib/wizard/policy";
import { journeyFromRow } from "@/lib/wizard/journey";

const NOW = new Date("2026-09-12T02:00:00Z");
const raw = (over: Partial<RawListRow> = {}): RawListRow => ({
  id: "e1", title: "14 Acacia Street", status: "draft", total_cents: 1_013_000, created_at: "2026-09-11T00:00:00Z",
  viewed_at: null, accepted_at: null, valid_until: null, source: "customer_intake", account_id: "a1",
  wizard_job: "interior", snapshot: { accuracyPct: 91 }, requests: null, views: null, work_orders: null, sources: null,
  ...over,
});
const deps = { wizard: null, loop: null, bands: DEFAULT_BANDS, now: NOW };

describe("the Pack → link (brief 2.4): wizard estimates and no others", () => {
  it("a customer-built estimate has wizard data", () => {
    expect(hasWizardData(raw())).toBe(true);
    expect(buildListRow(raw(), deps).hasWizard).toBe(true);
  });
  it("an in-house estimate and an assistant draft do not — whatever their source says", () => {
    expect(buildListRow(raw({ wizard_job: null, source: null }), deps).hasWizard).toBe(false);
    expect(buildListRow(raw({ wizard_job: null, source: "customer_intake" }), deps).hasWizard).toBe(false);
    expect(buildListRow(raw({ wizard_job: "" }), deps).hasWizard).toBe(false);
  });
  it("the select reads the one scalar the gate needs, not the whole state", () => {
    expect(LIST_SELECT).toContain("wizard_job:builder_state->wizard->state->>jobType");
    expect(LIST_SELECT).not.toMatch(/builder_state[,\s]/);
  });
});

describe("a row is assembled from records, not from a stored status", () => {
  it("the newest request wins, photos are counted the pack's way, the band is the snapshot's", () => {
    const row = buildListRow(raw({
      requests: [
        { kind: "visit", status: "visit_booked", requested_at: "2026-09-01T00:00:00Z", suggested_action: "visit", fixed_price_cents: null },
        { kind: "remote", status: "requested", requested_at: "2026-09-12T01:19:00Z", suggested_action: "fix", fixed_price_cents: null },
      ],
      sources: [{ kind: "floorplan" }, { kind: "defect_photo" }, { kind: "defect_photo" }, { kind: "listing" }],
    }), { ...deps, loop: { confirmed: 9, total: 9, unit: "rooms" } });
    expect(row.pill.label).toBe("Sent · confirm remotely");
    expect(row.pill.sub).toBe(`9 of 9 · ±${DEFAULT_BANDS.tightPct}% · 2 photos · 41m ago`);
    expect(row.action).toEqual({ label: "Fix price", href: "/quote?id=e1&tab=pack" });
    expect(row.value.kind).toBe("range");
  });
  it("accepted with a work order, whichever shape the embed returns", () => {
    for (const wo of [[{ id: "wo1" }], { id: "wo1" }] as const) {
      const row = buildListRow(raw({ status: "accepted", accepted_at: "2026-09-08T01:00:00Z", work_orders: wo as RawListRow["work_orders"] }), deps);
      expect(row.pill.label).toBe("Accepted 08/09 · job created");
      expect(row.action).toEqual({ label: "Open job", href: "/pc/wo/wo1" });
      expect(row.value).toEqual({ kind: "fixed", cents: 1_013_000 });
    }
  });
  it("views: the count and the latest open, from the rows themselves", () => {
    const row = buildListRow(raw({
      status: "sent", viewed_at: "2026-09-10T00:00:00Z", valid_until: "2026-09-26",
      views: [{ updated_at: "2026-09-10T00:00:00Z" }, { updated_at: "2026-09-12T00:00:00Z" }, { updated_at: "2026-09-11T00:00:00Z" }],
    }), deps);
    expect(row.pill.label).toBe("Viewed 3× · no reply");
    expect(row.pill.sub).toBe("last opened 2h ago · expires in 14d");
    expect(row.action).toEqual({ label: "Nudge", href: "/crm/customers/a1" });
  });
  it("the wizard journey still rides along for the drawer", () => {
    const j = journeyFromRow({ id: "w1", estimate_id: "e1", bucket: "priced_no_request", last_seen_at: "2026-09-11T02:00:00Z" });
    const row = buildListRow(raw(), { ...deps, wizard: j });
    expect(row.wizard?.id).toBe("w1");
    expect(row.pill.label).toBe("Priced · no request");
  });
});
