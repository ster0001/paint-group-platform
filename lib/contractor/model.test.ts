/**
 * Compliance state as the screens compute it.
 *
 * `docState` exists because the stored `status` column goes stale: the database
 * stamps it when a document row changes, so a certificate that lapses while
 * sitting untouched keeps reading "valid". Everything a contractor or a
 * scheduler sees must go through here instead.
 */
import { test, expect, vi, afterEach } from "vitest";
import { docState, daysUntil, missingProfileFields, type ContractorDoc } from "./model.ts";

afterEach(() => vi.useRealTimers());

const TODAY = new Date("2026-09-01T10:00:00+10:00");

const doc = (over: Partial<ContractorDoc> = {}): ContractorDoc => ({
  id: "d1",
  contractor_id: "c1",
  kind: "insurance",
  name: "public-liability.pdf",
  file_url: "c1/public-liability.pdf",
  expires_on: "2027-01-01",
  status: "valid", // deliberately wrong in some tests — nothing should trust it
  created_at: "2026-08-01T00:00:00Z",
  verified_at: "2026-08-02T00:00:00Z",
  verify_note: "",
  ...over,
});

test("a verified, unexpired certificate is valid", () => {
  vi.setSystemTime(TODAY);
  expect(docState(doc())).toBe("valid");
});

test("uploaded but unverified is NOT compliance — a human has to read it", () => {
  vi.setSystemTime(TODAY);
  expect(docState(doc({ verified_at: null }))).toBe("pending");
});

test("a row with no file is pending, however it is stamped", () => {
  vi.setSystemTime(TODAY);
  expect(docState(doc({ file_url: "", status: "valid" }))).toBe("pending");
});

test("THE STALE-STATUS CASE: a lapsed certificate reads as expired even when the column still says valid", () => {
  vi.setSystemTime(TODAY);
  // Nothing has written to this row since it was uploaded, so `status` is a lie.
  expect(docState(doc({ expires_on: "2026-08-31", status: "valid" }))).toBe("expired");
});

test("expiry is judged by date, not by the moment", () => {
  vi.setSystemTime(TODAY);
  expect(docState(doc({ expires_on: "2026-09-01" }))).toBe("valid"); // expires today, still covered
  expect(docState(doc({ expires_on: "2026-08-31" }))).toBe("expired");
});

test("an expired certificate is expired before it is unverified", () => {
  vi.setSystemTime(TODAY);
  expect(docState(doc({ expires_on: "2026-08-01", verified_at: null }))).toBe("expired");
});

test("a document with no expiry never lapses", () => {
  vi.setSystemTime(TODAY);
  expect(docState(doc({ kind: "licence", expires_on: null }))).toBe("valid");
});

test("daysUntil counts forward and back from today", () => {
  vi.setSystemTime(TODAY);
  expect(daysUntil("2026-09-01")).toBe(0);
  expect(daysUntil("2026-09-08")).toBe(7);
  expect(daysUntil("2026-08-25")).toBe(-7);
  expect(daysUntil(null)).toBeNull();
});

test("daysUntil is not thrown off by the daylight-saving change", () => {
  // Melbourne clocks go forward on 4 October 2026: a 23-hour day that naive
  // millisecond division rounds to the wrong number.
  vi.setSystemTime(new Date("2026-10-01T10:00:00+10:00"));
  expect(daysUntil("2026-10-08")).toBe(7);
  expect(daysUntil("2026-10-05")).toBe(4);
});

test("the profile is incomplete until a contractor can actually be paid", () => {
  expect(missingProfileFields(null)).toEqual(["company details"]);
  expect(missingProfileFields({})).toEqual(["company name", "ABN", "business address", "bank details"]);
  expect(
    missingProfileFields({
      company_name: "Kovac Painting Pty Ltd",
      abn: "12 345 678 901",
      address: "1 Smith St, Coburg VIC 3058",
      bank_bsb: "083-004",
    }),
  ).toEqual([]);
});

test("whitespace is not a filled-in field", () => {
  expect(missingProfileFields({ company_name: "   ", abn: " ", address: "", bank_bsb: null }))
    .toEqual(["company name", "ABN", "business address", "bank details"]);
});
