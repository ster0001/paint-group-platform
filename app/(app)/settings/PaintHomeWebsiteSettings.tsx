"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadShowcasePhoto } from "@/lib/showcase/media";
import { showcaseMediaUrl } from "@/lib/showcase/format";
import { acceptAttr } from "@/lib/uploads/validate";
import { setPaintHomeRankAction } from "@/lib/showcase/actions";
import { savePaintHomeHeroAction } from "./websiteActions";
import SiteCopyEditor from "./SiteCopyEditor";
import type { SiteCopy } from "@/lib/marketing/copy/schema";

/**
 * Tom, 25 Oct 2026: "I can't see the website for Paint Home in the settings
 * page … labelled clearly as Paint Home website so I can edit the hero image
 * etc and add more projects". One folder, three parts, in the order a visitor
 * meets them: the hero photo (Paint Home's own field on the website_content
 * row), every word on the site (the Paint Home copy, moved here from the
 * Website copy folder), and the project cards (published home jobs at or
 * under the phone-close price, with their Paint Home rank set inline).
 */
export type PaintHomeProject = { id: string; title: string; suburb: string; priceHighCents: number | null; rank: number | null; fits: boolean };

const money = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-AU");

export default function PaintHomeWebsiteSettings({ heroPhoto, copy, projects, capCents, paintHomeHref }: {
  heroPhoto: string | null;
  copy: SiteCopy;
  projects: PaintHomeProject[];
  capCents: number;
  paintHomeHref: string;
}) {
  const [hero, setHero] = useState<string | null>(heroPhoto);
  const [savedHero, setSavedHero] = useState<string | null>(heroPhoto);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [rows, setRows] = useState(projects);
  const [rankStatus, setRankStatus] = useState<string | null>(null);

  async function upload(file: File | null | undefined) {
    if (!file) return;
    setUploading(true); setStatus(null);
    const out = await uploadShowcasePhoto(createClient(), "site", file);
    setUploading(false);
    if ("error" in out) { setStatus({ ok: false, text: out.error }); return; }
    setHero(out.path);
    setStatus({ ok: true, text: "Photo uploaded — Save to put it on the site." });
  }
  async function saveHero() {
    setBusy(true); setStatus(null);
    const res = await savePaintHomeHeroAction(hero);
    setBusy(false);
    if (res.status === "saved") { setSavedHero(res.content.heroPhotoPaintHome); setStatus({ ok: true, text: "Saved — live on painthome.com.au within a minute." }); }
    else if (res.status === "invalid") setStatus({ ok: false, text: res.issues.join(" ") });
    else setStatus({ ok: false, text: res.message });
  }
  async function setRank(id: string, rank: number | null) {
    setRankStatus(null);
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, rank } : rank != null && r.rank === rank ? { ...r, rank: null } : r)));
    const res = await setPaintHomeRankAction({ id, rank });
    if (res.status !== "saved") { setRows(prev); setRankStatus(res.status === "error" ? res.message : "That rank didn't save."); }
    else setRankStatus("Saved — the cards change on painthome.com.au within a minute.");
  }

  const cards = [...rows].filter((r) => r.fits).sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9));
  return (
    <div className="grid gap-8" data-testid="painthome-website">
      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Hero photo</h3>
          <p className="text-xs text-gray-600">The photo behind the headline at the top of painthome.com.au (darkened on desktop, a strip above the box on phones). Leave it empty and the homes site&rsquo;s hero photo is used.</p>
        </div>
        {status && <p data-testid="painthome-hero-status" className={`rounded-md px-3 py-2 text-sm ${status.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{status.text}</p>}
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative h-[110px] w-[196px] overflow-hidden rounded-md border border-gray-200 bg-gray-100" data-testid="painthome-hero-slot">
            {hero && <Image src={showcaseMediaUrl(hero)} alt="" fill sizes="196px" className="object-cover" />}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">
              {uploading ? "Uploading…" : hero ? "Change photo" : "Upload photo"}
              <input type="file" accept={acceptAttr("image")} className="hidden" data-testid="painthome-hero-upload" onChange={(e) => void upload(e.target.files?.[0])} />
            </label>
            {hero && <button type="button" className="text-xs text-red-700 underline" onClick={() => setHero(null)}>Remove</button>}
            <button type="button" onClick={() => void saveHero()} disabled={busy || uploading || hero === savedHero} data-testid="painthome-hero-save"
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">{busy ? "Saving…" : "Save hero photo"}</button>
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Every word on the site</h3>
          <p className="text-xs text-gray-600">Headline, the lines under it, How it works, Who&rsquo;ll be painting, the FAQ and the footer — section by section, with the live Paint Home page beside it.</p>
        </div>
        <SiteCopyEditor initial={{ painthome: copy }} businessHref="/" paintHomeHref={paintHomeHref} />
      </section>

      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Project cards (&ldquo;Real jobs, real prices&rdquo;)</h3>
          <p className="text-xs text-gray-600">
            The three cards on painthome.com.au are published home jobs priced at or under {money(capCents)} (the phone-close ceiling), rank 1–3 first, then the newest.
            Give a job a rank here, or <Link href="/settings/showcase/new" className="underline" data-testid="painthome-new-project">add a new project →</Link> (photos, price range, what we did) and it will qualify as soon as it is published with a price under the ceiling.
          </p>
        </div>
        {rankStatus && <p data-testid="painthome-rank-status" className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800">{rankStatus}</p>}
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500" data-testid="painthome-projects-empty">No published home jobs yet — <Link href="/settings/showcase/new" className="underline">add the first one</Link>.</p>
        ) : (
          <table className="w-full text-sm" data-testid="painthome-projects">
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3">Job</th><th className="py-1 pr-3">Top of range</th><th className="py-1 pr-3">On Paint Home</th><th className="py-1">Paint Home card</th></tr></thead>
            <tbody>
              {[...cards, ...rows.filter((r) => !r.fits)].map((r) => (
                <tr key={r.id} className="border-t border-gray-100" data-testid={`painthome-project-${r.id}`}>
                  <td className="py-2 pr-3"><Link href={`/settings/showcase/${r.id}`} className="font-medium text-gray-900 hover:underline">{r.title}</Link><span className="text-gray-500"> · {r.suburb}</span></td>
                  <td className="py-2 pr-3 tabular-nums">{r.priceHighCents != null ? money(r.priceHighCents) : <span className="text-gray-400">no price</span>}</td>
                  <td className="py-2 pr-3 text-xs">{r.fits ? <span className="text-emerald-700">Qualifies</span> : <span className="text-gray-400">Over the ceiling or unpriced</span>}</td>
                  <td className="py-2">
                    <select value={r.rank ?? ""} disabled={!r.fits} data-testid={`painthome-rank-${r.id}`} className="rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-40"
                      onChange={(e) => void setRank(r.id, e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Not a card</option>
                      <option value="1">1 — first card</option>
                      <option value="2">2 — second card</option>
                      <option value="3">3 — third card</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Link href="/settings/showcase" data-testid="painthome-open-showcase" className="text-sm text-gray-700 underline">All showcase jobs →</Link>
      </section>
    </div>
  );
}
