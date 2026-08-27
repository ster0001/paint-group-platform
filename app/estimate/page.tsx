import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SCOPE_VERSION } from "@/lib/extract/scope";
import { substrateOptionsFromRates, type SubstrateGroups } from "@/lib/estimate/substrates";
import WizardApp from "../wizard/WizardApp";

/**
 * /estimate — Step 8's CUSTOMER wizard.
 *
 * The route exists so Step 8 can be built and adversarially tested, but the
 * master plan's checkpoint holds: nothing ships to customers before the
 * accuracy gate passes. So the page is OFF for the public until the
 * `wizard_public` setting is flipped at Step 10's launch — until then,
 * customers see a polite holding page, and staff can always preview.
 */

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Get your painting estimate · Paint Group",
  robots: { index: false, follow: false }, // flipped at Step 10
};

export default async function CustomerWizardPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>;
}) {
  const { property: propertyParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let isStaff = false;
  let memberEmail: string | null = null;
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    isStaff = profile?.role === "staff";
    // 3a-6: a signed-in portal customer (magic-link login, real email) uses
    // the SAME wizard — their verified session is the identity, so the
    // email gate disappears and their account's gates apply server-side.
    const anonymous = (user as { is_anonymous?: boolean }).is_anonymous === true;
    if (!anonymous && profile?.role === "customer" && user.email) memberEmail = user.email;
  }

  // Prefill from a chosen property: read through the CALLER'S session — RLS
  // (properties_member_select) is the ownership check.
  let prefillAddress: { street: string; suburb: string; state: string; postcode: string; formatted: string } | null = null;
  if (memberEmail && propertyParam && /^[0-9a-f-]{36}$/.test(propertyParam)) {
    const { data: prop } = await supabase
      .from("properties")
      .select("address, suburb, state, postcode")
      .eq("id", propertyParam)
      .maybeSingle();
    if (prop?.address) {
      prefillAddress = {
        street: prop.address as string,
        suburb: (prop.suburb as string | null) ?? "",
        state: (prop.state as string | null) ?? "",
        postcode: (prop.postcode as string | null) ?? "",
        formatted: [prop.address, prop.suburb, prop.postcode].filter(Boolean).join(", "),
      };
    }
  }

  // Reference data: an anonymous visitor has no table access, deliberately —
  // their reads go through the service client. Staff preview uses the
  // session client + RLS like every other staff flow (service.ts's own rule),
  // so a dev machine without the service key can still preview the wizard.
  const svc = createServiceClient();
  const ref = svc ?? (isStaff ? supabase : null);
  let enabled = false;
  let roomTypes: string[] = [];
  let substrates: SubstrateGroups = { interior: [], exterior: [] };
  if (ref) {
    const [{ data: flagRow }, { data: rules }, { data: rateItems }] = await Promise.all([
      ref.from("settings").select("value").eq("key", "wizard_public").maybeSingle(),
      ref.from("room_type_scope_rules").select("room_type").eq("version", SCOPE_VERSION),
      ref.from("rate_items").select("code, category"),
    ]);
    enabled = (flagRow?.value as { enabled?: boolean } | null)?.enabled === true;
    roomTypes = [...new Set((rules ?? []).map((r) => r.room_type as string))]
      .filter((t) => !["exterior", "unknown", "excluded", "exterior_excluded"].includes(t))
      .sort();
    substrates = substrateOptionsFromRates(rateItems ?? []);
  }

  // Existing customers (signed-in members) keep their builder even while the
  // public gate is shut — B4: the portal wizard IS the public wizard, and a
  // customer we already serve is not the audience the launch gate protects.
  if (!enabled && !isStaff && !memberEmail) {
    return (
      <>
        <header className="wz-top"><div className="wz-wm">PAINT<span>—</span>GROUP</div></header>
        <div className="wz-wrap" style={{ textAlign: "center", paddingTop: 80 }}>
          <h1>Online estimates are nearly here</h1>
          <p className="wz-sub" style={{ marginTop: 14 }}>
            We&rsquo;re putting the finishing coats on. In the meantime, call or email and
            we&rsquo;ll sort your quote the old-fashioned way — quickly.
          </p>
        </div>
      </>
    );
  }

  return (
    <WizardApp
      roomTypes={roomTypes}
      substrates={substrates}
      mode="customer"
      prefill={memberEmail ? { email: memberEmail, address: prefillAddress } : undefined}
    />
  );
}
