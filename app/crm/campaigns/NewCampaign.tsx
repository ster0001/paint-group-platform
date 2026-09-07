"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CAMPAIGN_CLASSES, type CampaignClass } from "@/lib/campaigns/guard";
import { TRIGGER_EVENTS } from "@/lib/campaigns/sweep";
import { createCampaign } from "./campaignActions";

export default function NewCampaign({ segments }: { segments: Array<{ key: string; name: string }> }) {
  const [name, setName] = useState("");
  const [cls, setCls] = useState<CampaignClass>("followup");
  const [entry, setEntry] = useState<"audience" | "event">("event");
  const [segment, setSegment] = useState(segments[0]?.key ?? "");
  const [trigger, setTrigger] = useState("estimate_sent");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();

  return (
    <div className="panel">
      <p className="plabel">Start a campaign</p>
      <div className="row" style={{ marginTop: 0 }}>
        <input className="field" placeholder="What is it? — “Quote follow-up” or “Spring exteriors”" value={name}
          onChange={(e) => setName(e.target.value)} data-testid="new-name" />
      </div>
      <div className="row">
        <select className="field" style={{ maxWidth: 220 }} value={cls} onChange={(e) => setCls(e.target.value as CampaignClass)} data-testid="new-class" aria-label="Kind">
          {CAMPAIGN_CLASSES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select className="field" style={{ maxWidth: 220 }} value={entry} onChange={(e) => setEntry(e.target.value as "audience" | "event")} data-testid="new-entry" aria-label="Starts">
          <option value="event">Starts when something happens</option>
          <option value="audience">Goes to everyone on a list</option>
        </select>
        {entry === "audience" ? (
          <select className="field" style={{ maxWidth: 300 }} value={segment} onChange={(e) => setSegment(e.target.value)} data-testid="new-segment" aria-label="List">
            {segments.map((s) => <option key={s.key} value={s.key}>To: {s.name}</option>)}
          </select>
        ) : (
          <select className="field" style={{ maxWidth: 300 }} value={trigger} onChange={(e) => setTrigger(e.target.value)} data-testid="new-trigger" aria-label="Event">
            {TRIGGER_EVENTS.map((t) => <option key={t.key} value={t.key}>When: {t.label.toLowerCase()}</option>)}
          </select>
        )}
        <button className="go" disabled={busy} data-testid="new-start" onClick={() => start(async () => {
          const r = await createCampaign({ name, class: cls, entry, segmentKey: entry === "audience" ? segment : null, triggerEvent: entry === "event" ? trigger : null });
          if (!r.ok) { setError(r.message); return; }
          router.push(`/crm/campaigns/c/${r.data!.id}`);
        })}>{busy ? "Starting…" : "Start"}</button>
      </div>
      {error && <p className="said bad">{error}</p>}
    </div>
  );
}
