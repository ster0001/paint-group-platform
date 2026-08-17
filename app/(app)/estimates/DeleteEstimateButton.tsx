"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteEstimateAction } from "./actions";

/**
 * Deleting is permanent, so it asks first — and the confirmation names the
 * estimate rather than saying "are you sure?", because on a list of twelve
 * rows the row you clicked is the thing worth double-checking.
 *
 * Accepted estimates don't get a button at all. The database refuses them
 * anyway; hiding it stops the question being asked.
 */
export default function DeleteEstimateButton({
  estimateId,
  title,
  status,
}: {
  estimateId: string;
  title: string;
  status: string;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (status === "accepted") {
    return <span className="text-xs text-gray-300" title="Accepted estimates are kept as the record of what the customer agreed to">—</span>;
  }

  async function remove() {
    setBusy(true);
    setErr("");
    const r = await deleteEstimateAction({ estimateId });
    if (r.ok) {
      setAsking(false);
      router.refresh();
    } else {
      setErr(r.message);
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <button
        onClick={() => setAsking(true)}
        className="text-xs text-gray-400 hover:text-red-600"
        aria-label={`Delete ${title}`}
      >
        Delete
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-600">
          Delete &ldquo;{title}&rdquo;{status === "sent" ? " — the customer's link will stop working" : ""}?
        </span>
        <button
          onClick={remove}
          disabled={busy}
          className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button onClick={() => { setAsking(false); setErr(""); }} className="text-xs text-gray-500 hover:text-gray-800">
          Cancel
        </button>
      </div>
      {err && <span className="max-w-md text-right text-xs text-red-700">{err}</span>}
    </div>
  );
}
