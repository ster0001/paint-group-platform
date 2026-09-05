"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteShowcaseJobAction } from "@/lib/showcase/actions";

/**
 * Edit / Remove for one showcase job (Tom, 5 Sep). Remove asks first, in
 * words: it takes the job off the website immediately. Used on the list
 * rows and at the foot of the editor.
 */
export default function RowActions({ id, title, published, afterDelete = "refresh", compact = false }: {
  id: string; title: string; published: boolean;
  /** "refresh" re-reads the list; "list" navigates back to it (from the editor). */
  afterDelete?: "refresh" | "list";
  compact?: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setBusy(true); setErr(null);
    const res = await deleteShowcaseJobAction({ id });
    setBusy(false);
    if (res.status === "deleted") {
      if (afterDelete === "list") router.replace("/settings/showcase");
      else router.refresh();
      return;
    }
    setErr(res.message);
  }

  if (confirm) {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "text-xs" : "text-sm"}`} data-testid={`showcase-remove-confirm-${id}`}>
        <span className="text-gray-700">Remove <b>{title}</b>?{published ? " It comes off the website straight away." : ""}</span>
        <button type="button" className="rounded-md bg-red-700 px-3 py-1 font-medium text-white hover:bg-red-800 disabled:opacity-50" disabled={busy} onClick={() => void remove()} data-testid={`showcase-remove-yes-${id}`}>{busy ? "Removing…" : "Remove"}</button>
        <button type="button" className="rounded-md border border-gray-300 px-3 py-1" onClick={() => setConfirm(false)}>Keep</button>
        {err && <span className="text-red-700">{err}</span>}
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}>
      <Link href={`/settings/showcase/${id}`} className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50" data-testid={`showcase-edit-${id}`}>Edit</Link>
      <button type="button" className="rounded-md border border-red-200 px-3 py-1 text-red-700 hover:bg-red-50" onClick={() => setConfirm(true)} data-testid={`showcase-remove-${id}`}>Remove</button>
    </div>
  );
}
