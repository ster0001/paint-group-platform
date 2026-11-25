"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import { CONSENT_COOKIE, parseConsent } from "@/lib/marketing/consent";
import { loadAdTags, pushSuccessToDataLayer, type AdTagIds } from "@/lib/marketing/adTags";
import type { SuccessMoment } from "@/lib/marketing/success";

/**
 * The success page's moment: our own event (always), the ad tags (only after
 * "Allow analytics"), then back to where the customer was. A hidden-frame
 * visit records and shows nothing.
 */
export default function ThanksClient({ moment, back, background, tags, brandName, title, line, phoneTel }: {
  moment: SuccessMoment; back: string; background: boolean; tags: AdTagIds; brandName: string; title: string; line: string; phoneTel: string;
}) {
  useEffect(() => {
    track("success_page", { moment, background });
    if (parseConsent(document.cookie) === "analytics") {
      loadAdTags(tags);
      pushSuccessToDataLayer(moment, background); // Tag Manager's trigger (Paint Home's container, lib/marketing/gtm.ts)
    }
    if (background) return;
    const t = window.setTimeout(() => window.location.replace(back), 1800);
    return () => window.clearTimeout(t);
  }, [moment, back, background, tags]);

  if (background) return null;
  return (
    <div style={{ maxWidth: 420, textAlign: "center" }} data-consent-cookie={CONSENT_COOKIE}>
      <p style={{ fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase", color: "#6b6b6b", margin: 0 }}>{brandName}</p>
      <h1 style={{ fontSize: 26, margin: "10px 0 8px" }} data-testid="thanks-title">{title}</h1>
      <p style={{ color: "#444", margin: "0 0 20px" }}>{line}</p>
      <a href={back} data-testid="thanks-back" style={{ display: "inline-block", padding: "12px 20px", borderRadius: 10, background: "#1f1f1f", color: "#fff", textDecoration: "none" }}>Back</a>
      {moment === "call-tap" && <p style={{ marginTop: 14 }}><a href={phoneTel} style={{ color: "#1f1f1f" }}>Call us</a></p>}
    </div>
  );
}
