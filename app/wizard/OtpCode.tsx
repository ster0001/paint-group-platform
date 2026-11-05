"use client";

import { useEffect, useState } from "react";
import { OTP_LENGTH, resendWaitSeconds } from "@/lib/wizard/otpFormat";

/**
 * The gate's code boxes (Tom, 5 Nov 2026) — ONE component for the phone's
 * shell and the laptop's gate step (never two copies). One real input drawn
 * as six boxes: the keyboard is numeric, iOS offers the texted code, a paste
 * works, and the spec fills it like any field. Six digits verify by
 * themselves; the Continue bar under it does the same.
 */
export type OtpUi = {
  phase: "idle" | "code";
  /** "0412 ••• 678" — the number the code went to. */
  masked: string;
  /** The ten digits, for the shell's data attribute (the spec reads the recorded text for THIS number). */
  mobile: string;
  code: string;
  error: string | null;
  busy: boolean;
  /** When the last code was sent — Send it again waits a minute from here. */
  sentAt: number | null;
};

export type OtpHandlers = {
  onCode: (code: string) => void;
  onVerify: (code: string) => void;
  onResend: () => void;
  onChange: () => void;
};

export default function OtpCode({ otp, on }: { otp: OtpUi; on: OtpHandlers }) {
  const [now, setNow] = useState(() => Date.now());
  const wait = resendWaitSeconds(otp.sentAt, now);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [wait]);
  return (
    <div className="wz-otp" data-testid="gate-otp">
      <label className="wz-otp-boxes" aria-label="The six-digit code">
        <input
          type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={OTP_LENGTH}
          value={otp.code} disabled={otp.busy} autoFocus data-testid="gate-otp-input" data-mobile={otp.mobile}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH);
            on.onCode(digits);
            if (digits.length === OTP_LENGTH) on.onVerify(digits);
          }}
        />
        <span className="wz-otp-cells" aria-hidden="true">
          {Array.from({ length: OTP_LENGTH }, (_, i) => <i key={i} className={i === otp.code.length ? "at" : i < otp.code.length ? "done" : ""}>{otp.code[i] ?? ""}</i>)}
        </span>
      </label>
      {otp.error && <p className="wz-err" role="alert" data-testid="gate-otp-error">{otp.error}</p>}
      <p className="wz-otp-links">
        <button type="button" className="wz-linkish" disabled={wait > 0 || otp.busy} onClick={on.onResend} data-testid="gate-otp-resend">
          {wait > 0 ? `Send it again in ${wait} s` : "Send it again"}
        </button>
        <span aria-hidden="true"> · </span>
        <button type="button" className="wz-linkish" disabled={otp.busy} onClick={on.onChange} data-testid="gate-otp-change">Wrong number? Change it</button>
      </p>
    </div>
  );
}
