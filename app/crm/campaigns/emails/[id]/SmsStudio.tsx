"use client";

import { useMemo, useState, useTransition } from "react";
import { SMS_MAX_CHARS, SMS_OPT_OUT, renderSms, smsParts } from "@/lib/campaigns/sms";
import { approveTemplate, saveSmsTemplate, sendTestSms } from "../../actions";

/**
 * Writing a text (session: SMS in the campaign builder).
 *
 * Deliberately smaller than the email studio, because a text IS smaller: one
 * box, a live cost counter, and the same two per-recipient links. What the
 * writer never types: the sender name and "Reply STOP" — the renderer appends
 * both, and the preview shows the message exactly as it will leave.
 */
export default function SmsStudio({ id, initialName, initialBody, approvedAt, segment }: {
  id: string;
  initialName: string;
  initialBody: string;
  approvedAt: string | null;
  segment: { name: string; description: string } | null;
}) {
  const [name, setName] = useState(initialName);
  const [body, setBody] = useState(initialBody);
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [approved, setApproved] = useState<string | null>(approvedAt);
  const [busy, start] = useTransition();

  const rendered = useMemo(() => renderSms(body || " ", {
    estimateUrl: "https://paintgroup.com.au/e/their-estimate",
    accountUrl: "https://paintgroup.com.au/account",
  }), [body]);
  const cost = useMemo(() => smsParts(rendered), [rendered]);

  const insert = (token: string) => setBody((b) => (b.trimEnd() + " " + token).trimStart());

  return (
    <div className="studio">
      <div className="studioside">
        <div className="row">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this text" />
          <button className="go" disabled={busy} onClick={() => start(async () => {
            const r = await saveSmsTemplate(id, name, body);
            setSaid(r);
            if (r.ok) setApproved(null);
          })}>{busy ? "Saving…" : "Save"}</button>
        </div>
        {segment && <p className="bhint" style={{ marginTop: 8 }}>Writing to: <b>{segment.name}</b> — {segment.description}</p>}

        <div className="panel" style={{ marginTop: 14 }}>
          <p className="plabel">The message</p>
          <textarea
            className="field" rows={5} style={{ width: "100%" }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"Hi — you started a painting estimate with us and it's saved where you left it. Pick it up any time: {{estimate}}"}
            maxLength={SMS_MAX_CHARS}
          />
          <div className="chips" style={{ marginTop: 8 }}>
            <button className="chip" onClick={() => insert("{{estimate}}")}>+ Their estimate link</button>
            <button className="chip" onClick={() => insert("{{account}}")}>+ Their account link</button>
          </div>
          <p className="bhint" style={{ marginTop: 8 }}>
            Sender name and &ldquo;{SMS_OPT_OUT}&rdquo; are added for you — never your job to remember.
          </p>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <button className="chip" disabled={busy} onClick={() => start(async () => setSaid(await sendTestSms(id)))}>
            Send a test to the company mobile
          </button>
          <button className="chip" disabled={busy} onClick={() => start(async () => {
            const r = await approveTemplate(id);
            setSaid(r);
            if (r.ok) setApproved(new Date().toISOString());
          })}>
            {approved ? "Approved ✓" : "I've read it — approve"}
          </button>
        </div>
        {said && <p className={`said ${said.ok ? "" : "bad"}`}>{said.message}</p>}
      </div>

      <div className="studiopreview">
        <p className="plabel">What they&rsquo;ll receive</p>
        <div className="smsbubblewrap">
          <div className="smsbubble">{rendered}</div>
        </div>
        <p className="bhint">
          {cost.chars} characters · {cost.parts} text{cost.parts === 1 ? "" : "s"} per person
          {cost.unicode ? " — an emoji or smart quote is forcing the short 70-character parts" : ""}.
          Links shown are samples; each person gets their own.
        </p>
      </div>
    </div>
  );
}
