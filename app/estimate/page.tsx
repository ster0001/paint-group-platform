import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SCOPE_VERSION } from "@/lib/extract/scope";
import { substrateOptionsFromRates, type SubstrateGroups } from "@/lib/estimate/substrates";
import WizardApp from "../wizard/WizardApp";
import Wordmark from "../wizard/Wordmark";
import { getCompanyContact } from "@/lib/portal/data";
import { clampAddress, wizardStateSchema, type WizardState } from "@/lib/wizard/state";

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
  searchParams: Promise<{ property?: string; rebook?: string }>;
}) {
  const { property: propertyParam, rebook: rebookParam } = await searchParams;
  const supabase = await createClient();
  // The Settings logo for the header (public-safe display fields only).
  const company = await getCompanyContact();
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

  // Tom, 31 Aug: a member's account already knows who they are — name and
  // phone ride the prefill so the contact sub-step never shows for them.
  let memberName: string | null = null;
  let memberPhone: string | null = null;
  if (memberEmail) {
    const { data: acct } = await supabase
      .from("accounts").select("name, phone").eq("email", memberEmail.toLowerCase()).maybeSingle();
    memberName = (acct?.name as string | null)?.trim() || null;
    memberPhone = (acct?.phone as string | null)?.trim() || null;
  }

  // Tom's ruling (1 Sep): "Get a new estimate" starts with a BLANK address —
  // the new job may be at a different property, and a pre-filled one was
  // getting submitted unread. REBOOK is the exception: that flow is
  // explicitly "this property again", so its links (?property=&rebook=) keep
  // the property's address exactly as 3a-7 built it.
  let prefillAddress: { street: string; suburb: string; state: string; postcode: string; formatted: string } | null = null;
  if (memberEmail && rebookParam && propertyParam && /^[0-9a-f-]{36}$/.test(propertyParam)) {
    const { data: prop } = await supabase
      .from("properties")
      .select("address, suburb, state, postcode")
      .eq("id", propertyParam)
      .maybeSingle();
    if (prop?.address) {
      // Clamped: stored rows can carry oddities (a pre-radius-cap Places
      // pick left a 24-char UK state) — a prefill must never seed a state
      // the wizard's own schema then refuses to submit.
      prefillAddress = clampAddress({
        street: prop.address as string,
        suburb: (prop.suburb as string | null) ?? "",
        state: (prop.state as string | null) ?? "",
        postcode: (prop.postcode as string | null) ?? "",
        formatted: [prop.address, prop.suburb, prop.postcode].filter(Boolean).join(", "),
      });
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
        <header className="wz-top"><Wordmark logoUrl={company.logoUrl} /></header>
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

  // 3a-7: one-tap rebook — a member requotes a PRIOR JOB OF THEIR OWN. The
  // ownership check runs the account chain (estimate → account ∈ caller's
  // memberships, read via RLS); the stored answers are re-validated through
  // the zod schema and stripped of every file/run reference before they seed
  // the wizard. Anything that fails simply falls back to a fresh walk.
  let prefillState: WizardState | undefined;
  if (memberEmail && rebookParam && /^[0-9a-f-]{36}$/.test(rebookParam) && svc) {
    const { data: memberships } = await supabase.from("account_users").select("account_id");
    const owned = new Set((memberships ?? []).map((m) => m.account_id as string));
    const { data: prior } = await svc
      .from("estimates")
      .select("account_id, wizard_state:builder_state->wizard->state")
      .eq("id", rebookParam)
      .maybeSingle();
    if (prior?.account_id && owned.has(prior.account_id as string) && prior.wizard_state) {
      const parsed = wizardStateSchema.safeParse(prior.wizard_state);
      if (parsed.success) {
        // The old job's plan readings and photos belong to the old job —
        // strip every reference, then RE-VALIDATE: a state that only made
        // sense with its floorplan attached fails here and the customer
        // simply gets a fresh walk with the address prefilled.
        const stripped = wizardStateSchema.safeParse({
          ...parsed.data,
          planRunIds: [],
          facadeRunIds: [],
          conditionSourceIds: [],
        });
        if (stripped.success) prefillState = stripped.data;
      }
    }
  }

  return (
    <WizardApp
      roomTypes={roomTypes}
      substrates={substrates}
      mode="customer"
      logoUrl={company.logoUrl}
      prefill={memberEmail ? {
        email: memberEmail,
        name: memberName ?? undefined,
        phone: memberPhone ?? undefined,
        address: prefillAddress,
      } : undefined}
      prefillState={prefillState}
    />
  );
}
