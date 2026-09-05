"use client";

import { useState } from "react";
import Link from "next/link";
import { journeyWho, type WizardJourney } from "@/lib/wizard/journey";
import WizardPill from "./WizardPill";
import JourneyDrawer from "./JourneyDrawer";

/**
 * Buckets brief §5 — the Wizard tab: every open session (no estimate yet)
 * as a row with its pill, so a session with no price still appears.
 */
export default function WizardSessionsTable({ sessions, openId = null }: { sessions: WizardJourney[]; openId?: string | null }) {
  const [open, setOpen] = useState<WizardJourney | null>(() => sessions.find((s) => s.id === openId) ?? null);
  return (
    <>
      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Who</th>
              <th className="px-4 py-2 font-medium">Wizard status</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium">Started</th>
              <th className="px-4 py-2 text-right font-medium">Rough value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sessions.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50" data-testid={`wizard-row-${s.id}`}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{journeyWho(s)}</div>
                  <div className="text-xs text-gray-500">{[s.address || s.suburb, s.email, s.phone].filter(Boolean).join(" · ") || "No contact yet"}</div>
                </td>
                <td className="px-4 py-2.5"><WizardPill j={s} onOpen={() => setOpen(s)} /></td>
                <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{s.entrySource ?? "—"}{s.mode ? ` · ${s.mode}` : ""}</td>
                <td className="px-4 py-2.5 text-gray-500">{s.startedAt ? new Date(s.startedAt).toLocaleDateString("en-AU") : "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{s.estValueCents != null ? `$${Math.round(s.estValueCents / 100).toLocaleString("en-AU")}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sessions.length === 0 && <div className="p-10 text-center text-sm text-gray-400">No open wizard sessions match. <Link href="/estimates?status=wizard" className="underline">Clear filters</Link></div>}
      </div>
      {open && <JourneyDrawer j={open} onClose={() => setOpen(null)} />}
    </>
  );
}
