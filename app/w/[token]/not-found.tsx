import "../workorder.css";

export default function NotFound() {
  return (
    <div className="wo">
      <div className="wrap" style={{ textAlign: "center", paddingTop: 80 }}>
        <div className="wo-brand">Paint Group · Work order</div>
        <h1 style={{ marginTop: 12 }}>This work order link isn&apos;t active</h1>
        <p className="wo-addr" style={{ marginTop: 8 }}>
          The link may be incorrect, or the work order hasn&apos;t been issued yet. Check with the office.
        </p>
      </div>
    </div>
  );
}
