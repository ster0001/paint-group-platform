import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

type Tone = "cyan" | "ink" | "ghost";

type LinkProps = { href: string; tone?: Tone } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">;
type ButtonProps = { href?: undefined; tone?: Tone } & ButtonHTMLAttributes<HTMLButtonElement>;

/** The prototype's `.btn` pill — a link when it has an href, else a button. */
export default function Button(props: LinkProps | ButtonProps) {
  const tone = props.tone ?? "cyan";
  if (props.href !== undefined) {
    const { href, tone: _t, className, children, ...rest } = props;
    void _t;
    const cls = `btn btn-${tone}${className ? ` ${className}` : ""}`;
    return href.startsWith("/")
      ? <Link href={href} className={cls} {...rest}>{children}</Link>
      : <a href={href} className={cls} {...rest}>{children}</a>;
  }
  const { tone: _t, className, children, type, ...rest } = props;
  void _t;
  return (
    <button type={type ?? "button"} className={`btn btn-${tone}${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </button>
  );
}
