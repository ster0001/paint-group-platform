import type { Metadata } from "next";
import "../customer.css";
import { estimateBrandByToken } from "@/lib/estimate/brandByToken";
import { brandRecord } from "@/lib/messaging/brand";

/** Paint Home brief §5: the tab title carries the estimate's brand. Token pages are never indexed. */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    title: `Your estimate · ${brandRecord(await estimateBrandByToken(token)).name}`,
    robots: { index: false, follow: false },
  };
}

export default function CustomerLayout({ children }: LayoutProps<"/e/[token]">) {
  return <div className="cv">{children}</div>;
}
