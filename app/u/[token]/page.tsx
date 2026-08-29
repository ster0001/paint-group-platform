import { accountFromToken } from "@/lib/campaigns/send";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribed · Paint Group", robots: { index: false, follow: false } };

/**
 * One-click unsubscribe. Public, no login, no session — the person clicking is
 * by definition not signed in, and asking them to log in to stop emails is how
 * a spam complaint happens instead.
 *
 * The token is an HMAC over the account id, so editing the URL cannot
 * unsubscribe somebody else. Writing it needs the service client, because the
 * visitor has no rights to the accounts table at all.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const accountId = accountFromToken(token);

  let done = false;
  const db = accountId ? createServiceClient() : null;
  if (accountId && db) {
    const { error } = await db
      .from("accounts")
      .update({ marketing_unsubscribed_at: new Date().toISOString() })
      .eq("id", accountId)
      .is("marketing_unsubscribed_at", null);
    // Already unsubscribed is a success, not an error: the person asked twice
    // and the answer is the same.
    done = !error;
  }

  return (
    <main style={{
      minHeight: "100vh", display: "grid", placeItems: "center", padding: 24,
      background: "#F6F8F9", color: "#12161A",
      font: "400 16px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
    }}>
      <div style={{ maxWidth: 460, background: "#fff", border: "1px solid #E4E8EB", borderRadius: 14, padding: "28px 30px" }}>
        <p style={{ margin: "0 0 6px", font: "600 15px/1 inherit", letterSpacing: "-.02em" }}>Paint Group</p>
        {accountId && done ? (
          <>
            <h1 style={{ margin: "10px 0 8px", font: "600 22px/1.3 inherit", letterSpacing: "-.02em" }}>
              Done — you&rsquo;re unsubscribed.
            </h1>
            <p style={{ margin: 0, color: "#6B747C" }}>
              You won&rsquo;t get any more marketing emails from us. Anything about a job you&rsquo;ve
              actually booked — your estimate, your invoice, your work order — still comes through,
              because that&rsquo;s us doing the work you asked for.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ margin: "10px 0 8px", font: "600 22px/1.3 inherit", letterSpacing: "-.02em" }}>
              That link didn&rsquo;t work.
            </h1>
            <p style={{ margin: 0, color: "#6B747C" }}>
              It may have been cut in half by your email program. Reply to any email from us with
              &ldquo;unsubscribe&rdquo; and we&rsquo;ll take you off by hand — you don&rsquo;t have to
              chase it twice.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
