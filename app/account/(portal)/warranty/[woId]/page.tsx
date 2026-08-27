import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getPortalAftercare, getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import PrintButton from "../../PrintButton";

export const dynamic = "force-dynamic";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * The warranty CERTIFICATE — one page per completed job, handsome on screen
 * and a clean white document when printed/saved as PDF (the house pattern).
 * Ownership through the account chain; the full terms live on Documents.
 */
export default async function WarrantyCertificatePage({
  params,
}: {
  params: Promise<{ woId: string }>;
}) {
  const { woId } = await params;
  if (!z.string().uuid().safeParse(woId).success) notFound();

  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const { jobs, warrantyApproved } = await getPortalAftercare(ctx.accounts.map((a) => a.id));
  const job = jobs.find((j) => j.workOrderId === woId && j.warranty);
  if (!job) notFound();

  const svc = createServiceClient();
  const { data: entityRow } = svc
    ? await svc.from("settings").select("value").eq("key", "invoicing_entity").maybeSingle()
    : { data: null };
  const entity = (entityRow?.value ?? {}) as { tradingName?: string; abn?: string; address?: string };
  const companyName = entity.tradingName || ctx.companyName;
  const holder = ctx.accounts[0]?.name || ctx.email;

  return (
    <div className={warrantyApproved ? "" : "draftwrap"}>
      <div className="card raised" style={{ padding: 28, textAlign: "center" }}>
        <div className="brand" style={{ fontSize: 20 }}>PAINT GROUP<span className="dot">.</span></div>
        <h2 style={{ margin: "18px 0 4px" }}>Certificate of warranty</h2>
        <h1 style={{ marginBottom: 6 }}>Two-year workmanship warranty</h1>
        <p className="note">Certificate {job.workOrderId.slice(0, 8).toUpperCase()}</p>

        <div className="hr" />
        <p className="sub" style={{ fontSize: 17.5 }}>
          This certifies that the painting works at
        </p>
        <div className="big" style={{ margin: "6px 0" }}>{job.title}</div>
        <p className="sub" style={{ fontSize: 17.5 }}>
          completed for <b style={{ color: "var(--text)" }}>{holder}</b> and signed off on{" "}
          <b style={{ color: "var(--text)" }}>{longDate(job.warranty!.startsOn)}</b> are covered by the{" "}
          {companyName} workmanship warranty until
        </p>
        <div className="big" style={{ margin: "6px 0", color: "var(--cyan)" }}>
          {longDate(job.warranty!.endsOn)}
        </div>

        <div className="hr" />
        <p className="sub" style={{ textAlign: "left" }}>
          If our workmanship lets you down in that time — paint peeling, flaking, blistering
          or cracking because of how it was applied — we will come back and put it right, at
          no cost to you. That includes the labour and the materials, using the products and
          colours recorded in your paint register.
        </p>
        <p className="sub" style={{ textAlign: "left", marginTop: 10 }}>
          It doesn&rsquo;t cover ordinary wear and tear, damage caused by others, or problems
          that come from the building itself rather than our work — the full terms in your
          account explain the difference in plain language.
        </p>
        <p className="note" style={{ textAlign: "left", marginTop: 14 }}>
          This warranty is in addition to your rights under the Australian Consumer Law,
          which no business can take away. Claims cost you nothing to make: report an issue
          from your account{ctx.companyPhone ? `, or ring ${ctx.companyPhone}` : ""}.
        </p>

        <div className="hr" />
        <p className="note">
          {companyName}{entity.abn ? ` · ABN ${entity.abn}` : ""}{entity.address ? ` · ${entity.address}` : ""}
        </p>
      </div>

      <div className="btn-row">
        <PrintButton label="Download as PDF" />
      </div>
    </div>
  );
}
