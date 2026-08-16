// Shared empty state for the portal tabs whose features land in later phases.
// Deliberately shows no sample data — a contractor should never see numbers that
// aren't theirs.
export default function Placeholder({
  title,
  slab,
  icon,
  heading,
  body,
  soon,
}: {
  title: string;
  slab: string;
  icon: string;
  heading: string;
  body: string;
  soon: string;
}) {
  return (
    <div className="wrap">
      <h1>{title}</h1>
      <p className="slab">{slab}</p>
      <div className="empty">
        <i aria-hidden>{icon}</i>
        <b>{heading}</b>
        {body}
        <div>
          <span className="soon">{soon}</span>
        </div>
      </div>
    </div>
  );
}
