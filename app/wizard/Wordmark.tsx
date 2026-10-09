/** The wizard header's top-left identity: the company logo from Settings
 * (the light-background one since 5 Oct 2026 — the wizard is light; the
 * caller falls back to logo 1) when one is set, otherwise the monospace
 * wordmark it always had. Server and client safe. */
export default function Wordmark({ logoUrl }: { logoUrl?: string | null }) {
  return logoUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="wz-logo" src={logoUrl} alt="Paint Group" />
    : <div className="wz-wm">PAINT<span>—</span>GROUP</div>;
}
