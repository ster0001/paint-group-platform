"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isAuMobile } from "@/lib/validation/contact";

/**
 * Where an invited painter sets a password and becomes a contractor.
 *
 * The email is fixed to the invited address and cannot be edited: the token is
 * bound to it server-side, so letting someone type a different address would
 * only produce a confusing rejection.
 *
 * A mobile is REQUIRED to join (Tom, 7 Oct 2026): job offers, approved
 * variations and the "update your work order" texts all go to it, and three
 * painters without one had nine jobs' reminders silently skipped. It is
 * written to their own contractors row (contractors_self_update + the
 * 20261223 column grant) straight after the invite is redeemed.
 */
export default function JoinForm({
  token,
  email,
  name,
  company,
}: {
  token: string;
  email: string;
  name: string;
  company: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fullName, setFullName] = useState(name);
  const [mobile, setMobile] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function join() {
    setErr("");
    if (password.length < 8) return setErr("Use at least 8 characters for your password.");
    if (password !== confirm) return setErr("The two passwords don't match.");
    if (!mobile.trim()) return setErr("Your mobile is required — job offers and reminders come to it by text.");
    if (!isAuMobile(mobile)) return setErr("That doesn't look like a full Australian mobile (04xx xxx xxx).");

    setBusy(true);
    try {
      // Create the account, or sign in if they already started and came back.
      // Supabase answers a sign-up for an email that already has an account
      // with NO error and NO session (anti-enumeration), so "no session" is
      // the signal to sign in, not just an error.
      const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name: fullName } },
      });
      if (signUpErr || !signUp?.session) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) {
          throw new Error(
            !signUpErr || /already registered/i.test(signUpErr.message)
              ? "There's already an account for this email. Sign in instead, or use a different password if you've forgotten it."
              : signUpErr.message,
          );
        }
      }

      // Promote to contractor and create their record from the invite.
      const { data, error } = await supabase.rpc("redeem_contractor_invite", { p_token: token });
      if (error) throw error;
      const res = String(data ?? "");
      if (res.startsWith("error:")) {
        const map: Record<string, string> = {
          "error:email_mismatch": "This invitation was sent to a different email address.",
          "error:expired": "This invitation has expired — ask Paint Group for a new link.",
          "error:used": "This invitation has already been used. Try signing in instead.",
          "error:revoked": "Paint Group cancelled this invitation.",
          "error:not_found": "This link isn't valid any more.",
          "error:not_signed_in": "We couldn't sign you in just now — try again in a moment.",
        };
        throw new Error(map[res] ?? res.replace("error:", ""));
      }

      // Their mobile, on their own contractors row. The portal profile page
      // asks again if this write fails — the account is already made, so the
      // join must not be retried (the invite is used).
      const { data: who } = await supabase.auth.getUser();
      if (who.user) {
        const { error: phoneErr } = await supabase.from("contractors").update({ phone: mobile.trim() }).eq("profile_id", who.user.id);
        if (phoneErr) console.error("join: mobile not saved", phoneErr.message);
      }

      // refresh() first so the server re-reads the profile — the role only became
      // 'contractor' a moment ago, and the portal gate reads it server-side.
      router.refresh();
      router.replace("/portal");
    } catch (e) {
      setErr(typeof e === "object" && e !== null && "message" in e ? String((e as { message: string }).message) : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="pt">
      <div className="phone" style={{ paddingBottom: 30 }}>
        <header className="hd">
          <span className="wm">
            PAINT<span>—</span>GROUP
          </span>
          <span className="who">
            Contractor
            <b>Invitation</b>
          </span>
        </header>

        <div className="wrap">
          <h1>You&rsquo;ve been invited</h1>
          <p className="slab">Set a password and your portal is ready</p>

          <div className="card">
            <div className="frow">
              <span className="l">Email</span>
              <span className="v">{email}</span>
            </div>
            {company && (
              <div className="frow">
                <span className="l">Company</span>
                <span className="v">{company.toUpperCase()}</span>
              </div>
            )}
          </div>

          {err && <div className="err">{err}</div>}

          <div className="card">
            <label className="fl" htmlFor="fullName">Your name</label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Josef Kovac"
            />

            <label className="fl" htmlFor="mobile">Your mobile (required)</label>
            <input
              id="mobile"
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="04xx xxx xxx"
              autoComplete="tel"
              required
              data-testid="join-mobile"
            />
            <p className="hint" style={{ marginTop: 4 }}>
              Job offers, approved changes and reminders to update your work order come to this number by text.
            </p>

            <label className="fl" htmlFor="pw">Choose a password</label>
            <input
              id="pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />

            <label className="fl" htmlFor="pw2">Type it again</label>
            <input
              id="pw2"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />

            <button className="btn cy" disabled={busy} onClick={join}>
              {busy ? "Setting up…" : "Create my account"}
            </button>
          </div>

          <p className="hint" style={{ padding: "0 2px" }}>
            Next you&rsquo;ll add your ABN, bank details and insurance certificate —
            Paint Group can&rsquo;t offer you work until the insurance is on file.
          </p>
        </div>
      </div>
    </div>
  );
}
