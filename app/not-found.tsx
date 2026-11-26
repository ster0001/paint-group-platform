import Link from "next/link";

/**
 * The 404 for any address no route answers (go-live check, 25 Nov 2026: it
 * was Next's default under the title "Paint Group Platform", on
 * painthome.com.au too). Brand-neutral on purpose — it is served on every
 * host, so it names neither shopfront. Unknown /work slugs keep the
 * marketing 404 (app/(marketing)/not-found.tsx).
 */
export default function NotFound() {
  return (
    <main style={{ minHeight: "70svh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <title>Page not found</title>
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <p style={{ fontSize: 13, letterSpacing: ".08em", color: "#6b7280" }}>404</p>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: "8px 0 12px" }}>That page isn&rsquo;t here.</h1>
        <p style={{ color: "#4b5563", marginBottom: 24 }}>The address may be mistyped, or the page may have moved.</p>
        <Link href="/" style={{ textDecoration: "underline" }}>Back to the home page</Link>
      </div>
    </main>
  );
}
