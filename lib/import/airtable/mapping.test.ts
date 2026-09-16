import { describe, expect, it } from "vitest";
import {
  mapEstimateStatus, mapEvent, mapJobStatus, mapLevelOfFinish, mapLostReason, mapRelationshipState,
  mapSizeBand, mapTags, mapTemperature,
} from "./mapping";
import { CRM_EVENT_SCHEMAS } from "@/lib/crm/events";
import { LOST_REASONS } from "@/lib/crm/states";

describe("airtable import · account mappings", () => {
  it("lost_reason lands on a value the CHECK allows (Tom, 16 Sep: no_response → something_else + note)", () => {
    expect(mapLostReason("competitor")).toEqual({ lostReason: "went_with_someone_else", stateNote: null });
    expect(mapLostReason("other")).toEqual({ lostReason: "something_else", stateNote: null });
    expect(mapLostReason("no_response")).toEqual({ lostReason: "something_else", stateNote: "No response (Airtable)" });
    expect(mapLostReason("")).toBeNull();
    for (const v of ["competitor", "other", "no_response"]) {
      expect(LOST_REASONS.map((r) => r.key)).toContain(mapLostReason(v)!.lostReason);
    }
    expect(() => mapLostReason("price")).toThrow(/unknown lost_reason/);
  });

  it("temperature maps one-to-one and blank stays null", () => {
    expect(mapTemperature("hot")).toBe("hot");
    expect(mapTemperature("Warm")).toBe("warm");
    expect(mapTemperature("")).toBeNull();
    expect(() => mapTemperature("tepid")).toThrow();
  });

  it("tags become the platform's underscore keys, deduplicated and sorted", () => {
    expect(mapTags("agency,airtable-import,kay-and-burton,real-estate")).toEqual(["agency", "airtable_import", "kay_and_burton", "real_estate"]);
    expect(mapTags("airtable-import,airtable-import")).toEqual(["airtable_import"]);
    expect(mapTags("")).toEqual([]);
    expect(() => mapTags("vip")).toThrow(/unknown tag/);
  });

  it("relationship_state is active or lost, nothing else", () => {
    expect(mapRelationshipState("lost")).toBe("lost");
    expect(() => mapRelationshipState("delayed")).toThrow();
  });
});

describe("airtable import · estimate and job mappings", () => {
  it("status, size band and level of finish", () => {
    expect(mapEstimateStatus("accepted")).toBe("accepted");
    expect(() => mapEstimateStatus("won")).toThrow();
    expect(mapSizeBand("over_20k")).toBe("over_20k");
    expect(mapSizeBand("")).toBeNull();
    expect(mapLevelOfFinish("3", "sent")).toBe(3);
    expect(mapLevelOfFinish("", "draft")).toBeNull();
    // estimates_finish_required_when_sent: never weakened, never defaulted here.
    expect(() => mapLevelOfFinish("", "sent")).toThrow(/no level_of_finish/);
    expect(() => mapLevelOfFinish("1", "sent")).toThrow();
  });

  it("job status is one of the crm_jobs CHECK values", () => {
    expect(mapJobStatus("accepted_unscheduled")).toBe("accepted_unscheduled");
    expect(() => mapJobStatus("booked")).toThrow();
  });
});

describe("airtable import · events land in the catalogue's shape", () => {
  const valid = (type: string, payload: Record<string, unknown>) => {
    const schema = CRM_EVENT_SCHEMAS[type as keyof typeof CRM_EVENT_SCHEMAS];
    expect(schema, `${type} is in the catalogue`).toBeDefined();
    const r = schema.safeParse(payload);
    expect(r.success, `${type} payload: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
  };

  it("a CSV note is note_added with the author riding along", () => {
    const m = mapEvent("note", { text: "rang, still deciding", author: "Tom", origin: "airtable_estimates_notes" });
    expect(m.type).toBe("note_added");
    expect(m.payload).toMatchObject({ body: "rang, still deciding", author: "Tom", origin: "airtable_estimates_notes" });
    expect(m.payload).not.toHaveProperty("text");
    valid(m.type, m.payload);
    const blankAuthor = mapEvent("note", { text: "x", author: "", origin: "airtable_projects_notes" });
    expect(blankAuthor.payload).not.toHaveProperty("author");
    expect(() => mapEvent("note", { text: " " })).toThrow();
  });

  it("estimate_sent / accepted / declined / lapsed carry camelCase money and keep the CSV keys", () => {
    const sent = mapEvent("estimate_sent", { total_cents: 2354201, quote_type: "Interior", airtable_status: "Won" });
    expect(sent.payload).toMatchObject({ totalCents: 2354201, channel: "link", total_cents: 2354201, quote_type: "Interior" });
    valid(sent.type, sent.payload);
    const acc = mapEvent("estimate_accepted", { total_cents: 2354201, quote_number: "2119", date_confidence: "high" });
    expect(acc.payload).toMatchObject({ totalCents: 2354201, dateConfidence: "high" });
    valid(acc.type, acc.payload);
    const dec = mapEvent("estimate_declined", { reason: "other", airtable_status: "Lost Other" });
    expect(dec.payload).toMatchObject({ reason: "other" });
    valid(dec.type, dec.payload);
    const lapsed = mapEvent("estimate_lapsed", { airtable_status: "Cold, no response", date_confidence: "low" });
    expect(lapsed.payload).toMatchObject({ dateConfidence: "low" });
    expect(lapsed.payload).not.toHaveProperty("totalCents");
    valid(lapsed.type, lapsed.payload);
  });

  it("account_created says via import; job events carry the PaintScout ref", () => {
    const a = mapEvent("account_created", { origin: "airtable_import", source: "", account_type: "residential" });
    expect(a.payload).toMatchObject({ via: "import" });
    valid(a.type, a.payload);
    const j = mapEvent("job_completed", { project_name: "61 Wheatland Road", quote_number: "795", invoice_total_cents: 169675 });
    expect(j.payload).toMatchObject({ workOrderNo: "PS-795" });
    valid(j.type, j.payload);
    const started = mapEvent("job_started", { project_name: "19 Valarian St", job_type: "" });
    expect(started.payload).not.toHaveProperty("workOrderNo");
    valid(started.type, started.payload);
  });

  it("an unknown kind is refused, never written", () => {
    expect(() => mapEvent("email_sent", {})).toThrow(/unknown event type/);
  });
});
