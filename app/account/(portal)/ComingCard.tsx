import { getPortalContext } from "@/lib/portal/data";

/**
 * The honest not-yet state for portal tabs whose content arrives in later
 * 3a sessions. Never a dead end (§7): it says what will live here, what to
 * do meanwhile, and shows the phone number.
 */
export default async function ComingCard({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const ctx = await getPortalContext();
  const phone = ctx?.companyPhone ?? "";
  return (
    <div>
      <h1>{title}</h1>
      <div className="card raised">
        <p className="sub">{body}</p>
      </div>
      <div className="card">
        <p className="sub" style={{ marginBottom: phone ? 14 : 0 }}>
          Need it sooner?{" "}
          {phone ? (
            <>Ring us on <b style={{ color: "var(--text)" }}>{phone}</b> and we&rsquo;ll send it to you today.</>
          ) : (
            <>Reply to any of our emails and we&rsquo;ll send it to you today.</>
          )}
        </p>
        {phone && <a className="btn btn-ghost" href={`tel:${phone.replace(/\s+/g, "")}`}>Call us</a>}
      </div>
    </div>
  );
}
