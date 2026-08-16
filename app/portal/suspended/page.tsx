import { redirect } from "next/navigation";
import { getContractorSession } from "@/lib/contractor/session";

export const dynamic = "force-dynamic";

// Shown when staff have paused an account. Uses getContractorSession rather than
// requireContractor, which would redirect here and loop.
export default async function SuspendedPage() {
  const { contractor } = await getContractorSession();
  if (contractor?.active) redirect("/portal");

  return (
    <div className="wrap">
      <div className="card amberish" style={{ marginTop: 24 }}>
        <span className="chip amb">Access paused</span>
        <div style={{ marginTop: 10, fontWeight: 600, fontSize: "14.5px" }}>
          Your portal access is on hold
        </div>
        <div style={{ marginTop: 6, fontSize: "12.5px", color: "var(--muted)" }}>
          Paint Group have paused your account, so jobs and offers aren&rsquo;t
          available at the moment. Give the office a call and they can switch it back
          on.
        </div>
      </div>
    </div>
  );
}
