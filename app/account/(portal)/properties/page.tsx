import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalAftercare, getPortalContext, getPortalJobs, getRebookCandidates } from "@/lib/portal/data";
import { fmtDay } from "@/lib/portal/money";

export const dynamic = "force-dynamic";

/**
 * 3a-7 · Properties (§6 W4): every property with its state, its permanent
 * paint register, and the one-tap rebook — "why would I look anywhere
 * else". Trade accounts only; residential Homes tell the one-property
 * story directly.
 */
export default async function PropertiesPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");
  if (!ctx.accounts.some((a) => a.account_type === "trade")) redirect("/account");

  const accountIds = ctx.accounts.map((a) => a.id);
  const [{ estimates, workOrders }, aftercare, rebooks] = await Promise.all([
    getPortalJobs(accountIds),
    getPortalAftercare(accountIds),
    getRebookCandidates(accountIds),
  ]);

  const orgName = ctx.accounts.find((a) => a.account_type === "trade")?.name ?? "";

  const cards = ctx.properties.map((p) => {
    const propEstimates = estimates.filter((e) => e.property_id === p.id);
    const estIds = new Set(propEstimates.map((e) => e.id));
    const wos = workOrders.filter((w) => estIds.has(w.estimate_id));
    const jobs = aftercare.jobs.filter((j) => estIds.has(j.estimateId));
    const warranted = jobs.find((j) => j.warranty);
    const active = wos.find((w) => ["in_progress", "qa", "completion_prep"].includes(w.stage));
    const atWalkthrough = wos.find((w) => w.stage === "walkthrough");
    const closed = wos.filter((w) => w.stage === "closed").length;
    const hasRegister = jobs.some((j) => j.materials.length > 0 || (j.liveColours && Object.keys(j.liveColours).length > 0));
    const rebook = rebooks.find((r) => r.property_id === p.id && r.hasWizard)
      ?? rebooks.find((r) => r.property_id === p.id);

    const chip = active
      ? { cls: "cyan", label: "Job underway" }
      : atWalkthrough
        ? { cls: "amber", label: "Sign-off" }
        : closed > 0
          ? { cls: "emerald", label: "Completed" }
          : propEstimates.length
            ? { cls: "mut", label: "Estimated" }
            : { cls: "mut", label: "On file" };

    const metaBits = [
      propEstimates.length ? `${propEstimates.length} ${propEstimates.length === 1 ? "job" : "jobs"} with us` : "No jobs yet",
      hasRegister ? "paint register on file" : null,
      warranted?.warranty
        ? `warranty to ${fmtDay(warranted.warranty.endsOn)} ${warranted.warranty.endsOn.slice(0, 4)}`
        : null,
    ].filter(Boolean);

    return { p, chip, meta: metaBits.join(" · "), hasRegister, rebook };
  });

  return (
    <div>
      <div className="greet">{orgName || "Your portfolio"}</div>
      <h1>Properties</h1>

      {cards.length === 0 && (
        <div className="card raised">
          <p className="sub">
            Every property you paint with us keeps a permanent record here. Add the first
            one, or start an estimate and it appears on its own.
          </p>
          <div className="btn-row"><Link className="btn btn-cyan" href="/account/addresses/new">Add a property</Link></div>
        </div>
      )}

      {cards.map(({ p, chip, meta, hasRegister, rebook }) => (
        <div className="job" key={p.id}>
          <div className="row">
            <div className="addr">{[p.address, p.suburb].filter(Boolean).join(", ") || "Property"}</div>
            <span className={`chip ${chip.cls}`}>{chip.label}</span>
          </div>
          <div className="meta">{meta}</div>
          <div className="btn-row">
            {hasRegister && (
              <Link className="btn btn-ghost" style={{ padding: 12, fontSize: 15, flex: 1 }} href="/account/colours">
                View paint register
              </Link>
            )}
            <Link
              className="btn btn-cyan"
              style={{ padding: 12, fontSize: 15, flex: 1 }}
              href={rebook ? `/estimate?property=${p.id}&rebook=${rebook.id}` : `/estimate?property=${p.id}`}
            >
              {rebook ? "Rebook — same spec" : "Get an estimate"}
            </Link>
          </div>
        </div>
      ))}

      <div className="btn-row" style={{ marginTop: 14 }}>
        <Link className="btn btn-ghost" href="/account/addresses/new">Add a property</Link>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <p className="sub">
          Every property you paint with us keeps a permanent register — colours, brands and
          finishes, searchable by address, ready to hand to the next property manager.
        </p>
      </div>
    </div>
  );
}
