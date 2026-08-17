/**
 * The privacy gate.
 *
 * The workflow spec is absolute: a contractor sees the suburb only until they
 * have committed to the job, and the redaction happens on the SERVER so the
 * street address is never sent to their browser at all. `toJob` is where that
 * happens, and `committedIds` is what decides which side of the line a job
 * falls on.
 *
 * These are the tests to keep if all the others were deleted — everything else
 * in this repo can be wrong in a way that costs money; this can be wrong in a
 * way that hands a customer's home address to someone who was only asked about
 * the job.
 */
import { test, expect } from "vitest";
import { toJob, committedIds, type Row } from "./jobs.ts";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";

const ADDRESS = "12 Baker Street, Richmond VIC 3121";

const doc: WorkOrderDoc = {
  version: 1,
  woRef: "WO-1042",
  status: "issued",
  jobTitle: "Whitfield - interior repaint",
  jobAddress: ADDRESS,
  contactFirstName: "Sarah",
  contactPhone: "0400 123 456",
  startDate: "2026-09-01",
  accessNotes: "Key in lockbox",
  crewNotes: "",
  levelOfFinish: "Level 3",
  finishCode: "PG-3",
  contractorName: "Kovac Painting",
  contractorPaymentCents: 160139,
  materials: [],
  areas: [],
  exclusions: [],
  company: { name: "Paint Group", phone: "", logoUrl: "" },
};

const row = (over: Partial<Row> = {}): Row => ({
  id: "wo-1",
  wo_ref: "WO-1042",
  status: "issued",
  start_date: "2026-09-02",
  issued_at: "2026-08-20T00:00:00Z",
  viewed_at: null,
  contractor_payment_cents: 160139,
  wo_snapshot: doc,
  ...over,
});

// ---- redaction --------------------------------------------------------------

test("before committing, the street address and contact are gone entirely", () => {
  const job = toJob(row(), false);
  expect(job.doc?.jobAddress).toBe("Richmond");
  expect(job.doc?.contactFirstName).toBe("");
  expect(job.doc?.contactPhone).toBe("");

  // Not merely absent from a field we happened to check — absent from the whole
  // object, which is what gets serialised into the page.
  const serialised = JSON.stringify(job);
  expect(serialised).not.toContain("Baker Street");
  expect(serialised).not.toContain("0400 123 456");
  expect(serialised).not.toContain("Sarah");
});

test("after committing, the contractor gets what they need to turn up", () => {
  const job = toJob(row(), true);
  expect(job.doc?.jobAddress).toBe(ADDRESS);
  expect(job.doc?.contactFirstName).toBe("Sarah");
  expect(job.doc?.contactPhone).toBe("0400 123 456");
});

test("redaction does not disturb the rest of the document", () => {
  const job = toJob(row(), false);
  expect(job.doc?.woRef).toBe("WO-1042");
  expect(job.doc?.finishCode).toBe("PG-3");
  expect(job.doc?.accessNotes).toBe("Key in lockbox");
  expect(job.paymentCents).toBe(160139); // their own pay, which they may see
});

test("an address the parser doesn't recognise falls back rather than leaking", () => {
  const job = toJob(row({ wo_snapshot: { ...doc, jobAddress: "12 Baker Street" } }), false);
  expect(job.doc?.jobAddress).toBe("Location on acceptance");
  expect(JSON.stringify(job)).not.toContain("Baker");
});

test("the live status and start date win over the frozen snapshot", () => {
  const job = toJob(row({ status: "in_progress", start_date: "2026-09-05" }), true);
  expect(job.doc?.status).toBe("in_progress");
  expect(job.doc?.startDate).toBe("2026-09-05");
});

test("a snapshot of an unknown version is treated as missing, not rendered half-formed", () => {
  expect(toJob(row({ wo_snapshot: { version: 2, jobAddress: ADDRESS } }), true).doc).toBeNull();
  expect(toJob(row({ wo_snapshot: null }), true).doc).toBeNull();
  // And an unreadable snapshot still can't leak the address it contained.
  expect(JSON.stringify(toJob(row({ wo_snapshot: { version: 2, jobAddress: ADDRESS } }), false)))
    .not.toContain("Baker Street");
});

// ---- who counts as committed ------------------------------------------------

test("an accepted offer commits the job", () => {
  expect(committedIds(["a"], [{ work_order_id: "a", state: "accepted" }]).has("a")).toBe(true);
});

test("a job with no offer at all is committed — staff assigned it directly", () => {
  expect(committedIds(["a"], []).has("a")).toBe(true);
});

test("every unsettled or refused offer leaves the job redacted", () => {
  for (const state of ["offered", "proposed", "declined", "expired", "withdrawn", "cancelled"]) {
    expect(committedIds(["a"], [{ work_order_id: "a", state }]).has("a")).toBe(false);
  }
});

test("a declined offer followed by an accepted one is committed", () => {
  const ids = committedIds(["a"], [
    { work_order_id: "a", state: "declined" },
    { work_order_id: "a", state: "accepted" },
  ]);
  expect(ids.has("a")).toBe(true);
});

test("one job's acceptance does not commit another", () => {
  const ids = committedIds(["a", "b"], [
    { work_order_id: "a", state: "accepted" },
    { work_order_id: "b", state: "offered" },
  ]);
  expect(ids.has("a")).toBe(true);
  expect(ids.has("b")).toBe(false);
});
