import type { ReactNode } from "react";

/** The dimmer behind a side sheet. */
export function Scrim({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return <div className={`scrim ${on ? "on" : ""}`} onClick={onClick} />;
}

/** A side sheet. Its content is the caller's; only the chrome is shared. */
export function Sheet({ open, children, testId }: { open: boolean; children?: ReactNode; testId?: string }) {
  return <div className={`sheet ${open ? "open" : ""}`} data-testid={testId}>{children}</div>;
}

/** The bottom toast. Empty text hides it. */
export function Toast({ text }: { text: string }) {
  return <div className={`toast ${text ? "show" : ""}`}><b>{text}</b></div>;
}
