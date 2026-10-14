/**
 * The Materials block (payments-merge brief §4.6, Step 6), from the shape the
 * live data had on 12 Oct: six vendor rows for three suppliers, ten supplier
 * invoices filed as 'other', fifteen documents waiting with one duplicate.
 * (Supplier names are the paint companies themselves; job addresses are fictional.)
 */
import { describe, expect, it } from "vitest";
import {
  cleanSupplierName, isMaterialsCost, materialsView, supplierDirectory,
  type CostRow, type IntakeRow, type JobRef, type MaterialCostRow, type VendorRow,
} from "./materials";

const vendors: VendorRow[] = [
  { id: "v-dulux", name: "Dulux", senderDomains: ["dulux.com.au"], defaultCategory: "other" },
  { id: "v-dulux-au", name: "Dulux Australia", senderDomains: ["dulux.com.au"], defaultCategory: "other" },
  { id: "v-haymes", name: "Haymes Paint", senderDomains: ["haymes.com.au", "haymespaint.com.au"], defaultCategory: "other" },
  { id: "v-henry", name: "HENRY HAYMES PTY LTD", senderDomains: ["henryhaymes.com.au"], defaultCategory: "other" },
  { id: "v-henry-ta", name: "HENRY HAYMES PTY LTD Trading As Haymes Paint", senderDomains: ["haymes.com.au"], defaultCategory: "other" },
  { id: "v-scaffold", name: "Skyline Scaffolds", senderDomains: ["skyline.example"], defaultCategory: "scaffold" },
];
const materialCosts: MaterialCostRow[] = [
  { id: "m1", workOrderId: "wo-1", supplier: "Haymes Paint", amountCents: 50_000, intakeId: "i-old", overhead: null },
];
const jobs = new Map<string, JobRef>([
  ["wo-1", { workOrderId: "wo-1", estimateId: "e-1", address: "8 Kestrel Ct, Wonga Park", customer: "Kestrel", lane: "pre_start" }],
  ["wo-2", { workOrderId: "wo-2", estimateId: "e-2", address: "12 Wattle Ave, Aspendale", customer: "Wattle", lane: "in_progress" }],
]);
const cost = (id: string, over: Partial<CostRow>): CostRow => ({
  id, workOrderId: "wo-1", vendorId: "v-dulux", category: "other", status: "recorded", amountExCents: 10_000, gstCents: 1_000,
  docPath: `bills/${id}.pdf`, invoiceNo: `09${id}`, invoiceDate: "2026-10-09", intakeId: null, paidAt: null, createdAt: "2026-10-09T00:00:00Z", ...over,
});
const intake = (id: string, over: Partial<IntakeRow>): IntakeRow => ({
  id, status: "pending", confirmedAt: null, resultingId: null, createdAt: "2026-10-09T00:00:00Z", docPath: `bills/${id}.pdf`,
  fromEmail: "invoices@dulux.com.au", extractStatus: "extracted", supplier: "Dulux", invoiceNo: `INV${id}`, invoiceDate: "2026-10-09",
  totalCents: 5_000, orderRef: null, addressText: null, proposedWoId: null, proposedVendorId: null, duplicateOf: null, ...over,
});

const costs: CostRow[] = [
  cost("c1", {}),                                                       // Dulux, filed 'other' before Step 6
  cost("c2", { vendorId: "v-henry", amountExCents: 1_179, gstCents: 118 }), // Henry Haymes, 'other'
  cost("c3", { vendorId: "v-dulux-au", status: "approved", workOrderId: "wo-2" }),
  cost("c4", { vendorId: "v-dulux", status: "approved", category: "materials", workOrderId: "wo-2" }),
  cost("c5", { vendorId: "v-scaffold", category: "scaffold" }),         // other trades — never materials
  cost("c6", { status: "void" }),                                       // deleted, kept
  cost("c7", { category: "labour", vendorId: null }),
];
const intakes: IntakeRow[] = [
  intake("i1", { proposedWoId: "wo-1", orderRef: "8 Kestrel ct Wonga", totalCents: 2_466 }),
  intake("i2", { totalCents: 59_595, addressText: "Warick st" }),
  intake("i3", { fromEmail: "accounts@haymes.com.au", supplier: "HENRY HAYMES PTY LTD", totalCents: 774_101 }),
  intake("i4", { status: "duplicate", duplicateOf: "i9", totalCents: 4_217 }),
  intake("i5", { status: "rejected", confirmedAt: "2026-10-01T00:00:00Z", totalCents: 1_000 }),
  intake("i6", { fromEmail: "ar@ppg.example", supplier: "PPG INDUSTRIES AUSTRALIA PTY LTD", proposedWoId: "wo-2", totalCents: 495_395 }),
];
const view = materialsView({ vendors, intake: intakes, costs, materialCosts, jobs });

describe("one supplier, one name (§6.10)", () => {
  it("cleans what suppliers call themselves", () => {
    expect(cleanSupplierName("HENRY HAYMES PTY LTD Trading As Haymes Paint")).toBe("Haymes");
    expect(cleanSupplierName("PPG INDUSTRIES AUSTRALIA PTY LTD")).toBe("PPG");
    expect(cleanSupplierName("Dulux Australia")).toBe("Dulux");
    expect(cleanSupplierName("VIPONDS PAINTS PTY LTD")).toBe("Viponds");
  });
  it("vendor memory joins the six vendor rows into three suppliers", () => {
    const dir = supplierDirectory(vendors, materialCosts, costs);
    expect(["v-dulux", "v-dulux-au"].map(dir.vendorName)).toEqual(["Dulux", "Dulux"]);
    expect(["v-haymes", "v-henry", "v-henry-ta"].map(dir.vendorName)).toEqual(["Haymes", "Haymes", "Haymes"]);
    expect(dir.intakeName(intakes[2])).toBe("Haymes");                 // by its sender's domain
    expect(dir.intakeName(intakes[5])).toBe("PPG");                    // unknown sender: what it says, cleaned
  });
});

describe("supplier invoices are materials (§6.9)", () => {
  const dir = supplierDirectory(vendors, materialCosts, costs);
  it("'other' from a supplier that sells materials counts; other trades and labour never do", () => {
    expect(isMaterialsCost(costs[0], dir)).toBe(true);    // Dulux: a 'materials' cost exists in its group
    expect(isMaterialsCost(costs[1], dir)).toBe(true);    // Henry Haymes: the group has material_costs
    expect(isMaterialsCost(costs[4], dir)).toBe(false);   // scaffold
    expect(isMaterialsCost(costs[6], dir)).toBe(false);   // labour
  });
});

describe("the block (§4.6, §6.8)", () => {
  it("To check is the intake queue: waiting documents, a job-found one first, the duplicate last and uncounted", () => {
    expect(view.toCheck.map((r) => [r.id, r.state])).toEqual([["i1", "check"], ["i6", "check"], ["i2", "check"], ["i3", "check"], ["i4", "dup"]]);
    expect(view.toCheck[0]).toMatchObject({ supplier: "Dulux", reference: "8 Kestrel ct Wonga", job: { address: "8 Kestrel Ct, Wonga Park" } });
    expect(view.block).toMatchObject({ toCheckCount: 4, toCheckCents: 2_466 + 495_395 + 59_595 + 774_101 });
  });
  it("on a job to approve, approved to pay by supplier, deleted kept", () => {
    expect(view.toApprove.map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(view.toPay.map((g) => [g.supplier, g.rows.map((r) => r.id), g.totalCents])).toEqual([["Dulux", ["c3", "c4"], 22_000]]);
    expect(view.deleted.map((r) => r.key)).toEqual(["intake:i5", "cost:c6"]);
    expect(view.block).toMatchObject({ toApproveCount: 2, toApproveCents: 11_000 + 1_297, toPayCount: 2, toPayCents: 22_000 });
    expect(view.block.openCents).toBe(view.block.toCheckCents + view.block.toApproveCents + view.block.toPayCents);
  });
  it("open with each supplier, largest first", () => {
    expect(view.supplierTotals.map((s) => s.supplier)).toEqual(["Haymes", "PPG", "Dulux"]);
  });
  it("a document already confirmed into a cost is not waiting any more", () => {
    const v = materialsView({ vendors, intake: [intake("ix", {})], costs: [cost("cx", { intakeId: "ix", category: "materials" })], materialCosts, jobs });
    expect(v.toCheck).toEqual([]);
    expect(v.toApprove.map((r) => r.id)).toEqual(["cx"]);
  });
});

describe("No job yet (8c): the old \"Materials without a job\", the home tile's own rule", () => {
  it("lists materials with no job and not overhead, newest first; overhead and matched rows stay off", () => {
    const v = materialsView({ vendors, intake: [], costs: [], jobs, materialCosts: [
      { id: "n1", workOrderId: null, supplier: "HENRY HAYMES PTY LTD", amountCents: 14_347, intakeId: null, overhead: null, orderRef: "PG-0123", createdAt: "2026-10-01T00:00:00Z" },
      { id: "n2", workOrderId: null, supplier: "Dulux", amountCents: 2_990, intakeId: null, overhead: null, addressText: "12 Kite St", createdAt: "2026-10-05T00:00:00Z" },
      { id: "o1", workOrderId: null, supplier: "Dulux", amountCents: 9_999, intakeId: null, overhead: true, createdAt: "2026-10-06T00:00:00Z" },
      { id: "m1", workOrderId: "wo-1", supplier: "Dulux", amountCents: 5_000, intakeId: null, overhead: null, createdAt: "2026-10-07T00:00:00Z" },
    ] });
    expect(v.noJob.map((r) => r.id)).toEqual(["n2", "n1"]);
    expect(v.noJob[1]).toMatchObject({ reference: "PG-0123", amountCents: 14_347 });
    expect(v.block.noJobCount).toBe(2);
    expect(v.block.noJobCents).toBe(14_347 + 2_990);
    expect(v.block.openCents).toBe(v.block.toCheckCents + v.block.toApproveCents + v.block.toPayCents);   // recorded costs, nothing to pay
  });
});

describe("To check keeps the GST read and the order-reference confidence (Tom, 13 Oct)", () => {
  it("confidence only when the job came from the order reference; GST as read", () => {
    const v = materialsView({ vendors, costs: [], materialCosts: [], jobs, intake: [
      intake("r1", { gstCents: 455, matchReason: "order_ref", refConfidence: 0.924 }),
      intake("r2", { gstCents: null, matchReason: "address", refConfidence: 0.99 }),
    ] });
    const r = (id: string) => v.toCheck.find((x) => x.id === id)!;
    expect(r("r1")).toMatchObject({ gstCents: 455, confidencePct: 92 });
    expect(r("r2")).toMatchObject({ gstCents: null, confidencePct: null });
  });
});
