import { redirect } from "next/navigation";
import { getCompanyContact } from "@/lib/portal/data";
import { safeNextPath } from "@/lib/portal/auth";
import { redeemLinkAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * 3a-2 · The magic-link landing. OPENING this page spends nothing — the
 * single-use token is only redeemed when the person taps the button (a POST,
 * redeemLinkAction).
 *
 * 13 Oct 2026: it used to verify on the GET. Microsoft's mail scanner
 * (live.com.au / outlook.com / hotmail) opens every link in a new email to
 * check it is safe, so it redeemed each sign-in link 15–30 s after delivery
 * and the customer's own tap then said "expired or already used" — seven
 * links running for one customer on 12 Oct. Scanners fetch; they do not
 * press buttons.
 */
export default async function AccountAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; next?: string }>;
}) {
  const { token_hash: tokenHash = "", next: rawNext } = await searchParams;
  if (!tokenHash || tokenHash.length > 300) redirect("/account/login?error=link");
  const next = safeNextPath(rawNext);
  const settingPassword = next.startsWith("/reset-password");

  const company = await getCompanyContact();
  const phone = company.phone;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand" style={{ marginBottom: 26 }}>PAINT GROUP<span className="dot">.</span></div>
        <h1>{settingPassword ? "Choose your password" : "Open your account"}</h1>
        <p className="sub" style={{ marginBottom: 18 }}>
          {settingPassword
            ? "One tap and you’re signed in, then you can pick your new password."
            : "One tap and you’re in — no password needed."}
        </p>
        <form action={redeemLinkAction}>
          <input type="hidden" name="token_hash" value={tokenHash} />
          {next !== "/account" ? <input type="hidden" name="next" value={next} /> : null}
          <button className="btn btn-cyan" type="submit">{settingPassword ? "Continue" : "Open my account"}</button>
        </form>
        {phone ? (
          <p className="sub" style={{ marginTop: 14 }}>
            Trouble getting in? Ring us on{" "}
            <a href={`tel:${phone.replace(/\s+/g, "")}`} style={{ color: "var(--ink)", fontWeight: 700 }}>{phone}</a>.
          </p>
        ) : null}
      </div>
    </div>
  );
}
