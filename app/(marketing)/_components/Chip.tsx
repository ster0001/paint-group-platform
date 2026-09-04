import type { ButtonHTMLAttributes } from "react";

/** A pressed/unpressed pill (the hero's `This is` chips, the /work filters). */
export default function Chip({
  pressed, children, className, ...rest
}: { pressed: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`chip${className ? ` ${className}` : ""}`} aria-pressed={pressed} {...rest}>
      {children}
    </button>
  );
}
