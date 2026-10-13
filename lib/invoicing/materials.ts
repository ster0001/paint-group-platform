/**
 * The Materials block (payments-merge brief §4.6, Step 6). Pure: rows in,
 * the block's lists and totals out — no database, no clock beyond `now`.
 *
 * Three rules live here and nowhere else:
 *
 *   1. ONE SUPPLIER, ONE NAME (§6.10). Vendor memory already knows which
 *      vendors are the same company: they send from the same email domain.
 *      Vendors that share a domain (or clean to the same name) are one
 *      supplier, shown under the shortest clean name among them —
 *      "Dulux" / "Dulux Australia" → Dulux; "Haymes Paint" / "HENRY HAYMES
 *      PTY LTD" → Haymes. No vendor row is renamed.
 *   2. SUPPLIER INVOICES ARE MATERIALS (§6.9). A job cost is materials when
 *      its category is 'materials' (every confirm from Step 6 on), or when it
 *      was filed as 'other' by a supplier vendor memory knows sells materials.
 *      The rows filed as 'other' before Step 6 are not re-categorised.
 *   3. THE BLOCK COUNTS THE QUEUE (§6.8). "To check" is the intake queue —
 *      every document still waiting for a person — so the count can never say
 *      0 while documents wait.
 */

export type VendorRow = { id: string; name: string; senderDomains: readonly string[]; defaultCategory: string };

export type IntakeRow = {
  id: string;
  status: string;            // pending | confirmed | rejected | duplicate
  confirmedAt: string | null;
  resultingId: string | null;
  createdAt: string;
  docPath: string | null;
  fromEmail: string;
  extractStatus: string;
  supplier: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  totalCents: number | null;
  orderRef: string | null;
  addressText: string | null;
  proposedWoId: string | null;
  proposedVendorId: string | null;
  duplicateOf: string | null;
};

export type CostRow = {
  id: string;
  workOrderId: string;
  vendorId: string | null;
  category: string;
  status: string;            // recorded | approved | paid | void
  amountExCents: number;
  gstCents: number;
  docPath: string | null;
  invoiceNo: string;
  invoiceDate: string | null;
  intakeId: string | null;
  paidAt: string | null;
  createdAt: string;
};

/** material_costs — Airtable and older confirms; no approve/pay flow. Used to know who sells materials, and for overhead. */
export type MaterialCostRow = { id: string; workOrderId: string | null; supplier: string; amountCents: number; intakeId: string | null; overhead: boolean | null };

export type JobRef = { workOrderId: string; estimateId: string; address: string; customer: string | null; lane: string };

// ---- 1. one supplier, one name --------------------------------------------------------

const SUFFIXES = /\b(pty\.?|ltd\.?|limited|proprietary|australia|aust|industries|group|co\.?|company|inc\.?|paints?|coatings)\b/gi;

/** "HENRY HAYMES PTY LTD Trading As Haymes Paint" → "Haymes"; "PPG INDUSTRIES AUSTRALIA PTY LTD" → "PPG". */
export function cleanSupplierName(raw: string): string {
  let s = raw.trim();
  const ta = s.match(/\b(?:trading as|t\/as|t\/a)\b\s*(.+)$/i);
  if (ta) s = ta[1];
  s = s.replace(SUFFIXES, " ").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return raw.trim();
  // ALL CAPS reads as shouting; keep short acronyms (PPG) as they are.
  if (s === s.toUpperCase() && s.length > 4) s = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return s;
}

const domainOf = (email: string) => email.split("@")[1]?.trim().toLowerCase() ?? "";

export type SupplierDirectory = {
  /** The one name for a vendor. */
  vendorName: (vendorId: string | null) => string | null;
  /** The one name for an intake document: its proposed vendor, else its sender's domain, else what it says. */
  intakeName: (row: IntakeRow) => string;
  /** Vendor memory says this vendor sells materials. */
  isMaterialsVendor: (vendorId: string | null) => boolean;
};

export function supplierDirectory(vendors: readonly VendorRow[], materialCosts: readonly MaterialCostRow[], costs: readonly CostRow[]): SupplierDirectory {
  // Union-find over vendors: same sender domain, or the same clean name.
  const parent = new Map<string, string>(vendors.map((v) => [v.id, v.id]));
  const find = (id: string): string => { const p = parent.get(id)!; if (p === id) return id; const r = find(p); parent.set(id, r); return r; };
  const join = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const byKey = new Map<string, string>();
  for (const v of vendors) {
    for (const key of [...v.senderDomains.map((d) => `d:${d.toLowerCase()}`), `n:${cleanSupplierName(v.name).toLowerCase()}`]) {
      const seen = byKey.get(key);
      if (seen) join(seen, v.id); else byKey.set(key, v.id);
    }
  }
  // A clean name standing whole inside another is the same supplier ("Haymes" in "Henry Haymes").
  const clean = vendors.map((v) => ({ id: v.id, n: cleanSupplierName(v.name).toLowerCase() }));
  for (const a of clean) for (const b of clean) {
    if (a.id !== b.id && a.n.length >= 4 && a.n !== b.n && new RegExp(`\\b${a.n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(b.n)) join(a.id, b.id);
  }
  const members = new Map<string, VendorRow[]>();
  for (const v of vendors) { const r = find(v.id); members.set(r, [...(members.get(r) ?? []), v]); }
  const nameOfRoot = new Map<string, string>();
  for (const [root, vs] of members) {
    nameOfRoot.set(root, vs.map((v) => cleanSupplierName(v.name)).sort((a, b) => a.length - b.length || a.localeCompare(b))[0]);
  }
  // Who sells materials: a vendor in a group that has material_costs, a 'materials' cost, or learnt 'materials'.
  const materialNames = new Set(materialCosts.map((m) => cleanSupplierName(m.supplier).toLowerCase()));
  const materialRoots = new Set<string>();
  for (const [root, vs] of members) {
    if (vs.some((v) => v.defaultCategory === "materials" || materialNames.has(cleanSupplierName(v.name).toLowerCase()))) materialRoots.add(root);
  }
  for (const c of costs) if (c.category === "materials" && c.vendorId && parent.has(c.vendorId)) materialRoots.add(find(c.vendorId));
  const rootOfDomain = new Map<string, string>();
  for (const v of vendors) for (const d of v.senderDomains) rootOfDomain.set(d.toLowerCase(), find(v.id));

  return {
    vendorName: (id) => (id && parent.has(id) ? nameOfRoot.get(find(id)) ?? null : null),
    intakeName: (row) => {
      if (row.proposedVendorId && parent.has(row.proposedVendorId)) return nameOfRoot.get(find(row.proposedVendorId))!;
      const root = rootOfDomain.get(domainOf(row.fromEmail));
      if (root) return nameOfRoot.get(root)!;
      return row.supplier ? cleanSupplierName(row.supplier) : "Unknown supplier";
    },
    isMaterialsVendor: (id) => !!id && parent.has(id) && materialRoots.has(find(id)),
  };
}

/** Rule 2: a job cost that is materials. Labour and voided rows never are. */
export function isMaterialsCost(c: CostRow, dir: SupplierDirectory): boolean {
  if (c.category === "materials") return true;
  return c.category === "other" && dir.isMaterialsVendor(c.vendorId);
}

// ---- 3. the block -------------------------------------------------------------------------

export type MatState = "check" | "dup" | "rec" | "appr" | "paid" | "del";
export type MatRow = {
  /** "intake:<id>" or "cost:<id>" — what the row's actions act on. */
  key: string;
  kind: "intake" | "cost";
  id: string;
  state: MatState;
  supplier: string;
  invoiceNo: string | null;
  invoiceDate: string | null;
  /** What the supplier wrote as the reference (order ref, else the address on the invoice). */
  reference: string | null;
  job: JobRef | null;
  overhead: boolean;
  amountCents: number;
  docPath: string | null;
  /** The extraction failed — the amount is unread, so it can't be confirmed in one press. */
  unread: boolean;
};

export type SupplierGroupRow = { supplier: string; rows: MatRow[]; totalCents: number; jobs: string[] };

export type MaterialsView = {
  toCheck: MatRow[];
  toApprove: MatRow[];
  toPay: SupplierGroupRow[];
  paid: MatRow[];
  deleted: MatRow[];
  /** "open with each supplier": to check + to approve + to pay. */
  supplierTotals: { supplier: string; openCents: number }[];
  /** Every job cost this rule counts as materials (not voided) — the job panel's Materials line uses the same set. */
  costIds: string[];
  block: { toCheckCents: number; toCheckCount: number; toApproveCents: number; toApproveCount: number; toPayCents: number; toPayCount: number; openCents: number };
};

export type MaterialsInput = {
  vendors: readonly VendorRow[];
  intake: readonly IntakeRow[];
  costs: readonly CostRow[];
  materialCosts: readonly MaterialCostRow[];
  /** Job by work order — the Payments rows' own address and stage. */
  jobs: ReadonlyMap<string, JobRef>;
};

const sum = (rows: readonly MatRow[]) => rows.reduce((s, r) => s + r.amountCents, 0);

export function materialsView(input: MaterialsInput): MaterialsView {
  const dir = supplierDirectory(input.vendors, input.materialCosts, input.costs);
  const jobOf = (wo: string | null) => (wo ? input.jobs.get(wo) ?? null : null);
  const materials = input.costs.filter((c) => isMaterialsCost(c, dir));
  const costByIntake = new Map(input.costs.filter((c) => c.intakeId).map((c) => [c.intakeId!, c]));

  const intakeRow = (r: IntakeRow, state: MatState): MatRow => ({
    key: `intake:${r.id}`, kind: "intake", id: r.id, state,
    supplier: dir.intakeName(r), invoiceNo: r.invoiceNo, invoiceDate: r.invoiceDate,
    reference: r.orderRef || r.addressText || null, job: jobOf(r.proposedWoId), overhead: false,
    amountCents: state === "dup" ? 0 : r.totalCents ?? 0, docPath: r.docPath, unread: r.extractStatus === "failed" || r.totalCents === null,
  });
  const costRow = (c: CostRow, state: MatState): MatRow => {
    const intake = c.intakeId ? input.intake.find((i) => i.id === c.intakeId) ?? null : null;
    return {
      key: `cost:${c.id}`, kind: "cost", id: c.id, state,
      supplier: dir.vendorName(c.vendorId) ?? (intake ? dir.intakeName(intake) : "Supplier"),
      invoiceNo: c.invoiceNo || null, invoiceDate: c.invoiceDate,
      reference: intake ? intake.orderRef || intake.addressText || null : null,
      job: jobOf(c.workOrderId), overhead: false,
      amountCents: c.amountExCents + c.gstCents, docPath: c.docPath, unread: false,
    };
  };

  const waiting = input.intake.filter((r) => r.resultingId === null && !costByIntake.has(r.id));
  const toCheck = [
    ...waiting.filter((r) => r.status === "pending").map((r) => intakeRow(r, "check")),
    ...waiting.filter((r) => r.status === "duplicate" && r.confirmedAt === null).map((r) => intakeRow(r, "dup")),
  ].sort((a, b) => Number(!!b.job) - Number(!!a.job) || (a.state === "dup" ? 1 : 0) - (b.state === "dup" ? 1 : 0));
  const toApprove = materials.filter((c) => c.status === "recorded").map((c) => costRow(c, "rec"));
  const approved = materials.filter((c) => c.status === "approved").map((c) => costRow(c, "appr"));
  const paid = materials.filter((c) => c.status === "paid").map((c) => costRow(c, "paid"))
    .sort((a, b) => (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? ""));
  const deleted = [
    ...waiting.filter((r) => r.status === "rejected" || (r.status === "duplicate" && r.confirmedAt !== null)).map((r) => intakeRow(r, "del")),
    ...materials.filter((c) => c.status === "void").map((c) => costRow(c, "del")),
  ];

  const suppliers = [...new Set(approved.map((r) => r.supplier))];
  const toPay: SupplierGroupRow[] = suppliers.map((supplier) => {
    const rows = approved.filter((r) => r.supplier === supplier);
    return { supplier, rows, totalCents: sum(rows), jobs: [...new Set(rows.map((r) => (r.job ? r.job.address.split(",")[0] : "Overhead")))] };
  });

  const checking = toCheck.filter((r) => r.state === "check");
  const open = [...checking, ...toApprove, ...approved];
  const supplierTotals = [...new Set(open.map((r) => r.supplier))]
    .map((supplier) => ({ supplier, openCents: sum(open.filter((r) => r.supplier === supplier)) }))
    .sort((a, b) => b.openCents - a.openCents);

  const block = {
    toCheckCents: sum(checking), toCheckCount: checking.length,
    toApproveCents: sum(toApprove), toApproveCount: toApprove.length,
    toPayCents: sum(approved), toPayCount: approved.length,
    openCents: 0,
  };
  block.openCents = block.toCheckCents + block.toApproveCents + block.toPayCents;
  return { toCheck, toApprove, toPay, paid, deleted, supplierTotals, block, costIds: materials.filter((c) => c.status !== "void").map((c) => c.id) };
}

/** The amount on a list of rows — section headers. */
export const totalMatCents = (rows: readonly MatRow[]): number => sum(rows);
