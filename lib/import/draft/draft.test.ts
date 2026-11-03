import { describe, expect, it } from "vitest";
import { parseQuoteText } from "./quote-text";
import { buildDraftFromWorkOrder, jobSideOf, type NameMapRow } from "./build";
import { parseWorkOrderText } from "@/lib/import/booked/workorder-text";
import type { PricingContext } from "@/lib/pricing/estimate";

/**
 * Tom, 4 Nov 2026: a PaintScout job as an EDITABLE draft priced by this
 * system's rate card. Synthetic pages only (no real customer in the repo).
 */
const QUOTE = `Accept Estimate
Estimate Total
$9,900.00
Contact
About Us
Paint Group
1 Office Rd
Testville, VIC 3000
Estimate
Contact
Casey Example
Robin Example
Example Owners Corporation Management
10 Agent St
Sampletown, VIC 3001
casey@example.com
robin@example.com
0400 000 111
Job Address
12 Sample St
Exampleton, VIC 3183
Estimate ID
9001
Date
Exclusions
Please find below a list of all items excluded from the quote as discussed:
Balustrades
Gutters
Client Responsibilities
Move furniture
`;

const WO = `Hours
21
Work Order
Estimate ID
9001
Total Hours
21
Product Description
Dulux Weathershield  (Estimated: 10 Litre - $230.00)
Areas
Exterior Preparation
hr
Total
Scaffolding
hr
Total
Painting: 3
=
3
Front Side
(10'x6')
hr
Fascias (10m)
Fascias 2 Coats
Dulux Weathershield  - 2.00 Litre - $46.00
Coats: 2
\t
4
Windows (3)
Windows 2 Coats
Dulux Weathershield  - 3.00 Litre - $69.00
Coats: 2
\t
6
Communal Windows (1)
Windows 2 Coats
Dulux Weathershield  - 2.00 Litre - $46.00
Coats: 2
\t
4
Mystery Item (2)
Coats: 2
\t
4
Total
Painting: 18
=
18
`;

const item = (code: string, unit: string, extra: Record<string, unknown> = {}) => ({
  code, category: "Exterior", unit, rate_1_coat: 10, rate_2_coat: 8, rate_3_coat: 6, default_coats: 2, charge_out_cents: 10000,
  default_product: "Dulux Weathershield", metres_per_litre: 10, litres_per_item_per_coat: 0.5, ...extra,
});
const CTX: PricingContext = {
  rateItems: [item("Fascias", "Lineal Metres"), item("Awning / Casement Window", "Hours Per Item", { sub_category: "Windows" })],
  products: [{ name: "Dulux Weathershield", type: "Exterior", coverage: 12, price_per_litre: 2300, wastage_pct: 10 }],
  modifiers: [{ code: "FIN-3", group_name: "Level of Finish", multiplier: 1 }],
  settings: [],
} as unknown as PricingContext;
const MAP: NameMapRow[] = [
  { paintscout_item: "Fascias", side: "exterior", platform_rate_code: "Fascias" },
  { paintscout_item: "Windows", side: "exterior", platform_rate_code: "Awning / Casement Window" },
];

describe("parseQuoteText", () => {
  const q = parseQuoteText(QUOTE);
  it("reads the customer, the company, the job address, the exclusions and PaintScout's total", () => {
    expect(q.quoteNo).toBe("9001");
    expect(q.names).toEqual(["Casey Example", "Robin Example"]);
    expect(q.company).toBe("Example Owners Corporation Management");
    expect(q.emails).toEqual(["casey@example.com", "robin@example.com"]);
    expect(q.phones).toEqual(["0400 000 111"]);
    expect(q.contactAddress).toEqual({ street: "10 Agent St", suburb: "Sampletown", state: "VIC", postcode: "3001" });
    expect(q.jobAddress).toEqual({ street: "12 Sample St", suburb: "Exampleton", state: "VIC", postcode: "3183" });
    expect(q.exclusions).toEqual(["Balustrades", "Gutters"]);
    expect(q.totalCents).toBe(990000);
  });
  it("leaves what it cannot read blank instead of guessing", () => {
    const empty = parseQuoteText("nothing here");
    expect(empty).toMatchObject({ quoteNo: null, names: [], jobAddress: null, exclusions: [], totalCents: null });
  });
});

describe("buildDraftFromWorkOrder", () => {
  const wo = parseWorkOrderText(WO);
  const q = parseQuoteText(QUOTE);
  const d = buildDraftFromWorkOrder(wo, q, CTX, MAP);
  const areas = d.builderState.blocks.filter((b) => b.kind === "area");
  const lines = d.builderState.blocks.filter((b) => b.kind === "line");

  it("is an exterior job, priced by the engine — no price, hours or materials overrides anywhere", () => {
    expect(jobSideOf(wo)).toBe("Exterior");
    for (const a of areas) for (const s of a.surfaces) {
      expect(s.priceOverride).toBeNull();
      expect(s.paintingHrOverride).toBeNull();
      expect(s.volumeOverride).toBeNull();
      expect(s.unitPriceOverride).toBeNull();
    }
    expect(d.totals.totalCents).toBeGreaterThan(0);
  });

  it("maps lines to rate codes with their quantities and coats; a communal window is a large window", () => {
    const front = areas.find((a) => a.name === "Front Side")!;
    expect(front.type).toBe("Exterior");
    expect(front.areaType).toBe("surface");
    expect(front.surfaces.map((s) => [s.code, s.qtyOverride, s.count, s.coats, s.size])).toEqual([
      ["Fascias", 10, 1, 2, null],
      ["Awning / Casement Window", null, 3, 2, null],
      ["Awning / Casement Window", null, 1, 2, "large"],
    ]);
  });

  it("hours with no lines, and a line with no rate code, become hourly lines at the platform's charge-out rate", () => {
    expect(lines.map((l) => [l.name, l.mode, l.hours, l.rate])).toEqual([
      ["Scaffolding", "hourly", 3, 100],
      ["Front Side · Mystery Item", "hourly", 4, 100],
    ]);
    expect(d.report.some((r) => r.startsWith("Exterior Preparation: a heading"))).toBe(true);
  });

  it("carries the customer, the job address, the exclusions, the finish and the paint choice for the builder", () => {
    expect(d.title).toBe("12 Sample St, Exampleton");
    expect(d.builderState.contact).toMatchObject({ first_name: "Casey", last_name: "Example", company: "Example Owners Corporation Management", email: "casey@example.com", phone: "0400 000 111", secondary_name: "Robin Example", secondary_email: "robin@example.com" });
    expect(d.builderState.jobAddress).toEqual({ address: "12 Sample St", city: "Exampleton", state: "VIC", postal: "3183" });
    expect(d.builderState.exclusions).toEqual(["Balustrades", "Gutters"]);
    expect(d.builderState.modSel).toEqual({ "Level of Finish": "FIN-3" });
    expect(d.builderState.materials).toEqual({ "Exterior::Fascias": "Dulux Weathershield", "Exterior::Awning / Casement Window": "Dulux Weathershield" });
    expect(String(d.builderState.adminNotes)).toMatch(/PaintScout quote 9001.*\$9900\.00/);
  });
});
