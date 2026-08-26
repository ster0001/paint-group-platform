import type { Metadata } from "next";
import "./account.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your Paint Group account",
  robots: { index: false, follow: false },
};

// The customer portal (phase 3). This outer layout only carries the scoped
// stylesheet — /account/login and /account/auth render without the app
// shell; the (portal) group adds the gated header + tabs.
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <div className="acct">{children}</div>;
}
