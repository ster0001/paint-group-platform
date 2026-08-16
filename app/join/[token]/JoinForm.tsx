"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Where an invited painter sets a password and becomes a contractor.
 *
 * The email is fixed to the invited address and cannot be edited: the token is
 * bound to it server-side, so letting someone type a different address would
 * only produce a confusing rejection.
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function join() {
    setErr("");
    if (password.length < 8) return setErr("Use at least 8 characters for your password.");
    if (password !== confirm) return setErr("The two passwords don't match.");

    setBusy(true);
    try {
      // Create the account, or sign in if they already started and came back.
      const { error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name: fullName } },
      });
      if (signUpErr) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) {
          throw new Error(
            /already registered/i.test(signUpErr.message)
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
        };
        throw new Error(map[res] ?? res.replace("error:", ""));
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
