"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteContractorAction } from "../actions";

/**
 * Removing a painter who should never have been on the list (Tom, 18 Sep).
 *
 * Two doors before anything happens: a confirm, then typing the word DELETE.
 * The database refuses anyone with history by name (`delete_contractor`), so
 * the worst this button can do to a real painter is show that refusal.
 */
export default function DeleteContractor({ id, name, suspended }: {
  id: string; name: string; suspended: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setMessage(null);
    startTransition(async () => {
      const r = await deleteContractorAction({ id });
      if (r.ok) router.push("/contractors?removed=1");
      else setMessage(r.message);
    });
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4" data-testid="danger-zone">
      <div className="text-sm font-semibold text-red-900">Remove this painter</div>
      <p className="mt-1 text-xs text-red-800">
        Only for a row that should never have existed: a duplicate, a typo, an invite that went nowhere.
        A painter with any job, offer, invoice, expense or timesheet behind them cannot be removed, because
        deleting them would strip their jobs of a painter and take their insurance certificates with it.
        {suspended ? " They are already suspended, which is the reversible way to stop offering them work." : " Suspend access instead — it keeps every record and stops them being offered work."}
      </p>

      {!open ? (
        <button type="button" onClick={() => setOpen(true)} data-testid="delete-open"
          className="mt-3 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100">
          Remove {name}…
        </button>
      ) : (
        <div className="mt-3">
          <label className="block text-xs text-red-900">
            Type <b>DELETE</b> to confirm
            <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="delete-confirm-input"
              className="ml-2 w-32 rounded-md border border-red-300 px-2 py-1 text-xs" />
          </label>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={pending || typed !== "DELETE"} onClick={remove} data-testid="delete-go"
              className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {pending ? "Removing…" : "Remove permanently"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setTyped(""); setMessage(null); }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && <p className="mt-2 text-xs font-medium text-red-900" data-testid="delete-message">{message}</p>}
    </div>
  );
}
