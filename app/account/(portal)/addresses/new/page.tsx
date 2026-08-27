import { redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import AddAddressForm from "./AddAddressForm";

export const dynamic = "force-dynamic";

export default async function AddAddressPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  return (
    <div>
      <h1>Add an address</h1>
      <p className="sub" style={{ marginBottom: 18 }}>
        Moving house, or another place to paint? Add it here — everything from your
        current address stays safe in your account.
      </p>

      {error === "address" && (
        <div className="card" style={{ borderColor: "rgba(224,168,60,.5)" }}>
          <p className="sub">We need at least the street address — have another look below.</p>
        </div>
      )}
      {error === "failed" && (
        <div className="card" style={{ borderColor: "rgba(224,168,60,.5)" }}>
          <p className="sub">
            That didn&rsquo;t save — please try again
            {ctx.companyPhone ? <>, or ring us on <b style={{ color: "var(--text)" }}>{ctx.companyPhone}</b></> : null}.
          </p>
        </div>
      )}

      <div className="card">
        <AddAddressForm hasExisting={ctx.properties.length > 0} />
      </div>
    </div>
  );
}
