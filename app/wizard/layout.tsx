import "./wizard.css";

/**
 * The wizard is a full-screen, design-locked surface (mockup:
 * design/reference/floorplan-wizard-mockup.html) — no staff sidebar. Staff
 * gating happens in page.tsx; at Step 8 this same shell serves customers.
 */
export default function WizardLayout({ children }: { children: React.ReactNode }) {
  return <div className="wz">{children}</div>;
}
