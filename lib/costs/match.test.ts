import { describe, expect, it } from "vitest";
import { matchJob, type MatchJob, type MatchVendor } from "./match";

const JOBS: MatchJob[] = [
  { woId: "wo-1", jobNo: 87, woRef: "WO-AB12CD34", address: "12 Ellerslie Grove, Elsternwick VIC 3185" },
  { woId: "wo-2", jobNo: 88, woRef: "WO-EF56GH78", address: "4 Barkly St, Brunswick VIC 3056" },
  { woId: "wo-3", jobNo: 90, woRef: "WO-ZZ99YY88", address: "90 Tennyson St, Elwood" },
];

const VENDORS: MatchVendor[] = [
  { id: "v-sky", name: "SkyReach Hire", senderDomains: ["skyreach.com.au"] },
];

describe("the matching ladder — strict order, never a guess", () => {
  it("1. exact order reference wins over everything", () => {
    const m = matchJob(
      { order_ref: "PG-0087", address_text: "4 Barkly St, Brunswick" },
      "some text", "accounts@skyreach.com.au", JOBS, VENDORS,
    );
    expect(m).toEqual({ woId: "wo-1", vendorId: "v-sky", reason: "order_ref" });
  });

  it("a WO ref is also exact", () => {
    const m = matchJob({ job_hints: ["WO-EF56GH78"] }, "", "", JOBS, VENDORS);
    expect(m.woId).toBe("wo-2");
    expect(m.reason).toBe("order_ref");
  });

  it("a PG number no job carries falls through", () => {
    const m = matchJob({ order_ref: "PG-3" }, "", "", JOBS, VENDORS);
    expect(m.woId).toBeNull();
  });

  it("2a. a street-only reference field matches its single job (the Haymes LESLIE ST shape)", () => {
    const jobs: MatchJob[] = [
      ...JOBS,
      { woId: "wo-5", jobNo: 92, woRef: "WO-LL55MM66", address: "7 Leslie St, Brighton VIC" },
    ];
    const m = matchJob({ order_ref: "LESLIE ST", job_hints: ["LESLIE ST"] }, "", "", jobs, VENDORS);
    expect(m.woId).toBe("wo-5");
    expect(m.reason).toBe("address");
  });

  it("2a. a street-only reference shared by two jobs proposes nothing from that rung", () => {
    const jobs: MatchJob[] = [
      ...JOBS,
      { woId: "wo-5", jobNo: 92, woRef: "WO-LL55MM66", address: "7 Leslie St, Brighton" },
      { woId: "wo-6", jobNo: 93, woRef: "WO-NN77PP88", address: "22 Leslie St, Brighton" },
    ];
    const m = matchJob({ order_ref: "LESLIE ST" }, "", "", jobs, VENDORS);
    expect(m.woId).toBeNull();
  });

  it("2a. a numbered reference must agree on the number", () => {
    const jobs: MatchJob[] = [
      ...JOBS,
      { woId: "wo-5", jobNo: 92, woRef: "WO-LL55MM66", address: "7 Leslie St, Brighton" },
      { woId: "wo-6", jobNo: 93, woRef: "WO-NN77PP88", address: "22 Leslie St, Brighton" },
    ];
    const m = matchJob({ order_ref: "22 LESLIE ST" }, "", "", jobs, VENDORS);
    expect(m.woId).toBe("wo-6");
  });

  it("2. address match needs number AND street, exactly one job", () => {
    const m = matchJob(
      { address_text: "Deliver to 12 Ellerslie Grove Elsternwick" },
      "", "orders@dulux.com.au", JOBS, VENDORS,
    );
    expect(m).toEqual({ woId: "wo-1", vendorId: null, reason: "address" });
  });

  it("the whole text is the address fallback", () => {
    const m = matchJob({}, "scaffold erected at 4 Barkly St Brunswick as agreed", "", JOBS, VENDORS);
    expect(m.woId).toBe("wo-2");
    expect(m.reason).toBe("address");
  });

  it("a street number alone is never enough", () => {
    const m = matchJob({}, "invoice for 12 units delivered", "", JOBS, VENDORS);
    expect(m.woId).toBeNull();
  });

  it("an ambiguous address proposes nothing", () => {
    const jobs: MatchJob[] = [
      ...JOBS,
      { woId: "wo-4", jobNo: 91, woRef: "WO-QQ11WW22", address: "12 Ellerslie Grove, Elsternwick (unit 2)" },
    ];
    const m = matchJob({ address_text: "12 Ellerslie Grove Elsternwick" }, "", "", jobs, VENDORS);
    expect(m.woId).toBeNull();
    expect(m.reason).toBe("none");
  });

  it("3. vendor memory prefills the vendor, job stays unmatched", () => {
    const m = matchJob({}, "hire charges attached", "billing@skyreach.com.au", JOBS, VENDORS);
    expect(m).toEqual({ woId: null, vendorId: "v-sky", reason: "vendor_memory" });
  });

  it("4. unknown sender, no ref, no address — unmatched", () => {
    const m = matchJob({}, "hello", "noreply@unknown.example", JOBS, VENDORS);
    expect(m).toEqual({ woId: null, vendorId: null, reason: "none" });
  });
});
