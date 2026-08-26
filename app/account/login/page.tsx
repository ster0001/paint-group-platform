import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCompanyContact } from "@/lib/portal/data";
import { requestLinkAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Passwordless sign-in (⚑3). One field, one button, no password by default —
 * the single decision that matters most for the 60-year-old rules. Every
 * state names a next step and shows the phone number: never a dead end.
 */
export default async function AccountLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; next?: string; email?: string }>;
}) {
  const { sent, error, next, email } = await searchParams;

  const supabase = await createClient();
  const [{ data: { user } }, company] = await Promise.all([
    supabase.auth.getUser(),
    getCompanyContact(),
  ]);
  // Already signed in (and not an anonymous wizard session) — straight through.
  if (user?.email) redirect("/account");

  const phone = company.phone;
  const phoneLine = phone ? (
    <p className="sub" style={{ marginTop: 14 }}>
      Rather talk to a person? Ring us on{" "}
      <a href={`tel:${phone.replace(/\s+/g, "")}`} style={{ color: "var(--text)", fontWeight: 700 }}>{phone}</a>
      {" "}— we&rsquo;re happy to help.
    </p>
  ) : null;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand" style={{ marginBottom: 26 }}>PAINT GROUP<span className="dot">.</span></div>

        {sent ? (
          <>
            <h1>Check your email</h1>
            <div className="card raised">
              <p className="sub">
                We&rsquo;ve sent a sign-in link to <b style={{ color: "var(--text)" }}>{sent}</b>.
                Tap the button in that email and you&rsquo;ll land straight in your account — nothing else to do.
              </p>
              <div className="hr" />
              <p className="sub">
                No email after a couple of minutes? Check your junk folder, or ask for another link below.
              </p>
            </div>
            <form action={requestLinkAction}>
              <input type="hidden" name="email" value={sent} />
              {next ? <input type="hidden" name="next" value={next} /> : null}
              <button className="btn btn-ghost" type="submit">Send me another link</button>
            </form>
            {phoneLine}
          </>
        ) : (
          <>
            <h1>Your account</h1>
            <p className="sub" style={{ marginBottom: 18 }}>
              Type your email and we&rsquo;ll send you a sign-in link. No password to remember — the link does it all.
            </p>

            {error === "email" && (
              <div className="card" style={{ borderColor: "rgba(224,168,60,.5)" }}>
                <p className="sub">That doesn&rsquo;t look like an email address — have another go below.</p>
              </div>
            )}
            {error === "slow" && (
              <div className="card" style={{ borderColor: "rgba(224,168,60,.5)" }}>
                <p className="sub">
                  We&rsquo;ve sent a few links already — give your inbox a minute to catch up.
                  {phone ? <> If nothing arrives, ring us on <b style={{ color: "var(--text)" }}>{phone}</b>.</> : null}
                </p>
              </div>
            )}
            {error === "off" && (
              <div className="card" style={{ borderColor: "rgba(224,168,60,.5)" }}>
                <p className="sub">
                  We couldn&rsquo;t send the email just now.
                  {phone ? <> Please ring us on <b style={{ color: "var(--text)" }}>{phone}</b> and we&rsquo;ll sort you out straight away.</> : " Please try again shortly."}
                </p>
              </div>
            )}
            {error === "link" && (
              <div className="card" style={{ borderColor: "rgba(224,168,60,.5)" }}>
                <p className="sub">
                  That sign-in link has expired or was already used — they only last an hour.
                  Pop your email in below and we&rsquo;ll send a fresh one.
                </p>
              </div>
            )}

            <form action={requestLinkAction}>
              <label htmlFor="acct-email">Your email</label>
              <input
                id="acct-email"
                className="field"
                type="email"
                name="email"
                required
                autoComplete="email"
                inputMode="email"
                defaultValue={email ?? ""}
                placeholder="you@example.com"
              />
              {next ? <input type="hidden" name="next" value={next} /> : null}
              <div style={{ marginTop: 14 }}>
                <button className="btn btn-cyan" type="submit">Email me a sign-in link</button>
              </div>
            </form>

            {phoneLine}
            <p className="note" style={{ marginTop: 22 }}>
              Set up a password with us before?{" "}
              <Link href="/login" style={{ color: "var(--cyan)" }}>Sign in with it here</Link>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
