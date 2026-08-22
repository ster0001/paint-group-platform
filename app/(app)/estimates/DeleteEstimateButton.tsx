"use client";

import { useState } from "react";

/**
 * Deleting is permanent, so it asks first — and the confirmation names the
 * estimate rather than saying "are you sure?", because on a list of twelve
 * rows the row you clicked is the thing worth double-checking.
 *
 * Accepted estimates don't get a button at all. The database refuses them
 * anyway; hiding it stops the question being asked.
 *
 * The button does NOT delete. It asks, then hands the id to the table, which
 * takes the row off screen at once and finishes the delete behind it — waiting
 * on a round trip to watch a row you have already decided about is the slowest
 * part of tidying a list.
 */
export default function DeleteEstimateButton({
  estimateId,
  title,
  status,
  onConfirm,
}: {
  estimateId: string;
  title: string;
  status: string;
  onConfirm: (id: string) => void;
}) {
  const [asking, setAsking] = useState(false);

  if (status === "accepted") {
    return <span className="text-xs text-gray-300" title="Accepted estimates are kept as the record of what the customer agreed to">—</span>;
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
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-gray-600">
        Delete &ldquo;{title}&rdquo;{status === "sent" ? " — the customer's link will stop working" : ""}?
      </span>
      <button
        onClick={() => { setAsking(false); onConfirm(estimateId); }}
        className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700"
      >
        Delete
      </button>
      <button onClick={() => setAsking(false)} className="text-xs text-gray-500 hover:text-gray-800">
        Cancel
      </button>
    </div>
  );
}
