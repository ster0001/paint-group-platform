import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import JoinForm from "./JoinForm";
import "@/app/portal/portal.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join Paint Group",
  robots: { index: false, follow: false }, // invite links must never be indexed
};

type Preview = { email: string; name: string; company_name: string; status: string };

// A token that has never existed 404s, the same as /e/ and /w/. The friendly
// pages below are for links that WERE real — telling those apart is helpful to
// the painter holding one. Doing the same for an unknown string would answer a
// question only someone guessing tokens is asking: it confirms the difference
// between "no such invite" and "an invite that was revoked".
const MESSAGES: Record<string, { heading: string; body: string }> = {
  revoked: {
    heading: "This link has been cancelled",
    body: "Paint Group withdrew this invitation. Give them a call if you think that's a mistake.",
  },
  used: {
    heading: "This link has already been used",
    body: "Your account exists — just sign in with the email Paint Group invited.",
  },
  expired: {
    heading: "This link has expired",
    body: "Invitations last a week. Ask Paint Group to send a fresh one and it'll only take a minute.",
  },
};

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();

  // Read through a security-definer function — an un-authenticated visitor never
  // gets a select on the invites table.
  const { data } = await supabase.rpc("contractor_invite_preview", { p_token: token });
  const preview = (Array.isArray(data) ? data[0] : data) as Preview | undefined;
  const status = preview?.status ?? "not_found";

  if (status !== "valid") {
    const m = MESSAGES[status];
    if (!m) notFound(); // unknown token — and anything unrecognised is treated as one
    return (
      <div className="pt">
        <div className="phone" style={{ paddingBottom: 24 }}>
          <header className="hd">
            <span className="wm">
              PAINT<span>—</span>GROUP
            </span>
          </header>
          <div className="wrap">
            <div className="empty" style={{ marginTop: 40 }}>
              <i aria-hidden>🔗</i>
              <b>{m.heading}</b>
              {m.body}
            </div>
            <a href="/login" className="btn gh">
              Go to sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <JoinForm
      token={token}
      email={preview!.email}
      name={preview!.name}
      company={preview!.company_name}
    />
  );
}
