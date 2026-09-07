import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { signout } from "@/app/auth/actions";
import { saveProfileAction } from "./actions";
import SetPassword from "./SetPassword";

export const dynamic = "force-dynamic";

/**
 * My profile — reached from the avatar in the header. The customer's own
 * details, their marketing preference, and an optional password on top of
 * the magic link. Email is display-only: it IS the account identity.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const own = ctx.accounts.find((a) => a.email.toLowerCase() === ctx.email.toLowerCase()) ?? ctx.accounts[0] ?? null;

  // The stored marketing preference (opt-OUT flag — unset means opted in).
  let marketingOptOut = false;
  const svc = createServiceClient();
  if (svc && own) {
    const { data } = await svc.from("accounts").select("flags").eq("id", own.id).maybeSingle();
    marketingOptOut = Boolean(((data?.flags ?? {}) as { marketing_opt_out?: boolean }).marketing_opt_out);
  }

  return (
    <div>
      <h1>My profile</h1>

      {saved && (
        <div className="card" style={{ borderColor: "rgba(47,164,107,.5)" }}>
          <p className="sub">Saved — all up to date.</p>
        </div>
      )}
      {error && (
        <div className="card" style={{ borderColor: "rgba(224,168,60,.5)" }}>
          <p className="sub">That didn&rsquo;t save — please check the details and try again.</p>
        </div>
      )}

      <form action={saveProfileAction} className="card">
        <h3>Your details</h3>
        <label htmlFor="pf-email" style={{ marginTop: 12 }}>Email</label>
        <input id="pf-email" className="field" type="email" value={ctx.email} disabled readOnly />
        <p className="note" style={{ marginTop: 6 }}>
          Your email is how we know it&rsquo;s you — ring us if it needs changing.
        </p>
        <label htmlFor="pf-name" style={{ marginTop: 12 }}>Name</label>
        <input
          id="pf-name" className="field" type="text" name="name" maxLength={120}
          defaultValue={own?.name ?? ""} autoComplete="name" placeholder="Your name"
        />
        <label htmlFor="pf-phone" style={{ marginTop: 12 }}>Phone</label>
        <input
          id="pf-phone" className="field" type="tel" name="phone" maxLength={40}
          defaultValue={own?.phone ?? ""} autoComplete="tel" inputMode="tel" placeholder="04xx xxx xxx"
        />

        <div style={{ marginTop: 16 }}>
          <button className="btn btn-cyan" type="submit">Save</button>
        </div>
      </form>

      {/* Tom, 7 Sep: alerts per type and per channel live on their own page —
          one place, for residential and trade alike. */}
      <Link href="/account/notifications" className="card" style={{ display: "block", textDecoration: "none" }} data-testid="notifications-link">
        <h3>Notifications &amp; alerts →</h3>
        <p className="sub" style={{ marginTop: 6 }}>
          Choose what we send you — estimates, visits, job updates, invoices, replies — and whether by email or text.
          {marketingOptOut ? " Offers and tips: off." : " Offers and tips: on."}
        </p>
      </Link>

      <SetPassword />

      <form action={signout} style={{ marginTop: 28, textAlign: "center" }}>
        <button type="submit" className="note" style={{ textDecoration: "underline" }}>Sign out</button>
      </form>
    </div>
  );
}
