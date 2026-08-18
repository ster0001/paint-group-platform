import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SCOPE_VERSION } from "@/lib/extract/scope";
import WizardApp from "./WizardApp";

/**
 * /wizard — Step 7's INTERNAL wizard (phase plan W1–W3, internal mode).
 * Staff-only: reached from the estimates list. No email gate, margin
 * visible, point price. The public customer route is Step 8 and does not
 * exist yet — nothing customer-facing ships before the Step 6 accuracy
 * gate passes (master plan checkpoint).
 */

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Build an estimate · Paint Group",
  robots: { index: false, follow: false },
};

export default async function WizardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") redirect("/dashboard");

  // Room types that actually have scope rules — the editor's add-room chips.
  const { data: rules } = await supabase
    .from("room_type_scope_rules")
    .select("room_type")
    .eq("version", SCOPE_VERSION);
  const roomTypes = [...new Set((rules ?? []).map((r) => r.room_type as string))]
    .filter((t) => !["exterior", "unknown", "excluded", "exterior_excluded"].includes(t))
    .sort();

  return <WizardApp roomTypes={roomTypes} />;
}
