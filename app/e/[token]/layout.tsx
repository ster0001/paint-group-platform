import type { Metadata } from "next";
import "../customer.css";

export const metadata: Metadata = {
  title: "Your estimate · Paint Group",
  robots: { index: false, follow: false }, // token pages must not be indexed
};

export default function CustomerLayout({ children }: LayoutProps<"/e/[token]">) {
  return <div className="cv">{children}</div>;
}
