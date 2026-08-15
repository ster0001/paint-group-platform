export default function NotFound() {
  return (
    <div className="deadlink">
      <div className="wordmark" style={{ marginBottom: 24 }}>PAINT<span>—</span>GROUP</div>
      <h1>This estimate link isn&apos;t active</h1>
      <p>
        It may have expired or been updated since it was sent. Give us a call on{" "}
        <a href="tel:0388409414" style={{ color: "var(--cyan)" }}>03 8840 9414</a> and we&apos;ll get you a fresh one.
      </p>
    </div>
  );
}
