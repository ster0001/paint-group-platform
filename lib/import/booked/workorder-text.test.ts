import { describe, expect, it } from "vitest";
import { parseWorkOrderText } from "./workorder-text";

/**
 * A PaintScout work-order share page as `document.body.innerText` gives it,
 * with a made-up customer. The shape is the real one (quotes 3613, 3639 and
 * 3688, 22 Sep 2026): a heading with neither lines nor hours, a heading with
 * dims and lines, a repeated heading, an hours-only area, an options block
 * and a media block that must both be ignored.
 */
const PAGE = `Menu
Hours
31.5 hr
Work Order
Accepted
Contact
Casey Example
1 Example Street
Testville
casey@example.com
0491570159
Job Address
Casey's Address
1 Example Street
Testville
Date
Estimate ID
9613
Paint Group
25/25-35 Bunney Road
Oakleigh South, VIC 3167
Total Hours
31.5
Product Description

Dulux Weathershield  (Estimated: 38 Litre - $874.00)

Haymes Expressions Wall  (Estimated: 3 Litre - $51.00)

Total Dimensions (m²)
Walls: 24.8
m: 62
Areas
Exterior Preparation
hr

Exterior Preparation

We will wash all exterior surfaces (including the eaves) to ensure a clean substrate.

Special Equipment Required: Floor protection, platform ladders (2)

\t

Total
Front Side
(15'x3')
hr

Soffits / Eaves (15m)

Eaves - Prep: 1 + Labor: 3
Dulux Weathershield  - 1.88 Litre - $43.12

Coats: 2

\t

4

Fascias  (15m)

Fascias
Dulux Weathershield  - 2.00 Litre - $46.00

Coats: 2

Fascias

\t

2

Doors (4)

Standard Door (1 side)
Dulux Weathershield  - 2.40 Litre - $55.20

Coats: 2

\t

4

Total
Prep: 1
+
Painting: 9
=
10
Front Side
(15'x3')
hr

Gutters (15m)

Dulux Weathershield  - 3.00 Litre - $69.00

Coats: 2

\t

2

Total
Painting: 2
=
2
Living Area Wall x 1
(4'x3.2'x2.4')
hr

Walls (12.8m²)

Walls 2 Coats - Prep: 0.5 + Labor: 1.25
Haymes Expressions Wall  - 1.60 Litre - $75.00

Coats: 2

\t

1.75

Total
Prep: 0.5
+
Painting: 1.25
=
1.75
Cleaning
hr

Cleaning

Allowance included for site cleaning (standard site conditions).

\t

2

Total
Painting: 2
=
2
Fall protection
hr

Fall protection

Installation of fall protection to the right side of the property

\t

15.75

Total
Painting: 15.75
=
15.75
Options
These items are optional additions and are not included in the total.
Item\t
$

Front Side

$647.60

Windows (2), Doors (1)

Carpentry Quote: Cut, splice and replace rotten fascia board

$800.00

Media
Exterior Paint application
20260826_152724.jpg

Amazing On-Site Estimation
`;

describe("parseWorkOrderText", () => {
  const wo = parseWorkOrderText(PAGE);

  it("reads the quote number, the Total Hours banner, the materials and the dimensions", () => {
    expect(wo.quoteNo).toBe("9613");
    expect(wo.totalHours).toBe(31.5);
    expect(wo.materials).toEqual([
      { product: "Dulux Weathershield", litres: 38 },
      { product: "Haymes Expressions Wall", litres: 3 },
    ]);
    expect(wo.totalDimensions).toEqual({ Walls: 24.8, m: 62 });
  });

  it("keeps every area in page order, repeated names included, and never reads the options or the media", () => {
    expect(wo.areas.map((a) => a.name)).toEqual(["Exterior Preparation", "Front Side", "Front Side", "Living Area Wall x 1", "Cleaning", "Fall protection"]);
    expect(wo.optionHeadings).toContain("Front Side");
    expect(wo.areas.flatMap((a) => a.items).some((i) => i.item === "Windows")).toBe(false);
  });

  it("a heading with neither lines nor hours stays a heading", () => {
    expect(wo.areas[0]).toMatchObject({ name: "Exterior Preparation", items: [], hours_total: null, hours_prep: null, hours_paint: null });
  });

  it("reads each line's quantity, unit, coats, product, litres and hours, and the area's Prep + Painting split", () => {
    const front = wo.areas[1];
    expect(front).toMatchObject({ length_m: 15, width_m: 3, height_m: null, hours_prep: 1, hours_paint: 9, hours_total: 10 });
    expect(front.items).toEqual([
      { item: "Soffits / Eaves", qty: 15, unit: "m", coats: 2, hours: 4, product: "Dulux Weathershield", litres: 1.88 },
      { item: "Fascias", qty: 15, unit: "m", coats: 2, hours: 2, product: "Dulux Weathershield", litres: 2 },
      { item: "Doors", qty: 4, unit: "count", coats: 2, hours: 4, product: "Dulux Weathershield", litres: 2.4 },
    ]);
    expect(wo.areas[3]).toMatchObject({ length_m: 4, width_m: 3.2, height_m: 2.4 });
    expect(wo.areas[3].items[0]).toMatchObject({ item: "Walls", qty: 12.8, unit: "m2", hours: 1.75 });
  });

  it("an area with hours and no lines is crew work carrying its hours", () => {
    expect(wo.areas[4]).toMatchObject({ name: "Cleaning", items: [], hours_total: 2, hours_paint: 2 });
    expect(wo.areas[5]).toMatchObject({ name: "Fall protection", items: [], hours_total: 15.75 });
  });

  it("the lines and the hours-only areas add up to the banner", () => {
    expect(wo.hoursFromLines).toBe(31.5);
  });

  it("a page with no Areas block yields nothing, not a crash", () => {
    const empty = parseWorkOrderText("Estimate ID\n1\nTotal Hours\n0\n");
    expect(empty).toMatchObject({ quoteNo: "1", totalHours: 0, areas: [], hoursFromLines: 0 });
  });

  it("a page that omits the Total Hours banner reports null and leaves the proof to the caller", () => {
    const noBanner = parseWorkOrderText(PAGE.replace("Total Hours\n31.5\n", ""));
    expect(noBanner.totalHours).toBeNull();
    expect(noBanner.hoursFromLines).toBe(31.5);
  });
});
