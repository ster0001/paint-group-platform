import { redirect } from "next/navigation";
import { getPortalAftercare, getPortalContext, melbourneTodayYmd } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { fmtDay } from "@/lib/portal/money";
import WarrantyTerms from "./WarrantyTerms";
import { reportIssueAction } from "./actions";

export const dynamic = "force-dynamic";

function monthsLeft(endYmd: string, todayYmd: string): string | null {
  const months = Math.floor((Date.parse(endYmd + "T00:00:00Z") - Date.parse(todayYmd + "T00:00:00Z")) / (30.44 * 86_400_000));
  if (months < 0) return null;
  if (months >= 12) {
    const y = Math.floor(months / 12);
    const m = months % 12;
    return `${y} year${y === 1 ? "" : "s"}${m ? ` ${m} month${m === 1 ? "" : "s"}` : ""} left`;
  }
  return `${months} month${months === 1 ? "" : "s"} left`;
}

/**
 * 3a-5 · Documents (§5): the warranty card per completed job with the
 * photo-first "Report an issue" form, our credentials (always the current
 * version), each job's completion report, and the warranty terms —
 * DRAFT-watermarked until legally approved.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ issue?: string; why?: string }>;
}) {
  const { issue, why } = await searchParams;
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const { jobs, documents, issues, warrantyApproved } = await getPortalAftercare(ctx.accounts.map((a) => a.id));
  const today = melbourneTodayYmd();
  const phone = ctx.companyPhone;

  const svc = createServiceClient();
  const { data: settingRows } = svc
    ? await svc.from("settings").select("key, value").in("key", ["invoicing_entity", "company_profile"])
    : { data: null };
  const entity = ((settingRows ?? []).find((r) => r.key === "invoicing_entity")?.value ?? {}) as
    { tradingName?: string; abn?: string; address?: string };
  const companyEmail = (((settingRows ?? []).find((r) => r.key === "company_profile")?.value ?? {}) as
    { email?: string }).email ?? "";

  const warrantied = jobs.filter((j) => j.warranty);
  const openIssues = issues.filter((i) => i.status === "open");

  return (
    <div>
      <h1>Documents &amp; warranty</h1>

      {issue === "reported" && (
        <div className="card" style={{ borderColor: "rgba(47,164,107,.5)" }}>
          <p className="sub">
            Thank you — we&rsquo;ve got it, and we&rsquo;ll be in touch within two business days.
            {phone ? <> Sooner suits better? Ring us on <b style={{ color: "var(--text)" }}>{phone}</b>.</> : null}
          </p>
        </div>
      )}
      {(issue === "photo" || issue === "invalid" || issue === "failed") && (
        <div className="card" style={{ borderColor: "rgba(224,168,60,.5)" }}>
          <p className="sub">
            {issue === "photo" ? (why || "One of the photos didn't work — try again.") :
             issue === "invalid" ? "Tell us a little about what you've noticed, then send it again." :
             "That didn't go through — please try again."}
            {phone ? <> Or just ring us on <b style={{ color: "var(--text)" }}>{phone}</b> — we&rsquo;re happy to come and look.</> : null}
          </p>
        </div>
      )}

      {warrantied.length === 0 && (
        <div className="card raised">
          <p className="sub">
            Your two-year workmanship warranty starts the day you sign off your first job —
            the card will live here, alongside our credentials below.
          </p>
        </div>
      )}

      {warrantied.map((job) => (
        <section key={job.workOrderId}>
          <h2>Your warranty — {job.title}</h2>
          <div className="card raised">
            <div className="row" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Two-year workmanship warranty</h3>
              {monthsLeft(job.warranty!.endsOn, today)
                ? <span className="chip emerald">{monthsLeft(job.warranty!.endsOn, today)}</span>
                : <span className="chip mut">Ended</span>}
            </div>
            <p className="sub">
              Covered from {fmtDay(job.warranty!.startsOn)} to {fmtDay(job.warranty!.endsOn)}{" "}
              {job.warranty!.endsOn.slice(0, 4)}. If our workmanship lets you down in that time —
              paint peeling, flaking, blistering or cracking because of how it was applied — we
              come back and put it right, at no cost to you. Labour and materials included.
            </p>
            <p className="note" style={{ marginTop: 8 }}>
              This warranty is in addition to your rights under the Australian Consumer Law,
              which no business can take away.
            </p>
          </div>

          <div className="card">
            <h3>Something not looking right?</h3>
            <p className="sub" style={{ marginBottom: 12 }}>
              Add a photo or two and tell us what you&rsquo;ve noticed — we&rsquo;ll be in touch.
              No photo handy? Send it anyway, we&rsquo;ll simply come and look.
            </p>
            <form action={reportIssueAction}>
              <input type="hidden" name="workOrderId" value={job.workOrderId} />
              <textarea
                className="field" name="note" required minLength={5} rows={3}
                placeholder="e.g. The paint near the laundry window has started to bubble…"
              />
              <div style={{ margin: "10px 0" }}>
                <input type="file" name="photos" accept="image/*" multiple className="note" />
              </div>
              <button className="btn btn-cyan" type="submit">Report an issue</button>
            </form>
          </div>

          {job.reportToken && (
            <div className="card">
              <div className="row">
                <div>
                  <h3>Completion report</h3>
                  <p className="sub">Everything delivered, area by area, exactly as you signed it off.</p>
                </div>
                <a className="btn btn-ghost" style={{ width: "auto", padding: "12px 18px", fontSize: 15 }}
                  href={`/s/${job.reportToken}`}>Open</a>
              </div>
            </div>
          )}
        </section>
      ))}

      {openIssues.length > 0 && (
        <>
          <h2>Reports you&rsquo;ve sent us</h2>
          <div className="card">
            {openIssues.map((i) => (
              <div className="row" key={i.id} style={{ padding: "8px 0" }}>
                <span className="sub" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.note}</span>
                <span className="chip amber">With us now</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Our credentials</h2>
      <div className="card">
        {documents.length === 0 && (
          <p className="sub">
            Our insurance certificates will sit here — ask us
            {phone ? <> on <b style={{ color: "var(--text)" }}>{phone}</b></> : null} and
            we&rsquo;ll send them today.
          </p>
        )}
        {documents.map((d) => (
          <div className="row" key={d.id} style={{ padding: "10px 0" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16.5, fontWeight: 700 }}>{d.title}</div>
              {d.expiresOn && <div className="note">Current to {fmtDay(d.expiresOn)} {d.expiresOn.slice(0, 4)}</div>}
            </div>
            <a className="btn btn-ghost" style={{ width: "auto", padding: "10px 16px", fontSize: 14 }}
              href={`/account/document/${d.id}`}>Download</a>
          </div>
        ))}
      </div>

      <h2>The warranty in full</h2>
      <WarrantyTerms
        approved={warrantyApproved}
        companyName={entity.tradingName || ctx.companyName}
        abn={entity.abn || ""}
        address={entity.address || ""}
        phone={phone}
        email={companyEmail}
      />
    </div>
  );
}
