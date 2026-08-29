"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTemplate } from "./actions";

export default function NewTemplate({ segments }: { segments: Array<{ key: string; name: string }> }) {
  const [name, setName] = useState("");
  const [segment, setSegment] = useState<string>(segments[0]?.key ?? "");
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="panel">
      <p className="plabel">Start an email</p>
      <div className="row">
        <input
          className="field"
          placeholder="What is it? — “Spring exteriors”, “Two-year check-in”"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select className="field" style={{ maxWidth: 280 }} value={segment} onChange={(e) => setSegment(e.target.value)}>
          <option value="">Nobody in particular</option>
          {segments.map((s) => <option key={s.key} value={s.key}>To: {s.name}</option>)}
        </select>
        <button
          className="go"
          disabled={busy}
          onClick={() => start(async () => {
            const r = await createTemplate(name, segment || null);
            if (!r.ok) { setError(r.message); return; }
            router.push(`/crm/campaigns/${r.data!.id}`);
          })}
        >
          {busy ? "Starting…" : "Start writing"}
        </button>
      </div>
      {error && <p className="said bad">{error}</p>}
    </div>
  );
}
