import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { signPhotos, type WOPhotoRow, type WOPhoto } from "@/lib/workorder/photos";
import Walkthrough from "./Walkthrough";
import CompletionReport, { type Report } from "./CompletionReport";
import "@/app/e/customer.css";
import "@/app/v/[token]/variation.css";
import "./walkthrough.css";

export const dynamic = "force-dynamic";

type Row = {
  wo_ref: string; job_title: string; areas: Record<string, { approved_at?: string; flagged_at?: string; note?: string }>;
  signed_at: string | null; signed_name: string | null; deadline_at: string | null; headings: string[];
};

export default async function WalkthroughPage({
  params, searchParams,
}: { params: Promise<{ token: string }>; searchParams?: Promise<{ back?: string }> }) {
  const { token } = await params;
  // Where the DEVICE goes after an on-device sign: the painter's job page or
  // the staff job page. Same-site paths only — never an arbitrary URL.
  const rawBack = (await searchParams)?.back ?? "";
  const backHref = /^\/(portal|pc)\//.test(rawBack) ? rawBack : null;
  const supabase = await createClient();

  const { data } = await supabase.rpc("wo_walkthrough_by_token", { p_token: token });
  const row = ((data as Row[] | null) ?? [])[0];
  if (!row) notFound();

  // A viewed-but-unsigned pack is the record that matters later; best-effort.
  await supabase.rpc("wo_record_signoff_view", { p_token: token }).then(() => {}, () => {});

  // The painter's note for the customer, from the finishing-up list (Tom, 23
  // Aug). Read by the same token the walkthrough runs on; empty when unsaid.
  const painterNote = String(
    (await supabase.rpc("wo_prep_note_by_token", { p_token: token }).then((r) => r.data, () => "")) ?? "",
  ).trim();

  // Signed: the page is the permanent record the sign-off email links to.
  // The report is the jsonb frozen at signing; photo paths inside it are
  // signed into URLs with the service client — possession of the customer
  // token IS the authorisation, the same trust the walkthrough itself ran on.
  let report: Report | null = null;
  let warrantyEnds: string | null = null;
  let warrantyYears: number | null = null;
  let reportPhotos: WOPhoto[] = [];
  if (row.signed_at) {
    const { data: rep } = await supabase.rpc("wo_report_by_token", { p_token: token });
    const r = ((rep as { report: Report; warranty_ends: string | null; warranty_years: number | null }[] | null) ?? [])[0];
    if (r?.report) {
      report = r.report;
      warrantyEnds = r.warranty_ends;
      warrantyYears = r.warranty_years;
      const service = createServiceClient();
      // Our QA photos are internal — the customer sees before/progress/
      // completion/variation photos only (Tom, 23 Aug).
      const paths = (report.photos ?? []).filter((ph) => ph.kind !== "qa");
      if (service && paths.length > 0) {
        reportPhotos = await signPhotos(service, paths.map((ph, i) => ({
          id: String(i), work_order_id: "", kind: ph.kind, area: ph.area,
          caption: "", storage_path: ph.path, created_at: report!.signed_at, variation_id: null,
        }) as WOPhotoRow));
      }
    }
  }

  const initial: Record<string, { approved?: boolean; flagged?: boolean; note?: string }> = {};
  for (const [area, state] of Object.entries(row.areas ?? {})) {
    initial[area] = {
      approved: Boolean(state?.approved_at),
      flagged: Boolean(state?.flagged_at),
      note: state?.note,
    };
  }

  return (
    <main className="cv">
      <div className="cv-wrap">
        <span className="status">Ready for your look</span>
        <h1>Your job is finished</h1>
        <p className="cv-sub">{row.job_title || row.wo_ref}</p>
        <p className="cv-fine" style={{ marginTop: 10 }}>
          Have a walk round and tell us how each part looks. If anything isn&rsquo;t
          right, say so — that&rsquo;s what this is for, and it goes straight back to
          the painter.
        </p>

        {painterNote && (
          <div className="cv-painter-note" data-testid="painter-note">
            <b>A note from your painter</b>
            <p>{painterNote}</p>
          </div>
        )}

        <Walkthrough
          token={token}
          headings={row.headings ?? []}
          initial={initial}
          signedName={row.signed_at ? row.signed_name : null}
          backHref={backHref}
        />

        {report && (
          <CompletionReport
            report={report}
            warrantyEnds={warrantyEnds}
            warrantyYears={warrantyYears}
            photos={reportPhotos}
          />
        )}
      </div>
    </main>
  );
}
