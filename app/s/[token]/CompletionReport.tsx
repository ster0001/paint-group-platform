import PhotoGrid from "@/app/components/wo/PhotoGrid";
import type { WOPhoto } from "@/lib/workorder/photos";

/**
 * The permanent record the ⚑10 email links to — rendered entirely from the
 * report jsonb frozen at signing. Nothing here re-queries live tables: what
 * was signed is what is shown, for ever, even after the job's rows move on.
 *
 * Declined variations are shown by design (warranty-dispute protection —
 * "we flagged it, you said no" is the record that settles the argument).
 */
type ReportSurface = { heading: string; label: string; state: string; rectification: boolean };
type ReportVariation = { category: string; comment: string; status: string; price_cents: number | null };
type ReportQa = { kind: string; result: string | null; thin_record: boolean };

export type Report = {
  wo_ref: string;
  signed_at: string; signed_name: string; signed_kind: string;
  warranty_starts: string;
  surfaces: ReportSurface[];
  variations: ReportVariation[];
  qa: ReportQa[];
  /** Storage paths, signed into URLs by the page — never rendered raw. */
  photos: { kind: string; area: string | null; path: string }[];
};

const money = (c: number) =>
  "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateFmt = (d: string) =>
  new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

export default function CompletionReport({
  report, warrantyEnds, warrantyYears, photos,
}: {
  report: Report;
  warrantyEnds: string | null;
  warrantyYears: number | null;
  photos: readonly WOPhoto[];
}) {
  const byHeading = new Map<string, ReportSurface[]>();
  for (const s of report.surfaces ?? []) {
    byHeading.set(s.heading, [...(byHeading.get(s.heading) ?? []), s]);
  }
  const shownVariations = (report.variations ?? []).filter((v) => v.status !== "cancelled");

  return (
    <section className="cv-report" data-testid="completion-report">
      <h2>Your completion report</h2>
      <p className="cv-fine">
        Signed by {report.signed_name} on {dateFmt(report.signed_at)} · {report.wo_ref}
      </p>

      <div className="cv-warranty" data-testid="report-warranty">
        <b>{warrantyYears ?? 2}-year workmanship warranty</b>
        <span>
          {dateFmt(report.warranty_starts)}{warrantyEnds ? ` — ${dateFmt(warrantyEnds)}` : ""}.
          Anything you notice later in that window, get in touch — it&rsquo;s covered.
        </span>
      </div>

      <h3>What was done</h3>
      {[...byHeading.entries()].map(([heading, rows]) => (
        <div className="cv-area" key={heading} data-testid={`report-area-${heading}`}>
          <b>{heading}</b>
          <ul>
            {rows.map((s, i) => (
              <li key={i}>
                {s.label}
                {s.rectification && <em> · attended after your walkthrough</em>}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {shownVariations.length > 0 && (
        <>
          <h3>Changes along the way</h3>
          <ul className="cv-vars">
            {shownVariations.map((v, i) => (
              <li key={i} data-testid={`report-variation-${i}`}>
                <b style={{ textTransform: "capitalize" }}>{v.category.replace(/_/g, " ")}</b>
                {v.comment ? ` — ${v.comment}` : ""}
                {v.status === "declined"
                  ? <em> · flagged by the painter, declined — not part of the work</em>
                  : v.price_cents != null ? ` · ${money(v.price_cents)}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* The quality check is OURS — how we check the contractor's work — and
          nothing to do with the customer (Tom, 23 Aug). The tally stays in the
          frozen record; it is simply not shown here. */}

      {photos.length > 0 && (
        <>
          <h3>Photos</h3>
          <PhotoGrid photos={photos} showKind={true} />
        </>
      )}
    </section>
  );
}
