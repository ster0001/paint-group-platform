/** The wizard header's top-left identity: the company logo from Settings
 * (logo 1 — the dark-background one; the wizard is dark) when one is set,
 * otherwise the monospace wordmark it always had. Server and client safe. */
export default function Wordmark({ logoUrl }: { logoUrl?: string | null }) {
  return logoUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className="wz-logo" src={logoUrl} alt="Paint Group" />
    : <div className="wz-wm">PAINT<span>—</span>GROUP</div>;
}
