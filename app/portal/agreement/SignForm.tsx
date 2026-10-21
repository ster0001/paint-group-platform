"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SignaturePad from "@/app/components/SignaturePad";
import { signAgreementAction } from "./actions";

/**
 * The foot of the agreement (brief §3 step 4): wakes once the end of the
 * document has scrolled into view, then the tick, the name (pre-filled,
 * editable), the signature pad and Sign. The hash of what was rendered
 * travels with the submit so the server can refuse a document that changed
 * under them.
 */
export default function SignForm({ version, hash, defaultName, businessName }: { version: number; hash: string; defaultName: string; businessName: string }) {
  const router = useRouter();
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [name, setName] = useState(defaultName);
  const [signature, setSignature] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer (an old browser): the end counts as reached once it has scrolled past the fold.
      const check = () => { if (el.getBoundingClientRect().top < window.innerHeight) { setReachedEnd(true); window.removeEventListener("scroll", check); } };
      window.addEventListener("scroll", check, { passive: true });
      return () => window.removeEventListener("scroll", check);
    }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setReachedEnd(true); io.disconnect(); } }, { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const ready = reachedEnd && ticked && name.trim().length >= 2 && !!signature;

  function sign() {
    if (!ready || !signature) return;
    setMessage(null);
    start(async () => {
      const r = await signAgreementAction({ version, hash, name: name.trim(), signature });
      if (!r.ok) { setMessage(r.message); return; }
      router.push("/portal/agreement?signed=1");
      router.refresh();
    });
  }

  return (
    <div className="signoff-foot ag-foot" data-testid="agreement-sign-foot" data-reached-end={reachedEnd}>
      <div ref={sentinel} aria-hidden style={{ height: 1 }} />
      {!reachedEnd && <p className="hint" data-testid="agreement-scroll-hint">Scroll to the end of the agreement to sign.</p>}
      <button type="button" role="checkbox" aria-checked={ticked} className={`signoff-check ${ticked ? "on" : ""}`} disabled={!reachedEnd}
        onClick={() => setTicked((t) => !t)} data-testid="agreement-tick">
        <span className="box" aria-hidden>✓</span>
        <span>I have read this agreement and I am authorised to sign for {businessName || "my business"}.</span>
      </button>
      <label className="fl" htmlFor="agreement-name">Your name (in block letters)</label>
      <input id="agreement-name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} disabled={!reachedEnd} data-testid="agreement-name" />
      <label className="fl">Sign here</label>
      <SignaturePad onChange={setSignature} />
      {message && <p className="err" role="alert" data-testid="agreement-error">{message}</p>}
      <button type="button" className="btn cy" disabled={!ready || pending} onClick={sign} data-testid="agreement-sign">
        {pending ? "Signing…" : "Sign"}
      </button>
      <p className="hint" style={{ padding: 0 }}>Signing here is an electronic signature. Your name, the time, your device and this document&rsquo;s hash are kept with it, and Paint Group&rsquo;s signature is applied at the same moment.</p>
    </div>
  );
}
