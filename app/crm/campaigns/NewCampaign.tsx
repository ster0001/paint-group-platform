"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createCampaign } from "./campaignActions";

export default function NewCampaign({ segments }: { segments: Array<{ key: string; name: string }> }) {
  const [name, setName] = useState("");
  const [segment, setSegment] = useState(segments[0]?.key ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();

  return (
    <div className="panel">
      <p className="plabel">Start a campaign</p>
      <div className="row">
        <input className="field" placeholder="What is it? — “Spring exteriors”" value={name}
          onChange={(e) => setName(e.target.value)} />
        <select className="field" style={{ maxWidth: 300 }} value={segment} onChange={(e) => setSegment(e.target.value)}>
          {segments.map((s) => <option key={s.key} value={s.key}>To: {s.name}</option>)}
        </select>
        <button className="go" disabled={busy} onClick={() => start(async () => {
          const r = await createCampaign(name, segment);
          if (!r.ok) { setError(r.message); return; }
          router.push(`/crm/campaigns/c/${r.data!.id}`);
        })}>{busy ? "Starting…" : "Start"}</button>
      </div>
      {error && <p className="said bad">{error}</p>}
    </div>
  );
}
