"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { reportIfError } from "@/lib/monitoring/report";
import type { CustomerSnapshot, SnapshotPaint } from "@/lib/customer/snapshot";
import { DEFAULT_DEPOSIT_PCT } from "@/lib/invoicing/settings";
import PresentationBlocks from "./PresentationBlocks";
import SignaturePad from "@/app/components/SignaturePad";
import "../customer.css";

// The public token page keeps this row shape; the builder passes a live snapshot
// with preview=true (no token, no writes).
export type EstimateRow = {
  id: string;
  status: string;
  snapshot: CustomerSnapshot;
  accepted_name: string | null;
  accepted_at: string | null;
  declined_reason: string | null;
  valid_until: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  selected_options: string[] | null;
};

const money2 = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const relTime = (iso: string): string => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const money0 = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");
const dateFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "");

const DECLINE_PICKS = ["Went with another quote", "Postponing", "Price", "Other"];

export type CustomerChanges = {
  accepted_total_cents: number;
  adjusted_total_cents: number;
  variations: {
    id: string; comment: string; category: string; price_cents: number;
    credit: boolean; status: string; signed_name: string | null;
    signed_at: string | null; token: string | null;
  }[];
};

export default function CustomerEstimate({
  snapshot: snap, token, status = "sent", acceptedName = null,
  validUntil = null, sentAt = null, selectedOptionsInit = null, preview = false,
  changes = null, docLabel = "Estimate", fromPortal = false, referencesLine = null,
}: {
  snapshot: CustomerSnapshot;
  token?: string;
  status?: string;
  acceptedName?: string | null;
  validUntil?: string | null;
  sentAt?: string | null;
  selectedOptionsInit?: string[] | null;
  preview?: boolean;
  /** Signed / awaiting variations + adjusted total (accepted jobs only). */
  changes?: CustomerChanges | null;
  /** "Invoice" when the revision builder previews the final invoice (Tom,
   * 24 Aug close-off) — the document's own name, shown in the eyebrow. */
  docLabel?: "Estimate" | "Invoice";
  /** True when the customer arrived from their portal — shows a way back. */
  fromPortal?: boolean;
  /** Trade portal v2 §5.4: the property's references (Owner / PO / Claim),
   * printed on the document — screen and PDF alike. */
  referencesLine?: string | null;
}) {
  const gstRate = (snap.gstRatePct ?? 10) / 100;
  // Invoice dress (Tom, 24 Aug close-off): the revision preview is the
  // INVOICE the customer will see — no acceptance machinery, no quote-speak.
  const invoiceMode = docLabel === "Invoice";
  const interactive = !preview && !!token; // real customer page can write; builder preview cannot

  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedOptionsInit ?? []));
  // Null until an acceptance happens in this session. False means the drawn
  // signature did not store — acceptance still counts, but we say so rather
  // than letting the customer believe we hold something we don't.
  const [signatureSaved, setSignatureSaved] = useState<boolean | null>(null);
  const [done, setDone] = useState<null | "accepted" | "declined">(
    status === "accepted" ? "accepted" : status === "declined" ? "declined" : null,
  );
  // A staff reply links the customer to #chat — the effect below opens the
  // chat after mount (an initializer that reads location.hash renders
  // differently on the server and fails hydration).
  const [panel, setPanel] = useState<null | "accept" | "decline" | "ask" | "chat">(null);
  const [thread, setThread] = useState<{ id: string; direction: "staff" | "customer"; body: string; author_name: string | null; created_at: string }[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [name, setName] = useState(snap.contactName || "");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [declinePick, setDeclinePick] = useState("");
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const optionsSubtotal = useMemo(
    () => snap.options.filter((o) => selected.has(o.id)).reduce((n, o) => n + o.priceCents, 0),
    [snap.options, selected],
  );
  const discountMode = snap.discountMode ?? "pct";
  const discountPct = snap.discountPct ?? 0;
  const grossSubtotal = snap.baseSubtotalCents + optionsSubtotal;
  const discount = discountMode === "fixed"
    ? Math.min(snap.discountFixedCents ?? 0, grossSubtotal)
    : Math.round(grossSubtotal * discountPct / 100);
  const subtotal = grossSubtotal - discount;
  const gst = Math.round(subtotal * gstRate);
  const total = subtotal + gst;
  // Every snapshot since the builder existed carries its own depositPct; the
  // fallback is the shared invoicing default, never a literal (Tom's ruling).
  const depositPct = snap.depositPct ?? DEFAULT_DEPOSIT_PCT;
  const deposit = Math.round(total * depositPct / 100);

  // view + dwell tracking (real customer page only, never the builder preview)
  useEffect(() => {
    if (!interactive) return;
    const supabase = createClient();
    const session = crypto.randomUUID();
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    let ms = 0;
    // NB: the supabase query builder is lazy — it only fires when awaited, so
    // this must await (a bare `supabase.rpc(...)` would never send the request).
    const ping = async () => {
      // Genuinely best-effort — a customer must never see a failure to record
      // that they looked at their own estimate. It still leaves a trace.
      reportIfError(
        await supabase.rpc("record_estimate_view", { p_token: token, p_session: session, p_ua: ua, p_ms: ms }),
        { where: "estimate.viewPing", bestEffort: true },
      );
    };
    ping();
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") { ms += 15000; ping(); }
    }, 15000);
    return () => clearInterval(iv);
  }, [token, interactive]);

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function accept() {
    if (!name.trim()) { setErr("Please enter your full name."); return; }
    if (!signatureData) { setErr("Please sign in the box to confirm."); return; }
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("accept_estimate", {
      p_token: token, p_name: name.trim(), p_options: [...selected], p_total_cents: total, p_deposit_cents: deposit,
    });
    if (error) { setBusy(false); setErr(error.message); return; }

    // The signature is saved separately, and acceptance stands whether or not
    // this succeeds — but it must not fail SILENTLY, which is what it used to
    // do. (Doubly so: the rpc returns { error } rather than throwing, so the
    // old try/catch never fired and the error was dropped unread.)
    const sig = await supabase.rpc("save_estimate_signature", {
      p_token: token,
      p_signature: signatureData,
    });
    setSignatureSaved(reportIfError(sig, { where: "estimate.signature", extra: { token } }));

    setBusy(false);
    setDone("accepted"); setPanel(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function decline() {
    setBusy(true); setErr("");
    const reason = [declinePick, declineReason.trim()].filter(Boolean).join(" — ");
    const supabase = createClient();
    const { error } = await supabase.rpc("decline_estimate", { p_token: token, p_reason: reason });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone("declined"); setPanel(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function ask() {
    if (!question.trim()) { setErr("Type your question first."); return; }
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("ask_estimate_question", { p_token: token, p_message: question.trim() });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setAsked(true); setQuestion("");
  }

  // ---- live chat (two-way) --------------------------------------------------
  const loadThread = useCallback(async () => {
    if (!interactive) return;
    const supabase = createClient();
    const { data } = await supabase.rpc("get_estimate_thread_by_token", { p_token: token });
    setThread((data as typeof thread) ?? []);
  }, [interactive, token]);

  useEffect(() => {
    if (!interactive) return;
    // loadThread awaits the RPC before any setState — it's a subscribe-style
    // fetch, not a synchronous render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadThread();
    if (typeof window !== "undefined" && window.location.hash === "#chat") {
      setPanel("chat");
      setTimeout(() => document.getElementById("chatbox")?.scrollIntoView({ behavior: "smooth" }), 200);
    }
    const iv = setInterval(loadThread, 15000); // keep the conversation live
    return () => clearInterval(iv);
  }, [interactive, loadThread]);

  async function sendMessage() {
    const body = chatDraft.trim();
    if (!body) return;
    setChatBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.rpc("post_estimate_message_by_token", { p_token: token, p_body: body });
    setChatBusy(false);
    if (error) { setErr(error.message); return; }
    setChatDraft("");
    await loadThread();
  }

  // One chat, reused before AND after the decision — the same thread the
  // portal's Messages tab reads, so the conversation never has two homes.
  const chatUi = (
    <div className="panelbox" id="chatbox">
      <h3>Chat with us</h3>
      <div className="chatthread">
        {thread.length === 0
          ? <p className="sub" style={{ margin: "4px 0 10px" }}>Ask us anything about your estimate — we&apos;ll reply here and let you know by text and email.</p>
          : thread.map((m) => (
              <div key={m.id} className={`chatrow ${m.direction === "customer" ? "mine" : "theirs"}`}>
                <div className="chatbubble">
                  <div className="chatbody">{m.body}</div>
                  <div className="chatmeta">{m.direction === "staff" ? (m.author_name || "Paint Group") : "You"} · {relTime(m.created_at)}</div>
                </div>
              </div>
            ))}
      </div>
      <label className="field">
        <textarea
          rows={3} value={chatDraft}
          onChange={(e) => setChatDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMessage(); } }}
          placeholder="Type your message…"
        />
      </label>
      <button className="btn btn-primary" onClick={sendMessage} disabled={chatBusy || chatDraft.trim() === ""}>{chatBusy ? "Sending…" : "Send message"}</button>
      {err && <p className="errline">{err}</p>}
    </div>
  );

  const statusChip = done === "accepted"
    ? <span className="status accepted">Accepted</span>
    : done === "declined"
    ? <span className="status declined">Declined</span>
    : <span className="status">Awaiting your approval</span>;

  const est = `EST-${snap.estRef}`;

  return (
    <>
      <header className="topbar">
        {fromPortal && (
          <a className="backlink print-hide" href="/account">← My account</a>
        )}
        {snap.company.logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="brandlogo" src={snap.company.logoUrl} alt={snap.company.name} />
          : <div className="wordmark">PAINT<span>—</span>GROUP</div>}
        <div className="topmeta">
          {invoiceMode ? (
            <span className="validity">{est}</span>
          ) : (
            <>
              <span className="validity">{est} · valid until {dateFmt(validUntil)}</span>
              {statusChip}
            </>
          )}
        </div>
      </header>

      <main className="wrap">
        {done === "accepted" && (
          <div className="resultbanner accepted" style={{ marginTop: 28 }}>
            <span className="tick">✓</span>
            <span>
              {/* No promise about a deposit invoice here (Tom, 23 Aug) — what
                  happens next is arranged with the customer, not stated by the
                  estimate page. */}
              Estimate accepted{acceptedName ? ` by ${acceptedName}` : ""}. We&apos;ll be in touch shortly.
              {signatureSaved === false && (
                <> Your acceptance is recorded, though we couldn&apos;t store the signature image &mdash; we may ask you to sign again.</>
              )}
            </span>
          </div>
        )}

        {/* Changes since acceptance (24 Aug follow-up): the signed variations
            move the customer's own figures HERE, on their page — and anything
            still awaiting their signature links straight to its signing page. */}
        {done === "accepted" && changes && changes.variations.length > 0 && (
          <section id="changes" className="resultbanner accepted" style={{ marginTop: 14, display: "block" }} data-testid="customer-changes">
            <b style={{ fontSize: 15 }}>Changes to your job</b>
            <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
              {changes.variations.map((v) => (
                <li key={v.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, padding: "7px 0", borderTop: "1px solid rgba(255,255,255,0.12)", fontSize: 13.5 }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>
                    {v.credit ? "−" : "+"}{money2(v.price_cents)}
                  </span>
                  <span>{v.comment || v.category.replace(/_/g, " ")}</span>
                  {v.status === "priced" && v.token ? (
                    <a href={`/v/${v.token}`} style={{ marginLeft: "auto", color: "inherit", textDecoration: "underline" }} data-testid={`sign-change-${v.id}`}>
                      Review &amp; sign →
                    </a>
                  ) : (
                    <em style={{ marginLeft: "auto", fontStyle: "normal", fontSize: 12, opacity: 0.8 }}>
                      Signed{v.signed_name ? ` by ${v.signed_name}` : ""}{v.signed_at ? ` · ${dateFmt(v.signed_at)}` : ""}
                    </em>
                  )}
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.25)" }} data-testid="updated-total">
              <b>Your updated total</b>
              <b style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 17 }}>{money2(changes.adjusted_total_cents)}</b>
              <span style={{ fontSize: 11, opacity: 0.8 }}>incl. GST</span>
            </div>
            {changes.variations.some((v) => v.status === "priced") && (
              <p style={{ margin: "8px 0 0", fontSize: 12, opacity: 0.85 }}>
                Changes awaiting your signature aren&apos;t in the total yet — they join it the moment you sign.
              </p>
            )}
          </section>
        )}
        {done === "declined" && (
          <div className="resultbanner declined" style={{ marginTop: 28 }}>
            <span className="tick">—</span>
            <span>You&apos;ve declined this estimate. Changed your mind? <a href="tel:0388409414" style={{ color: "inherit", textDecoration: "underline" }}>Call us</a> and we&apos;ll reopen it.</span>
          </div>
        )}

        {/* HERO */}
        <div className="hero cutin">
          <p className="eyebrow">
            {docLabel} <b>{est}</b> · Prepared {dateFmt(sentAt)}{snap.company.estimatorName ? ` · Prepared by ${snap.company.estimatorName}` : ""}
          </p>
          <h1>{snap.jobTitle}</h1>
          <p className="address">{snap.jobAddress || snap.company.addressLine1}{snap.contactName ? ` · For ${snap.contactName}` : ""}</p>
          {referencesLine && <p className="address" data-testid="references-line">{referencesLine}</p>}

          <div className="pricecard">
            <div>
              <div className="pricelabel">{invoiceMode ? "Your invoice · incl. GST" : "Your painting quote · incl. GST"}</div>
              <div className="price">{money0(total)}</div>
            </div>
            {!done && !invoiceMode && (
              <div className="cta-row print-hide">
                <a className="btn btn-primary" href="#accept">Accept estimate</a>
                <button className="btn btn-ghost" onClick={() => { setPanel("ask"); document.getElementById("accept")?.scrollIntoView(); }}>Ask a question</button>
              </div>
            )}
          </div>
          {!invoiceMode && (
            <p className="viewnote">Valid 60 days{validUntil ? `, until ${dateFmt(validUntil)}` : ""}.</p>
          )}

          {!invoiceMode && (
            <div className="cta-row print-hide" style={{ marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => window.print()}>⤓ Download estimate (PDF)</button>
            </div>
          )}

        </div>

        {/* COLOUR CONSULTATION — reassurance callout */}
        {!invoiceMode && (
        <div className="colourbox">
          <div className="cb-title">Colour consultation included</div>
          <p>Colours are confirmed after you accept. We provide unlimited samples, so you can try out for yourself in your own light.</p>
        </div>
        )}

        {/* PRESENTATION BLOCKS — view-only, between hero and scope */}
        {!invoiceMode && snap.presentation?.blocks?.length ? <PresentationBlocks blocks={snap.presentation.blocks} /> : null}

        {/* PHOTOS */}
        {!invoiceMode && snap.areas.some((a) => a.photos.length) && (
          <section>
            <h2>Your home, as we saw it</h2>
            <p className="sub">Photos from your enquiry and our site notes. Your estimate is scoped to these exact rooms and surfaces.</p>
            <div className="photos">
              {snap.areas.flatMap((a) => a.photos).slice(0, 9).map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} className="ph" src={src} alt="" loading="lazy" />
              ))}
            </div>
          </section>
        )}

        {/* SCOPE */}
        {(snap.areas.length > 0 || snap.lineItems.length > 0) && (
          <section>
            <h2>Scope of works, room by room</h2>
            <p className="sub">Every surface, product and coat count — nothing hidden in fine print. Tap a room to see the detail.</p>

            {snap.areas.map((a, i) => (
              <details className="room" key={a.id} open={i === 0}>
                <summary>
                  <span className="room-name">{a.title}</span>
                  <span className="room-meta"><span className="room-price">{money2(a.priceCents)}</span><span className="chev">▾</span></span>
                </summary>
                <div className="room-body">
                  {a.surfaces.map((s, j) => (
                    <div className="surface" key={j}>
                      <div className="s-name">{s.label}</div>
                      <div className="s-coats">{s.coats} {s.coats === 1 ? "COAT" : "COATS"}</div>
                      {s.product && <div className="s-spec">{s.product}</div>}
                    </div>
                  ))}
                </div>
              </details>
            ))}

            {snap.lineItems.map((l) => (
              <details className="room" key={l.id}>
                <summary>
                  <span className="room-name">{l.title}</span>
                  <span className="room-meta"><span className="room-price">{money2(l.priceCents)}</span><span className="chev">▾</span></span>
                </summary>
                <div className="room-body">
                  {hasHtml(l.descriptionHtml)
                    ? <div className="prep" style={{ marginTop: 14 }}><span dangerouslySetInnerHTML={{ __html: l.descriptionHtml }} /></div>
                    : <p className="sub" style={{ marginTop: 14, marginBottom: 0 }}>Included as scoped.</p>}
                </div>
              </details>
            ))}
          </section>
        )}

        {/* THE PAINT WE'RE SUPPLYING */}
        {(snap.paints?.length ?? 0) > 0 && (() => {
          const topcoats = snap.paints.filter((p) => !p.isPrep);
          const preps = snap.paints.filter((p) => p.isPrep);
          const anyStarred = snap.paints.some((p) => p.customerVisible && p.guarantee.includes("*"));
          return (
            <section>
              <h2>The paint we&apos;re supplying</h2>
              <p className="sub">Every product on this job, matched to your surfaces — all paint and materials are included in your price.</p>
              <div className="paints">
                {topcoats.map((p, i) => <PaintCard key={`t${i}`} p={p} />)}
              </div>
              {preps.length > 0 && (
                <>
                  <h3 className="prepsubhead">Preparation products</h3>
                  <div className="paints">
                    {preps.map((p, i) => <PaintCard key={`p${i}`} p={p} />)}
                  </div>
                </>
              )}
              {anyStarred && <p className="paintfine">* Subject to manufacturer&apos;s label conditions.</p>}
              <p className="paintnote">Prefer a different brand or finish? Ask us — we can reprice the same scope with Dulux, Wattyl or another premium range before you accept.</p>
            </section>
          );
        })()}

        {/* OPTIONS */}
        {!invoiceMode && snap.options.length > 0 && (
          <section>
            <h2>Optional extras</h2>
            <p className="sub">Add any of these to your estimate — your total updates instantly, and your selection is saved when you accept.</p>
            {snap.options.map((o) => {
              const on = selected.has(o.id);
              return (
                <div className={`option${on ? " selected" : ""}`} key={o.id}>
                  <button className="option-toggle print-hide" aria-pressed={on} onClick={() => !done && toggle(o.id)}>{on ? "✓" : ""}</button>
                  <div className="option-main">
                    <div className="option-title">{o.title}</div>
                    {hasHtml(o.descriptionHtml) && <div className="option-desc" dangerouslySetInnerHTML={{ __html: o.descriptionHtml }} />}
                  </div>
                  <div className="option-price">+ {money2(o.priceCents)}</div>
                </div>
              );
            })}
          </section>
        )}

        {/* INCLUSIONS */}
        {(snap.inclusions.length > 0 || snap.exclusions.length > 0) && (
          <section>
            <h2>What&apos;s included</h2>
            <p className="sub">And, just as importantly, what isn&apos;t — so there are no surprises on either side.</p>
            <div className="twocol">
              <div className="inc">
                <div className="listhead">Included in your price</div>
                <ul className="checklist">{snap.inclusions.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
              {snap.exclusions.length > 0 && (
                <div className="exc">
                  <div className="listhead">Not included</div>
                  <ul className="checklist">{snap.exclusions.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* INVESTMENT */}
        <section>
          <h2>Your painting quote</h2>
          <p className="sub">One price. Pay by card, or bank transfer — whatever suits.</p>
          <div className="table">
            <div className="trow"><span className="l">Painting works as scoped</span><span className="v">{money2(snap.baseSubtotalCents)}</span></div>
            {snap.options.filter((o) => selected.has(o.id)).map((o) => (
              <div className="trow" key={o.id}><span className="l">{o.title}</span><span className="v">{money2(o.priceCents)}</span></div>
            ))}
            {discount > 0 && (
              <div className="trow"><span className="l">Discount{discountMode === "pct" ? ` (${discountPct}%)` : ""}</span><span className="v">− {money2(discount)}</span></div>
            )}
            <div className="trow"><span className="l">GST</span><span className="v">{money2(gst)}</span></div>
            <div className="trow total"><span className="l">Total incl. GST</span><span className="v">{money2(total)}</span></div>
          </div>
          {!invoiceMode && (
          <div className="deposit">
            <div className="l"><b>Deposit payable ({depositPct}%)</b><span>Payable in full prior to work commencement · balance on completion, after your walkthrough</span></div>
            <div className="v">{money2(deposit)}</div>
          </div>
          )}
        </section>

        {/* PROCESS */}
        {!invoiceMode && (
        <section>
          <h2>What happens when you accept</h2>
          <div className="steps">
            <div className="step"><span className="stepnum" /><div><b>Booking</b><p>We&apos;ll contact you to lock in your start dates.</p></div></div>
            <div className="step"><span className="stepnum" /><div><b>Confirmation</b><p>We&apos;ll send you your lead painter&apos;s name, start date and time, and a handy checklist to help you prepare.</p></div></div>
            <div className="step"><span className="stepnum" /><div><b>Colour consultation</b><p>We provide free, unlimited colour samples. Nothing starts until you&apos;re happy with your colour choices.</p></div></div>
            <div className="step"><span className="stepnum" /><div><b>Live progress in your portal</b><p>Log in to see updates and track your job&apos;s progress.</p></div></div>
            <div className="step"><span className="stepnum" /><div><b>Final walkthrough</b><p>We walk through every room with you to confirm you&apos;re 100% satisfied before final payment.</p></div></div>
          </div>
        </section>
        )}

        {/* TRUST */}
        {!invoiceMode && (
        <section>
          <h2>Why Melburnians choose us</h2>
          <div className="trust">
            <div className="tcard"><div className="tval gold">{snap.proof.rating} ★</div><div className="tlab">from {snap.proof.reviews} 5-star reviews</div></div>
            <div className="tcard"><div className="tval cyan">{snap.proof.liability}</div><div className="tlab">public liability insurance</div></div>
            <div className="tcard"><div className="tval gold">Master Painters</div><div className="tlab">accredited member</div></div>
          </div>
        </section>
        )}

        {/* ACCEPT / DECLINE / ASK */}
        {!done && !interactive && !invoiceMode && (
          <section id="accept">
            <div className="acceptpanel cutin">
              <h2>Ready when you are</h2>
              <div className="finebtns">
                <span className="btn btn-primary" style={{ opacity: 0.6, cursor: "default" }}>Accept this estimate</span>
                <span className="btn btn-ghost" style={{ opacity: 0.6, cursor: "default" }}>Ask a question</span>
              </div>
            </div>
          </section>
        )}
        {!done && interactive && (
          <section id="accept">
            <div className="acceptpanel cutin">
              <h2>Ready when you are</h2>
              <p className="sub">Accepting takes under a minute. No payment is taken until you receive your deposit invoice.</p>
              <div className="finebtns print-hide">
                <button className="btn btn-primary" onClick={() => setPanel(panel === "accept" ? null : "accept")}>Accept this estimate</button>
                <button className="btn btn-ghost" onClick={() => setPanel(panel === "chat" ? null : "chat")}>
                  {thread.length ? "Open chat" : "Message us"}
                  {thread.some((m) => m.direction === "staff") && panel !== "chat" ? " ●" : ""}
                </button>
              </div>

              {panel === "chat" && chatUi}

              {panel === "accept" && (
                <div className="panelbox">
                  <h3>Confirm acceptance — {money2(total)} incl. GST</h3>
                  <label className="field"><span>Full name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" /></label>
                  <div className="field">
                    <span>Sign below</span>
                    <SignaturePad onChange={setSignatureData} />
                  </div>
                  <p className="signnote">By signing, I confirm I&apos;m authorised to accept this estimate and that this signature is legally binding.</p>
                  <button className="btn btn-primary" onClick={accept} disabled={busy}>{busy ? "Accepting…" : "Accept & continue"}</button>
                  {err && <p className="errline">{err}</p>}
                </div>
              )}

              {panel === "ask" && (
                <div className="panelbox">
                  <h3>Ask a question</h3>
                  {asked ? (
                    <div className="confirm">✓ Thanks — we&apos;ll come back to you today.</div>
                  ) : (
                    <>
                      <label className="field"><span>Your question</span><textarea rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Anything you&apos;d like to check before deciding…" /></label>
                      <button className="btn btn-primary" onClick={ask} disabled={busy}>{busy ? "Sending…" : "Send question"}</button>
                      {err && <p className="errline">{err}</p>}
                    </>
                  )}
                </div>
              )}

              {panel === "decline" && (
                <div className="panelbox">
                  <h3>No problem — mind telling us why?</h3>
                  <div className="quickpicks">
                    {DECLINE_PICKS.map((p) => (
                      <button key={p} className={`pick${declinePick === p ? " on" : ""}`} onClick={() => setDeclinePick(declinePick === p ? "" : p)}>{p}</button>
                    ))}
                  </div>
                  <label className="field"><span>Anything else (optional)</span><textarea rows={3} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} /></label>
                  <button className="btn btn-ghost" onClick={decline} disabled={busy}>{busy ? "Sending…" : "Decline estimate"}</button>
                  {err && <p className="errline">{err}</p>}
                </div>
              )}

              <p className="tinylinks print-hide">
                Not the right time? <a href="tel:0388409414">Ask us to hold your price</a> · <button onClick={() => setPanel(panel === "decline" ? null : "decline")}>Politely decline</button>
              </p>
            </div>
          </section>
        )}

        {/* CHAT AFTER THE DECISION — the conversation doesn't end at accept.
            Same thread the portal's Messages tab reads (one messenger rule). */}
        {done && interactive && !invoiceMode && (
          <section id="accept" className="print-hide">
            <div className="acceptpanel cutin">
              <h2>Questions about your job?</h2>
              <p className="sub">Message us here any time — the conversation also lives in your account under Messages.</p>
              <div className="finebtns print-hide">
                <button className="btn btn-ghost" onClick={() => setPanel(panel === "chat" ? null : "chat")}>
                  {thread.length ? "Open chat" : "Message us"}
                  {thread.some((m) => m.direction === "staff") && panel !== "chat" ? " ●" : ""}
                </button>
              </div>
              {panel === "chat" && chatUi}
            </div>
          </section>
        )}

        {/* TERMS — shown below the accept section, with a second call to action */}
        {snap.terms && snap.terms.trim() && (
          <section className="terms">
            <h2>Terms &amp; conditions</h2>
            <div className="termsbody">{snap.terms}</div>
            {!done && (
              <div className="finebtns print-hide" style={{ marginTop: 20 }}>
                {interactive ? (
                  <button className="btn btn-primary" onClick={() => { setPanel("accept"); document.getElementById("accept")?.scrollIntoView({ behavior: "smooth" }); }}>
                    Accept this estimate
                  </button>
                ) : (
                  <span className="btn btn-primary" style={{ opacity: 0.6, cursor: "default" }}>Accept this estimate</span>
                )}
              </div>
            )}
          </section>
        )}

        {!invoiceMode && (
          <div style={{ marginTop: 28 }} className="print-hide">
            <button className="btn btn-ghost" onClick={() => window.print()}>⤓ Download estimate (PDF)</button>
          </div>
        )}

        <footer className="doc">
          {snap.company.name} · Melbourne · ABN {snap.company.abn} · {est}{docLabel === "Estimate" ? ` valid for 60 days from ${dateFmt(sentAt)}` : ""}.
          {invoiceMode
            ? " This invoice reflects your accepted scope plus every change you have signed."
            : " This quote covers the scope above; any variation is quoted and approved by you in writing before work proceeds."}
          Fully insured — {snap.proof.liability} public liability. Member, Master Painters Association.
        </footer>
      </main>

      {/* Print-only: a traditional itemised paper quote (replaces the on-screen
          document when the customer downloads/prints a PDF). */}
      <PrintQuote
        snap={snap} est={est} sentAt={sentAt} validUntil={validUntil}
        selectedIds={selected} grossSubtotal={grossSubtotal} discount={discount}
        discountPct={discountPct} discountMode={discountMode} gst={gst} total={total}
        deposit={deposit} depositPct={depositPct} acceptedName={acceptedName} done={done}
      />

      {!done && !invoiceMode && (
        <div className="stickybar print-hide">
          <div className="p"><small>Total incl. GST</small>{money0(total)}</div>
          <a className="btn btn-primary" href="#accept">Accept estimate</a>
        </div>
      )}
    </>
  );
}

function PrintQuote({
  snap, est, sentAt, validUntil, selectedIds, grossSubtotal, discount, discountPct,
  discountMode, gst, total, deposit, depositPct, acceptedName, done,
}: {
  snap: CustomerSnapshot; est: string; sentAt: string | null; validUntil: string | null;
  selectedIds: Set<string>; grossSubtotal: number; discount: number; discountPct: number;
  discountMode: string; gst: number; total: number; deposit: number; depositPct: number;
  acceptedName: string | null; done: null | "accepted" | "declined";
}) {
  const c = snap.company;
  const surfaceLine = (a: CustomerSnapshot["areas"][number]) =>
    a.surfaces.map((s) => `${s.label} (${s.coats} ${s.coats === 1 ? "coat" : "coats"}${s.product ? ` · ${s.product}` : ""})`).join("; ");
  const opts = snap.options.filter((o) => selectedIds.has(o.id));
  return (
    <div className="printdoc">
      <div className="pd-head">
        <div className="pd-co">
          {(c.logoUrlLight || c.logoUrl)
            // eslint-disable-next-line @next/next/no-img-element
            ? <img className="pd-logo" src={c.logoUrlLight || c.logoUrl} alt={c.name} />
            : <div className="pd-coname">{c.name}</div>}
          <div className="pd-cometa">
            {c.addressLine1}{c.addressLine2 ? `, ${c.addressLine2}` : ""}<br />
            ABN {c.abn} · {c.phone}{c.email ? ` · ${c.email}` : ""}
          </div>
        </div>
        <div className="pd-meta">
          <div className="pd-title">QUOTE</div>
          <table><tbody>
            <tr><td>Reference</td><td>{est}</td></tr>
            <tr><td>Date</td><td>{dateFmt(sentAt)}</td></tr>
            {validUntil && <tr><td>Valid until</td><td>{dateFmt(validUntil)}</td></tr>}
            {c.estimatorName && <tr><td>Prepared by</td><td>{c.estimatorName}</td></tr>}
            {done === "accepted" && <tr><td>Status</td><td>Accepted{acceptedName ? ` · ${acceptedName}` : ""}</td></tr>}
          </tbody></table>
        </div>
      </div>

      <div className="pd-billto">
        <div><b>Quote for</b></div>
        {snap.contactName && <div>{snap.contactName}</div>}
        <div>{snap.jobAddress || c.addressLine1}</div>
        <div className="pd-job">{snap.jobTitle}</div>
      </div>

      <table className="pd-table">
        <thead><tr><th>Description</th><th className="pd-amt">Amount (ex GST)</th></tr></thead>
        <tbody>
          {snap.areas.map((a) => (
            <tr key={a.id}>
              <td>
                <div className="pd-item">{a.title}</div>
                {surfaceLine(a) && <div className="pd-sub">{surfaceLine(a)}</div>}
              </td>
              <td className="pd-amt">{money2(a.priceCents)}</td>
            </tr>
          ))}
          {snap.lineItems.map((l) => (
            <tr key={l.id}>
              <td><div className="pd-item">{l.title}</div></td>
              <td className="pd-amt">{money2(l.priceCents)}</td>
            </tr>
          ))}
          {opts.map((o) => (
            <tr key={o.id}>
              <td><div className="pd-item">{o.title} <span className="pd-tag">(optional extra)</span></div></td>
              <td className="pd-amt">{money2(o.priceCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td className="pd-tlabel">Subtotal (ex GST)</td><td className="pd-amt">{money2(grossSubtotal)}</td></tr>
          {discount > 0 && <tr><td className="pd-tlabel">Discount{discountMode === "pct" ? ` (${discountPct}%)` : ""}</td><td className="pd-amt">− {money2(discount)}</td></tr>}
          <tr><td className="pd-tlabel">GST</td><td className="pd-amt">{money2(gst)}</td></tr>
          <tr className="pd-total"><td className="pd-tlabel">Total incl. GST</td><td className="pd-amt">{money2(total)}</td></tr>
        </tfoot>
      </table>

      <div className="pd-deposit">
        <b>Deposit payable ({depositPct}%): {money2(deposit)}</b> — payable in full prior to work commencement; balance on completion after your walkthrough.
      </div>

      {snap.paints?.length > 0 && (
        <div className="pd-block">
          <div className="pd-h">Paint &amp; materials supplied</div>
          <ul className="pd-list">
            {snap.paints.map((p, i) => (
              <li key={i}>{[p.brand, p.name].filter(Boolean).join(" ")}{p.finish ? ` — ${p.finish}` : ""}{p.colourName ? ` · ${p.colourName}` : ""}{p.role ? ` (${p.role})` : ""}</li>
            ))}
          </ul>
        </div>
      )}

      {(snap.inclusions.length > 0 || snap.exclusions.length > 0) && (
        <div className="pd-cols">
          {snap.inclusions.length > 0 && (
            <div className="pd-block">
              <div className="pd-h">Included in your price</div>
              <ul className="pd-list">{snap.inclusions.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
          {snap.exclusions.length > 0 && (
            <div className="pd-block">
              <div className="pd-h">Not included</div>
              <ul className="pd-list">{snap.exclusions.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {snap.terms && snap.terms.trim() && (
        <div className="pd-block">
          <div className="pd-h">Terms &amp; conditions</div>
          <div className="pd-terms">{snap.terms}</div>
        </div>
      )}

      <div className="pd-sign">
        <div className="pd-sigcol"><div className="pd-sigline" />Customer signature</div>
        <div className="pd-sigcol"><div className="pd-sigline" />Name</div>
        <div className="pd-sigcol"><div className="pd-sigline" />Date</div>
      </div>

      <div className="pd-foot">
        {c.name} · ABN {c.abn} · {est} valid for 60 days from {dateFmt(sentAt)}. Fully insured — {snap.proof.liability} public liability.
      </div>
    </div>
  );
}

function hasHtml(html: string | undefined) {
  return !!html && html.replace(/<[^>]*>/g, "").trim() !== "";
}

function groupForCategory(cat: string): string {
  if (/deck/i.test(cat)) return "Decking";
  if (/interior walls/i.test(cat)) return "Interior";
  if (/exterior walls/i.test(cat)) return "Exterior";
  if (/ceiling/i.test(cat)) return "Ceilings";
  if (/trim|door/i.test(cat)) return "Trim";
  if (/texture|membrane/i.test(cat)) return "Texture";
  if (/prep|primer/i.test(cat)) return "Prep";
  if (/clear|floor/i.test(cat)) return "Clear";
  return cat || "";
}

// A neutral paint-tin placeholder (from the v3 reference) for products with no photo.
function TinPlaceholder() {
  return (
    <svg viewBox="0 0 120 130" fill="none" aria-hidden="true">
      <ellipse cx="60" cy="16" rx="42" ry="9" fill="#8F969D" />
      <ellipse cx="60" cy="14" rx="42" ry="9" fill="#C8CDD2" />
      <ellipse cx="60" cy="14" rx="30" ry="6" fill="#D8D4C8" />
      <path d="M18 16 L20 112 C20 122 100 122 100 112 L102 16 C102 25 18 25 18 16 Z" fill="#B7BDC3" />
      <path d="M18 16 L20 112 C20 117 40 120 60 120 L60 23 C42 23 24 20 18 16 Z" fill="rgba(255,255,255,.28)" />
      <rect x="24" y="42" width="72" height="52" rx="4" fill="#F2F0EA" />
      <rect x="24" y="42" width="72" height="14" rx="4" fill="#2fb9cb" />
      <rect x="30" y="64" width="60" height="5" rx="2.5" fill="#22262A" />
      <rect x="30" y="74" width="42" height="4" rx="2" fill="#9AA0A6" />
      <rect x="30" y="83" width="30" height="4" rx="2" fill="#2fb9cb" opacity=".85" />
    </svg>
  );
}

function PaintCard({ p }: { p: SnapshotPaint }) {
  const group = groupForCategory(p.category);
  const brandLabel = [p.brand, group].filter(Boolean).join(" · ");
  const colourPending = p.customerVisible && /walls/i.test(p.category) && !p.colourName;
  return (
    <div className="paintcard">
      <div className="tinwrap">
        {p.photoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="tinphoto" src={p.photoUrl} alt="" loading="lazy" />
          : <TinPlaceholder />}
      </div>
      <div>
        {brandLabel && <p className="pc-brand">{brandLabel}</p>}
        <p className="pc-name">{p.name}{[p.role, p.finish].filter(Boolean).length > 0 && <small>{[p.role, p.finish].filter(Boolean).join(" · ")}</small>}</p>
        {p.usage.length > 0 && (
          <div className="pc-uses">{p.usage.map((u, i) => <span key={i}>{u}</span>)}</div>
        )}
        {(p.colours?.length ?? 0) > 0 ? (
          // Every colour on the job, with its areas — and "colour matched"
          // spelled out where we're matching an existing colour (Tom, 25 Aug).
          p.colours!.map((c, i) => (
            <div className="pc-colour" key={i}>
              <span className="pc-swatch" style={{ background: c.hex || "#cfcfcf" }} />
              {c.name ? `Colour: ${c.name}` : "Colour matched to your existing colour"}
              {c.name && c.match ? " — colour matched" : ""}
              {c.areas.length > 0 && <small style={{ color: "inherit", opacity: 0.75 }}> · {c.areas.join(" · ")}</small>}
            </div>
          ))
        ) : p.colourName ? (
          <div className="pc-colour">
            <span className="pc-swatch" style={{ background: p.colourHex || "#cfcfcf" }} />
            Colour: {p.colourName}
          </div>
        ) : null}
        {p.customerVisible && p.blurb && <p className="pc-why">{p.blurb}</p>}
        {p.customerVisible && (p.properties.length > 0 || colourPending) && (
          <p className="pc-props">
            {p.properties.join(" · ")}
            {colourPending && <>{p.properties.length > 0 ? " · " : ""}<b>Colour confirmed at your consult</b></>}
          </p>
        )}
        {p.customerVisible && p.guarantee && <p className="pc-guarantee">{p.guarantee}</p>}
      </div>
    </div>
  );
}
