import { requireContractor } from "@/lib/contractor/session";
import { loadContractorDocs, docsErrorMessage } from "@/lib/contractor/docs";
import { contractorPhone, weekendAvailability } from "@/lib/contractor/weekend";
import { createClient } from "@/lib/supabase/server";
import ProfileForm from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { email, name, contractor } = await requireContractor();

  if (!contractor) {
    return (
      <div className="wrap">
        <h1>My profile</h1>
        <p className="slab">{email}</p>
        <div className="empty">
          <i aria-hidden>⏳</i>
          <b>Your account isn&rsquo;t set up yet</b>
          Paint Group still has to add you to the contractor list before you can fill
          in your company details.
        </div>
      </div>
    );
  }

  const { docs, error: docsError } = await loadContractorDocs(contractor.id);
  // Best-effort: null until migrations 20261221/20261223 run — hides the cards.
  const db = await createClient();
  const weekend = (await weekendAvailability(db, [contractor.id])).get(contractor.id) ?? null;
  const phone = await contractorPhone(db, contractor.id);

  return (
    <ProfileForm
      contractor={contractor}
      docs={docs}
      docsError={docsError ? docsErrorMessage(docsError) : null}
      name={name}
      email={email}
      weekend={weekend}
      phone={phone.available ? { value: phone.phone ?? "" } : null}
    />
  );
}
