"use client";

import { leadMoney, type LeadSnapshot } from "@/lib/estimate/leadSnapshot";
import { ChatPanel, useEstimateChat } from "./EstimateChat";

/**
 * The lead's page (automations ruling A‑F, Tom 11 Nov 2026): `/e/[token]`
 * before an estimate is sent. The range the customer was shown — read from
 * the SNAPSHOT the wizard kept, never the live draft — and the chat, the one
 * implementation the sent estimate uses. No accept, no options, no document:
 * this is a guide range, and the page says so.
 */
const pricedFmt = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Melbourne" });
const relTime = (iso: string): string => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function LeadRange({ snapshot, token, company }: {
  snapshot: LeadSnapshot;
  token: string;
  company: { name: string; phone: string; logoUrl: string };
}) {
  const chat = useEstimateChat(token, true);
  const s = snapshot;
  const tel = company.phone.replace(/[^\d+]/g, "");
  return (
    <>
      <header className="topbar">
        {company.logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="brandlogo" src={company.logoUrl} alt={company.name} />
          : <div className="wordmark">{company.name}</div>}
        <div className="topmeta"><span className="validity">Your price range</span></div>
      </header>

      <main className="wrap" data-testid="lead-page">
        <div className="hero cutin">
          <p className="eyebrow">Worked out {pricedFmt(s.pricedAt)} from your answers online</p>
          <h1 data-testid="lead-greeting">{s.firstName ? `Hi ${s.firstName}, here's your range` : "Here's your range"}</h1>
          {s.address && <p className="address" data-testid="lead-address">{s.address}</p>}
          <div className="pricecard">
            <div>
              <div className="pricelabel">Your range · incl. GST</div>
              <div className="price" data-testid="lead-range">{leadMoney(s.rangeLoCents)} – {leadMoney(s.rangeHiCents)}</div>
              {s.parts && (
                <p className="viewnote" data-testid="lead-parts">
                  Inside {leadMoney(s.parts.interior.rangeLoCents)} – {leadMoney(s.parts.interior.rangeHiCents)} · Outside {leadMoney(s.parts.exterior.rangeLoCents)} – {leadMoney(s.parts.exterior.rangeHiCents)}
                </p>
              )}
            </div>
            <div className="cta-row print-hide">
              <a className="btn btn-primary" href="#chatbox">Ask a question</a>
              {tel && <a className="btn btn-ghost" href={`tel:${tel}`} data-testid="lead-call">Call {company.phone}</a>}
            </div>
          </div>
          <p className="viewnote" data-testid="lead-note">
            {s.biggerJob
              ? "This one's bigger than we can price from a phone, so we'll come and look. Everything you entered is kept, and nothing is asked twice."
              : "This is a guide from what you told us. Your price is confirmed with you before anything is fixed — ask us anything below."}
          </p>
        </div>

        <section style={{ marginTop: 28 }} data-testid="lead-chat">
          <ChatPanel
            chat={chat}
            staffName={company.name}
            relTime={relTime}
            intro={<>Ask us anything about your range. We&apos;ll reply here and let you know by text and email.</>}
          />
        </section>
      </main>
    </>
  );
}
