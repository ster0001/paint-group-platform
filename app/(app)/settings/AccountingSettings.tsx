"use client";

import { useState, useTransition } from "react";
import {
  MYOB_ACCOUNT_SLOTS,
  type MyobAccountMap,
  type MyobCompanyFile,
  type MyobStatus,
} from "@/lib/myob/config";
import type { MyobAccount } from "@/lib/myob/client";
import {
  disconnectMyobAction,
  pickBusinessAction,
  saveAccountMapAction,
  type MyobActionResult,
} from "./myobActions";

/**
 * The MYOB Business card. Connection status + the OAuth door, then the
 * account mapping — each platform money stream picks its ledger home from
 * MYOB's OWN chart of accounts (no typing account codes). Tokens live
 * server-side only; this card only ever sees names.
 */
export default function AccountingSettings({
  status, files, accounts, initialMap, accountsError,
}: {
  status: MyobStatus;
  files: MyobCompanyFile[];
  accounts: MyobAccount[];
  initialMap: MyobAccountMap;
  accountsError: string | null;
}) {
  const [map, setMap] = useState<MyobAccountMap>(initialMap);
  const [pickId, setPickId] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, start] = useTransition();

  const run = (fn: () => Promise<MyobActionResult>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.message);
    });

  if (status.state === "unconfigured") {
    return (
      <div className="max-w-2xl space-y-3 text-sm">
        <p className="text-gray-600">
          MYOB isn&rsquo;t set up yet. Two keys are needed in the server environment
          (Vercel → Settings → Environment Variables), from a registered MYOB
          developer app: <span className="font-mono text-xs">MYOB_CLIENT_ID</span> and{" "}
          <span className="font-mono text-xs">MYOB_CLIENT_SECRET</span>.
        </p>
        <p className="text-gray-500">
          Register the app at MYOB&rsquo;s developer portal with the redirect URL{" "}
          <span className="font-mono text-xs">{typeof window !== "undefined" ? `${window.location.origin}/api/myob/callback` : "…/api/myob/callback"}</span>.
          Once the keys are in, this card becomes a Connect button.
        </p>
      </div>
    );
  }

  if (status.state === "disconnected") {
    return (
      <div className="max-w-2xl space-y-3 text-sm">
        <p className="text-gray-600">
          Not connected. Connecting opens MYOB&rsquo;s own sign-in — Paint Group never
          sees the MYOB password, just permission to write invoices, payments and bills.
        </p>
        <a
          href="/api/myob/connect"
          className="inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          data-testid="myob-connect"
        >
          Connect to MYOB
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5 text-sm">
      {status.state === "pick_business" ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">Connected{status.myobUser ? ` as ${status.myobUser}` : ""} — now pick the business</p>
          <div className="mt-2 flex items-center gap-2">
            <select
              value={pickId}
              onChange={(e) => setPickId(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2"
              data-testid="myob-business-pick"
            >
              <option value="">Choose…</option>
              {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button
              onClick={() => pickId && run(() => pickBusinessAction(pickId))}
              disabled={busy || !pickId}
              className="rounded-md bg-gray-900 px-3 py-2 font-medium text-white disabled:opacity-50"
            >
              Use this business
            </button>
          </div>
          {files.length === 0 && (
            <p className="mt-2 text-xs text-amber-800">
              MYOB listed no businesses for this login — sign in with the account that owns the MYOB Business file.
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div>
            <p className="font-medium text-emerald-900" data-testid="myob-connected">
              Connected — {status.businessName}
            </p>
            <p className="text-xs text-emerald-700">
              {status.myobUser ? `${status.myobUser} · ` : ""}since {new Date(status.connectedAt).toLocaleDateString("en-AU")}
            </p>
          </div>
          <button
            onClick={() => {
              if (window.confirm("Disconnect from MYOB? Nothing will sync until reconnected.")) {
                run(disconnectMyobAction);
              }
            }}
            disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-600"
          >
            Disconnect
          </button>
        </div>
      )}

      {status.state === "connected" && (
        <div>
          <h3 className="font-semibold text-gray-800">Where the money lands in MYOB</h3>
          <p className="mt-1 text-xs text-gray-500">
            These come from the bookkeeper. Each stream posts to the chosen account —
            the lists are read live from the MYOB chart of accounts.
          </p>
          {accountsError && (
            <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              Couldn&rsquo;t read the chart of accounts just now: {accountsError}
            </p>
          )}
          <div className="mt-3 space-y-3">
            {MYOB_ACCOUNT_SLOTS.map((slot) => {
              const options = accounts.filter((a) => slot.kinds.includes(a.classification));
              const chosen = map[slot.key]?.uid ?? "";
              return (
                <div key={slot.key} className="grid grid-cols-[1fr_1.4fr] items-center gap-3">
                  <div>
                    <div className="font-medium text-gray-700">{slot.label}</div>
                    <div className="text-xs text-gray-400">{slot.hint}</div>
                  </div>
                  <select
                    value={chosen}
                    onChange={(e) => {
                      const a = accounts.find((x) => x.uid === e.target.value);
                      setMap((m) => {
                        const next = { ...m };
                        if (a) next[slot.key] = { uid: a.uid, displayId: a.displayId, name: a.name };
                        else delete next[slot.key];
                        return next;
                      });
                    }}
                    className="rounded-md border border-gray-300 px-3 py-2"
                    data-testid={`myob-map-${slot.key}`}
                  >
                    <option value="">Not set</option>
                    {options.map((a) => (
                      <option key={a.uid} value={a.uid}>{a.displayId} · {a.name}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => run(() => saveAccountMapAction(map))}
            disabled={busy}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 font-medium text-white disabled:opacity-50"
            data-testid="myob-map-save"
          >
            {busy ? "Saving…" : "Save mapping"}
          </button>
        </div>
      )}

      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  );
}
