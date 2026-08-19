import "../wizard/wizard.css";

/** The public customer wizard shares the wizard's design-locked dark shell. */
export default function EstimateLayout({ children }: { children: React.ReactNode }) {
  return <div className="wz">{children}</div>;
}
