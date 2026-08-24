import "./invoice.css";

export default function NotFound() {
  return (
    <div className="invoice-view" style={{ display: "grid", placeItems: "center", padding: "60px 20px" }}>
      <div style={{ textAlign: "center", color: "#c6ccd1", maxWidth: 420 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: ".12em", color: "#edf0f2", marginBottom: 18 }}>
          PAINT<span style={{ color: "#3bd8e9" }}>GROUP</span>
        </div>
        <h1 style={{ fontSize: 19, color: "#edf0f2", marginBottom: 10 }}>This invoice link isn&apos;t active</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6 }}>
          It may not have been issued yet, or the link may be out of date. Please reply to the
          email it arrived with, or call us on{" "}
          <a href="tel:0388409414" style={{ color: "#3bd8e9" }}>03 8840 9414</a> and we&apos;ll sort it out.
        </p>
      </div>
    </div>
  );
}
