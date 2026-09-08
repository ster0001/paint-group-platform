"use client";

import { useState, useTransition } from "react";
import { setProvingExcludedAction } from "./actions";

/**
 * Tom, 9 Sep 2026: the control that takes rows off the Proving window.
 *
 * One component for both directions and for one row or all of them — the
 * bulk form asks for confirmation and takes a reason, because a page-wide
 * change to a measurement should say why it happened.
 */
export default function ExcludeButton({ ids, excluded, label, bulk = false, testId }: {
  ids: string[];
  /** true = take these off the window; false = put them back. */
  excluded: boolean;
  label: string;
  bulk?: boolean;
  testId?: string;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");

  const run = (why: string) => start(async () => {
    const res = await setProvingExcludedAction({ estimateIds: ids, excluded, reason: why });
    setMsg(res.status === "error" ? res.message : "");
    setConfirming(false);
    setReason("");
  });

  if (bulk && confirming) {
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); run(reason); }}
      >
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="Why? e.g. compared against PaintScout, not a fair test"
          className="w-72 rounded border border-gray-300 px-2 py-1.5 text-sm"
          data-testid="exclude-reason"
          autoFocus
        />
        <button type="submit" disabled={pending}
          className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          data-testid="exclude-confirm">
          {pending ? "Removing…" : `Remove ${ids.length}`}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-xs text-gray-500 underline">Cancel</button>
      </form>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending || ids.length === 0}
        onClick={() => (bulk ? setConfirming(true) : run(""))}
        data-testid={testId}
        className={bulk
          ? "rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          : "text-xs text-gray-400 underline hover:text-gray-700 disabled:opacity-40"}
      >
        {pending ? "Saving…" : label}
      </button>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </span>
  );
}
