"use client";

import Image from "next/image";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { acceptAttr } from "@/lib/uploads/validate";
import { uploadShowcasePhoto } from "@/lib/showcase/media";
import { showcaseMediaUrl } from "@/lib/showcase/format";
import { type Painter, type WebsiteContent } from "@/lib/marketing/siteContent";
import { saveWebsiteContentAction } from "./websiteActions";

/**
 * Settings → Company → Website (Tom, 5 Sep 2026): the painter cards, the two
 * photos on the "No surprises on the invoice" card, and the two photos in
 * the progress story's phone. Uploads go through the same path as showcase
 * photos (downscaled in the browser, staff-only bucket policy). Save writes
 * one settings row; the homepage picks it up within a minute.
 */
const input = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none";
const blankPainter = (): Painter => ({ name: "", specialty: "", since: "", quote: "", photoPath: null });

export default function WebsiteContentManager({ initial }: { initial: WebsiteContent }) {
  const [c, setC] = useState<WebsiteContent>(initial);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(slot: string, file: File | null | undefined, apply: (path: string) => void) {
    if (!file) return;
    setUploading(slot); setStatus(null);
    const out = await uploadShowcasePhoto(createClient(), "site", file);
    setUploading(null);
    if ("error" in out) { setStatus({ ok: false, text: out.error }); return; }
    apply(out.path);
    setStatus({ ok: true, text: "Photo uploaded — Save to keep it." });
  }

  async function save() {
    setBusy(true); setStatus(null);
    const res = await saveWebsiteContentAction({
      ...c,
      painters: c.painters.filter((p) => p.name.trim()),
    });
    setBusy(false);
    if (res.status === "saved") { setC(res.content); setStatus({ ok: true, text: "Saved — live on the website within a minute." }); }
    else if (res.status === "invalid") setStatus({ ok: false, text: res.issues.join(" ") });
    else setStatus({ ok: false, text: res.message });
  }

  const setPainter = (i: number, patch: Partial<Painter>) => setC((x) => ({ ...x, painters: x.painters.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const setSlot = (key: "promisePhotos" | "storyPhotos", i: number, path: string | null) =>
    setC((x) => { const arr = [...x[key]]; if (path) arr[i] = path; else arr.splice(i, 1); return { ...x, [key]: arr.filter(Boolean).slice(0, 2) }; });

  return (
    <div className="grid gap-6" data-testid="website-content">
      {status && <p data-testid="website-status" className={`rounded-md px-3 py-2 text-sm ${status.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>{status.text}</p>}

      <section className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Who&rsquo;ll be painting — up to three painters</h3>
          <p className="text-xs text-gray-500">Photo, name, specialty and the year they started with Paint Group. No ratings, no job counts — the website never shows those. Only painters who have agreed to be named go here (⚑9.3). Leave it empty and the website shows placeholder cards.</p>
        </div>
        {c.painters.map((p, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-gray-200 p-3 sm:grid-cols-[96px_1fr]" data-testid={`painter-${i}`}>
            <div className="grid gap-1">
              <div className="relative h-16 w-16 overflow-hidden rounded-full bg-gray-100">
                {p.photoPath && <Image src={showcaseMediaUrl(p.photoPath)} alt="" fill sizes="64px" className="object-cover" />}
              </div>
              <label className="cursor-pointer text-xs text-gray-700 underline">
                {uploading === `painter-${i}` ? "Uploading…" : p.photoPath ? "Change photo" : "Add photo"}
                <input type="file" accept={acceptAttr("image")} className="hidden" data-testid={`painter-${i}-photo`} onChange={(e) => void upload(`painter-${i}`, e.target.files?.[0], (path) => setPainter(i, { photoPath: path }))} />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={input} placeholder="Name (e.g. Felipe M.)" value={p.name} onChange={(e) => setPainter(i, { name: e.target.value })} data-testid={`painter-${i}-name`} />
              <input className={input} placeholder="Specialty (e.g. Interiors, heritage)" value={p.specialty} onChange={(e) => setPainter(i, { specialty: e.target.value })} data-testid={`painter-${i}-specialty`} />
              <input className={input} placeholder="With Paint Group since (year)" inputMode="numeric" maxLength={4} value={p.since} onChange={(e) => setPainter(i, { since: e.target.value })} data-testid={`painter-${i}-since`} />
              <input className={input} placeholder="One line in their own words" maxLength={200} value={p.quote} onChange={(e) => setPainter(i, { quote: e.target.value })} data-testid={`painter-${i}-quote`} />
              <button type="button" className="justify-self-start text-xs text-red-700 underline" onClick={() => setC((x) => ({ ...x, painters: x.painters.filter((_, j) => j !== i) }))}>Remove painter</button>
            </div>
          </div>
        ))}
        {c.painters.length < 3 && (
          <button type="button" className="justify-self-start rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50" data-testid="painter-add" onClick={() => setC((x) => ({ ...x, painters: [...x.painters, blankPainter()] }))}>+ Add a painter</button>
        )}
      </section>

      <PhotoSlots
        title="“No surprises on the invoice” — the variation card's two photos"
        blurb="The two small photos under “Replace 2.4 m of rotten fascia board…” in the promise explorer. Real photos of a variation like that one (with the customer's consent)."
        labels={["Photo 1", "Photo 2"]} paths={c.promisePhotos} slotKey="promise" uploading={uploading}
        onUpload={(i, file) => upload(`promise-${i}`, file, (path) => setSlot("promisePhotos", i, path))}
        onRemove={(i) => setSlot("promisePhotos", i, null)}
      />
      <PhotoSlots
        title="“Watch it happen” — the two photos that arrive on the phone"
        blurb="Beat 3 of the story: “Prep · floors covered” and “Living room · masked up”. Landscape works best."
        labels={["Prep · floors covered", "Living room · masked up"]} paths={c.storyPhotos} slotKey="story" uploading={uploading}
        onUpload={(i, file) => upload(`story-${i}`, file, (path) => setSlot("storyPhotos", i, path))}
        onRemove={(i) => setSlot("storyPhotos", i, null)}
      />

      <div className="flex items-center gap-3">
        <button type="button" className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" disabled={busy || uploading != null} onClick={() => void save()} data-testid="website-save">
          {busy ? "Saving…" : "Save"}
        </button>
        <span className="text-xs text-gray-500">The top-left logo comes from Company details → logo 1 (the one for dark backgrounds).</span>
      </div>
    </div>
  );
}

function PhotoSlots({ title, blurb, labels, paths, slotKey, uploading, onUpload, onRemove }: {
  title: string; blurb: string; labels: [string, string]; paths: string[]; slotKey: string; uploading: string | null;
  onUpload: (i: number, file: File | null | undefined) => void; onRemove: (i: number) => void;
}) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-500">{blurb}</p>
      </div>
      <div className="flex flex-wrap gap-4">
        {labels.map((label, i) => {
          const path = paths[i];
          return (
            <div key={label} className="grid gap-1" data-testid={`${slotKey}-slot-${i}`}>
              <div className="relative h-[84px] w-[120px] overflow-hidden rounded-md bg-gray-100">
                {path && <Image src={showcaseMediaUrl(path)} alt="" fill sizes="120px" className="object-cover" />}
              </div>
              <span className="text-xs text-gray-600">{label}</span>
              <div className="flex gap-2">
                <label className="cursor-pointer text-xs text-gray-700 underline">
                  {uploading === `${slotKey}-${i}` ? "Uploading…" : path ? "Change" : "Upload"}
                  <input type="file" accept={acceptAttr("image")} className="hidden" data-testid={`${slotKey}-slot-${i}-upload`} onChange={(e) => onUpload(i, e.target.files?.[0])} />
                </label>
                {path && <button type="button" className="text-xs text-red-700 underline" onClick={() => onRemove(i)}>Remove</button>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
