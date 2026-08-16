"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CustomerSnapshot, SnapshotPaint } from "@/lib/customer/snapshot";
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
const money0 = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");
const dateFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "");

const DECLINE_PICKS = ["Went with another quote", "Postponing", "Price", "Other"];

export default function CustomerEstimate({
  snapshot: snap, token, status = "sent", acceptedName = null,
  validUntil = null, sentAt = null, selectedOptionsInit = null, preview = false,
}: {
  snapshot: CustomerSnapshot;
  token?: string;
  status?: string;
  acceptedName?: string | null;
  validUntil?: string | null;
  sentAt?: string | null;
  selectedOptionsInit?: string[] | null;
  preview?: boolean;
}) {
  const gstRate = (snap.gstRatePct ?? 10) / 100;
  const interactive = !preview && !!token; // real customer page can write; builder preview cannot

  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedOptionsInit ?? []));
  const [done, setDone] = useState<null | "accepted" | "declined">(
    status === "accepted" ? "accepted" : status === "declined" ? "declined" : null,
  );
  const [panel, setPanel] = useState<null | "accept" | "decline" | "ask">(null);
  const [name, setName] = useState(snap.contactName || "");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [declinePick, setDeclinePick] = useState("");
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState(false);
  const [portalEmail, setPortalEmail] = useState("");
  const [portalMsg, setPortalMsg] = useState("");
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
  const depositPct = snap.depositPct ?? 50;
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
      try { await supabase.rpc("record_estimate_view", { p_token: token, p_session: session, p_ua: ua, p_ms: ms }); } catch { /* best-effort */ }
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
    // Save the drawn signature separately (best-effort — needs the signature
    // migration; acceptance still succeeds if this RPC isn't present yet).
    try { await supabase.rpc("save_estimate_signature", { p_token: token, p_signature: signatureData }); } catch { /* ignore */ }
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

  async function openPortal() {
    setPortalMsg("");
    const email = portalEmail.trim().toLowerCase();
    if (!email) return;
    if (snap.contactEmail && email !== snap.contactEmail.toLowerCase()) {
      setPortalMsg("That email isn't the one on this estimate — please use the address we sent it to.");
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/e/${token}` },
    });
    setPortalMsg(error ? error.message : "Check your email for a secure sign-in link.");
  }

  const statusChip = done === "accepted"
    ? <span className="status accepted">Accepted</span>
    : done === "declined"
    ? <span className="status declined">Declined</span>
    : <span className="status">Awaiting your approval</span>;

  const est = `EST-${snap.estRef}`;

  return (
    <>
      <header className="topbar">
        {snap.company.logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="brandlogo" src={snap.company.logoUrl} alt={snap.company.name} />
          : <div className="wordmark">PAINT<span>—</span>GROUP</div>}
        <div className="topmeta">
          <span className="validity">{est} · valid until {dateFmt(validUntil)}</span>
          {statusChip}
        </div>
      </header>

      <main className="wrap">
        {done === "accepted" && (
          <div className="resultbanner accepted" style={{ marginTop: 28 }}>
            <span className="tick">✓</span>
            <span>Estimate accepted{acceptedName ? ` by ${acceptedName}` : ""}. We&apos;ll email your deposit invoice and booking shortly.</span>
          </div>
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
            Estimate <b>{est}</b> · Prepared {dateFmt(sentAt)}{snap.company.estimatorName ? ` · Prepared by ${snap.company.estimatorName}` : ""}
          </p>
          <h1>{snap.jobTitle}</h1>
          <p className="address">{snap.jobAddress || snap.company.addressLine1}{snap.contactName ? ` · For ${snap.contactName}` : ""}</p>

          <div className="pricecard">
            <div>
              <div className="pricelabel">Your painting quote · incl. GST</div>
              <div className="price">{money0(total)}</div>
            </div>
            {!done && (
              <div className="cta-row print-hide">
                <a className="btn btn-primary" href="#accept">Accept estimate</a>
                <button className="btn btn-ghost" onClick={() => { setPanel("ask"); document.getElementById("accept")?.scrollIntoView(); }}>Ask a question</button>
              </div>
            )}
          </div>
          <p className="viewnote">Valid 60 days{validUntil ? `, until ${dateFmt(validUntil)}` : ""}.</p>

          <div className="cta-row print-hide" style={{ marginTop: 14 }}>
            <button className="btn btn-ghost" onClick={() => window.print()}>⤓ Download estimate (PDF)</button>
          </div>

          {interactive && (
            <>
              <div className="portal print-hide">
                <input type="email" placeholder="Your email — open in your customer portal" value={portalEmail} onChange={(e) => setPortalEmail(e.target.value)} />
                <button className="btn btn-ghost" onClick={openPortal}>Open portal</button>
              </div>
              {portalMsg && <p className="viewnote">{portalMsg}</p>}
            </>
          )}
        </div>

        {/* COLOUR CONSULTATION — reassurance callout */}
        <div className="colourbox">
          <div className="cb-title">Colour consultation included</div>
          <p>Colours are confirmed after you accept. We provide unlimited samples, so you can try out for yourself in your own light.</p>
        </div>

        {/* PHOTOS */}
        {snap.areas.some((a) => a.photos.length) && (
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
        {snap.options.length > 0 && (
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
          <div className="deposit">
            <div className="l"><b>Deposit payable ({depositPct}%)</b><span>Payable in full prior to work commencement · balance on completion, after your walkthrough</span></div>
            <div className="v">{money2(deposit)}</div>
          </div>
        </section>

        {/* PROCESS */}
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

        {/* TRUST */}
        <section>
          <h2>Why Melburnians choose us</h2>
          <div className="trust">
            <div className="tcard"><div className="tval gold">{snap.proof.rating} ★</div><div className="tlab">from {snap.proof.reviews} Google reviews</div></div>
            <div className="tcard"><div className="tval cyan">{snap.proof.liability}</div><div className="tlab">public liability insurance</div></div>
            <div className="tcard"><div className="tval gold">Master Painters</div><div className="tlab">accredited member</div></div>
          </div>
        </section>

        {/* ACCEPT / DECLINE / ASK */}
        {!done && !interactive && (
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
                <button className="btn btn-ghost" onClick={() => setPanel(panel === "ask" ? null : "ask")}>Ask a question first</button>
              </div>

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

        <div style={{ marginTop: 28 }} className="print-hide">
          <button className="btn btn-ghost" onClick={() => window.print()}>⤓ Download estimate (PDF)</button>
        </div>

        <footer className="doc">
          {snap.company.name} · Melbourne · ABN {snap.company.abn} · {est} valid for 60 days from {dateFmt(sentAt)}.
          This quote covers the scope above; any variation is quoted and approved by you in writing before work proceeds.
          Fully insured — {snap.proof.liability} public liability. Member, Master Painters Association.
        </footer>
      </main>

      {!done && (
        <div className="stickybar print-hide">
          <div className="p"><small>Total incl. GST</small>{money0(total)}</div>
          <a className="btn btn-primary" href="#accept">Accept estimate</a>
        </div>
      )}
    </>
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
  const colourPending = p.customerVisible && /walls/i.test(p.category);
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

// A simple canvas signature pad. Emits a PNG data URL as the customer draws, or
// null when cleared/empty. Works with mouse and touch via pointer events.
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // Size the backing store to the element for crisp lines on all displays.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext("2d");
    if (ctx) { ctx.scale(dpr, dpr); ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0a0b0d"; }
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
    dirty.current = true;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current && ref.current) onChange(ref.current.toDataURL("image/png"));
  };
  const clear = () => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };

  return (
    <div className="sigpad">
      <canvas ref={ref} className="sigcanvas" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <button type="button" className="sigclear" onClick={clear}>Clear</button>
    </div>
  );
}
