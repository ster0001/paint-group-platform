"use client";

import { useRouter } from "next/navigation";

/**
 * G1 (portal UX brief, 25 Oct 2026): threads with nothing in them stay off the
 * list — one picker at the top opens any of them. Native select, one tap.
 */
export default function StartConversation({ options }: { options: Array<{ estimateId: string; title: string }> }) {
  const router = useRouter();
  if (options.length === 0) return null;
  return (
    <div className="card" data-testid="start-conversation">
      <label htmlFor="start-thread">Start a conversation about…</label>
      <select
        id="start-thread"
        className="field"
        defaultValue=""
        onChange={(e) => { if (e.target.value) router.push(`/account/messages/${e.target.value}`); }}
      >
        <option value="" disabled>Choose an estimate</option>
        {options.map((o) => <option key={o.estimateId} value={o.estimateId}>{o.title}</option>)}
      </select>
    </div>
  );
}
