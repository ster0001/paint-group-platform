import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/contractor/session";
import { DOC_COLUMNS, type ContractorDoc } from "@/lib/contractor/model";
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

  const supabase = await createClient();
  const { data: docsData } = await supabase
    .from("contractor_documents")
    .select(DOC_COLUMNS)
    .eq("contractor_id", contractor.id)
    .order("created_at", { ascending: false });

  return (
    <ProfileForm
      contractor={contractor}
      docs={(docsData as ContractorDoc[] | null) ?? []}
      name={name}
      email={email}
    />
  );
}
