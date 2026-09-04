import TelLink from "../_components/TelLink";
import TrackedLink from "../_components/TrackedLink";

/** §2 — the sticky bottom call bar on <960px, exactly as the prototype. The
 *  wrapper's bottom padding keeps content from hiding behind it. */
export default function CallBar() {
  return (
    <div className="callbar">
      <TelLink where="callbar" className="btn btn-ghost">Call us</TelLink>
      <TrackedLink href="#top" ev="nav_cta" evProps={{ where: "callbar" }} className="btn btn-cyan">See my price</TrackedLink>
    </div>
  );
}
