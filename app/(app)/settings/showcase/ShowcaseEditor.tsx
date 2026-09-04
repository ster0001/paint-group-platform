"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { acceptAttr } from "@/lib/uploads/validate";
import { saveShowcaseJobAction, type SaveShowcaseResult } from "@/lib/showcase/actions";
import { formatPriceRange, showcaseMediaUrl, slugify } from "@/lib/showcase/format";
import { uploadShowcasePhoto } from "@/lib/showcase/media";
import {
  GALLERY_KINDS, JOB_TYPES, JOB_TYPE_LABEL, PROPERTY_TYPES, publishChecklist,
  type GalleryKind, type ShowcaseJob, type ShowcaseJobInput,
} from "@/lib/showcase/schema";
import type { EstimatePick } from "@/lib/showcase/staff";
import ProjectPage from "@/app/(marketing)/_components/ProjectPage";
import { marketingFontClass } from "@/app/(marketing)/fonts";
import "@/app/(marketing)/marketing.css";

/**
 * Settings → Showcase → the editor (homepage brief §4.4b).
 *
 * ONE form in the exact order the public page renders — hero photo → title,
 * type, property, suburb → completed on, days → price range → scope line →
 * summary → what we did → gallery → colours → condition → customer line →
 * linked estimate → featured rank → publish. The right-hand pane (≥1200px)
 * is the real ProjectPage fed the form's current state; smaller screens get
 * a Preview button that opens the same thing full-screen.
 *
 * Every save goes through saveShowcaseJobAction (zod, staff, service
 * client). Its answers drive the UI: `invalid` → inline sentences,
 * `publish_blocked` → the checklist, `rank_taken` → "replace which job?".
 */

type Form = {
  slug: string;
  title: string; job_type: ShowcaseJob["job_type"]; property_type: ShowcaseJob["property_type"]; suburb: string;
  completedMonth: string; daysOnSite: string;
  priceLow: string; priceHigh: string;
  scope_line: string; summary: string;
  what_we_did: Array<{ area: string; work: string }>;
  gallery: Array<{ path: string; caption: string; kind: GalleryKind }>;
  colours: Array<{ surface: string; brand: string; product: string; colour: string }>;
  condition_notes: string;
  review_quote: string; review_name: string;
  estimate_id: string | null;
  hero_path: string | null;
  featured_rank: number | null;
  consent_confirmed: boolean;
  published: boolean;
};

const dollars = (cents: number | null) => (cents == null ? "" : String(Math.round(cents / 100)));
const cents = (s: string) => { const n = Number(s.replace(/[^0-9.]/g, "")); return s.trim() === "" || !Number.isFinite(n) ? null : Math.round(n * 100); };

function fromJob(j: ShowcaseJob | null): Form {
  return {
    slug: j?.slug ?? "",
    title: j?.title ?? "", job_type: j?.job_type ?? "interior", property_type: j?.property_type ?? "home", suburb: j?.suburb ?? "",
    completedMonth: j?.completed_on ? j.completed_on.slice(0, 7) : "", daysOnSite: j?.days_on_site != null ? String(j.days_on_site) : "",
    priceLow: dollars(j?.price_low_cents ?? null), priceHigh: dollars(j?.price_high_cents ?? null),
    scope_line: j?.scope_line ?? "", summary: j?.summary ?? "",
    what_we_did: j?.what_we_did ?? [], gallery: j?.gallery ?? [], colours: j?.colours ?? [],
    condition_notes: j?.condition_notes ?? "",
    review_quote: j?.review_quote ?? "", review_name: j?.review_name ?? "",
    estimate_id: j?.estimate_id ?? null, hero_path: j?.hero_path ?? null,
    featured_rank: j?.featured_rank ?? null, consent_confirmed: j?.consent_confirmed ?? false, published: j?.published ?? false,
  };
}

function toInput(f: Form, id: string | undefined, displace = false): ShowcaseJobInput {
  return {
    id,
    slug: f.slug.trim() || undefined,
    title: f.title, job_type: f.job_type, property_type: f.property_type, suburb: f.suburb,
    completed_on: f.completedMonth ? `${f.completedMonth}-01` : null,
    days_on_site: f.daysOnSite.trim() === "" ? null : Number(f.daysOnSite),
    price_low_cents: cents(f.priceLow), price_high_cents: cents(f.priceHigh),
    scope_line: f.scope_line, summary: f.summary,
    what_we_did: f.what_we_did, colours: f.colours, condition_notes: f.condition_notes,
    hero_path: f.hero_path, gallery: f.gallery,
    estimate_id: f.estimate_id, review_quote: f.review_quote.trim() || null, review_name: f.review_name.trim() || null,
    featured_rank: f.featured_rank, consent_confirmed: f.consent_confirmed, published: f.published,
    displace_featured: displace || undefined,
  };
}

/** The preview is the real template fed the form as if it were a row. */
function toPreview(f: Form, base: ShowcaseJob | null): ShowcaseJob {
  const input = toInput(f, base?.id);
  return {
    id: base?.id ?? "preview",
    slug: input.slug ?? slugify(f.title || "untitled", f.suburb || "melbourne"),
    title: input.title, job_type: input.job_type, property_type: input.property_type, suburb: input.suburb,
    completed_on: input.completed_on, days_on_site: Number.isFinite(input.days_on_site as number) ? input.days_on_site : null,
    price_low_cents: input.price_low_cents, price_high_cents: input.price_high_cents,
    scope_line: input.scope_line, summary: input.summary, what_we_did: input.what_we_did, colours: input.colours,
    condition_notes: input.condition_notes, hero_path: input.hero_path, gallery: input.gallery, estimate_id: input.estimate_id,
    review_quote: input.review_quote, review_name: input.review_name, featured_rank: input.featured_rank,
    consent_confirmed: input.consent_confirmed, published: input.published, published_at: base?.published_at ?? null,
    created_at: base?.created_at ?? "", updated_at: base?.updated_at ?? "",
  };
}

const input = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none";
const label = "block text-sm font-medium text-gray-800";
const hint = "mt-1 text-xs text-gray-500";

export default function ShowcaseEditor({ initial, estimates }: { initial: ShowcaseJob | null; estimates: EstimatePick[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState<ShowcaseJob | null>(initial);
  const [form, setForm] = useState<Form>(() => fromJob(initial));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<"hero" | "gallery" | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [rankConflict, setRankConflict] = useState<{ rank: number; holder: { id: string; title: string; suburb: string } } | null>(null);
  const [sheet, setSheet] = useState(false);
  // One folder per job in the bucket. A new job has no id yet, so its key is
  // minted on the first upload (not during render — the compiler lint is right).
  const jobKey = useRef<string>(initial?.id ?? "");

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const preview = useMemo(() => toPreview(form, saved), [form, saved]);
  const checklist = useMemo(() => publishChecklist(toInput(form, saved?.id)), [form, saved]);
  const slugLocked = Boolean(saved?.published);

  async function upload(kind: "hero" | "gallery", files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(kind);
    setStatus(null);
    if (!jobKey.current) jobKey.current = crypto.randomUUID();
    const client = createClient();
    try {
      for (const file of Array.from(files)) {
        const out = await uploadShowcasePhoto(client, jobKey.current, file);
        if ("error" in out) { setStatus({ tone: "err", text: out.error }); continue; }
        if (kind === "hero") set({ hero_path: out.path });
        else setForm((f) => ({ ...f, gallery: [...f.gallery, { path: out.path, caption: "", kind: "after" }] }));
        setStatus({ tone: "info", text: `Photo uploaded — Save to keep it.` });
      }
    } finally {
      setUploading(null);
    }
  }

  async function save(displace = false) {
    setBusy(true); setIssues([]); setStatus(null); setRankConflict(null);
    let res: SaveShowcaseResult;
    try {
      res = await saveShowcaseJobAction(toInput(form, saved?.id, displace));
    } catch {
      res = { status: "error", message: "Couldn't reach the server — try again." };
    }
    setBusy(false);
    switch (res.status) {
      case "saved": {
        const wasNew = !saved;
        setSaved(res.job);
        setForm(fromJob(res.job));
        setStatus({ tone: "ok", text: res.job.published ? `Published — live at /work/${res.job.slug}` : "Saved as a draft" });
        if (wasNew) router.replace(`/settings/showcase/${res.job.id}`);
        return;
      }
      case "invalid": setIssues(res.issues); setStatus({ tone: "err", text: "Not saved — see the notes below." }); return;
      case "publish_blocked": setIssues(res.checklist); setStatus({ tone: "err", text: "Can't publish yet — this is what's missing." }); return;
      case "rank_taken": setRankConflict({ rank: res.rank, holder: res.holder }); return;
      case "error": setStatus({ tone: "err", text: res.message }); return;
    }
  }

  const previewPane = (
    <div className={`mk ${marketingFontClass}`} style={{ paddingBottom: 0 }}>
      <ProjectPage job={preview} preview />
    </div>
  );

  return (
    <main className="mx-auto max-w-[1600px] p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/settings/showcase" className="text-sm text-gray-500 hover:text-gray-900">← Showcase jobs</Link>
          <h1 className="mt-1 text-2xl font-semibold">{saved ? saved.title : "New showcase job"}</h1>
          {saved && <p className="text-xs text-gray-500">/work/{saved.slug} · {saved.published ? "published" : "draft"}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded-md border border-gray-300 px-3 py-2 text-sm xl:hidden" onClick={() => setSheet(true)} data-testid="showcase-preview-open">Preview</button>
          <button type="button" className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" disabled={busy || uploading != null} onClick={() => void save()} data-testid="showcase-save">
            {busy ? "Saving…" : form.published ? "Save & publish" : "Save draft"}
          </button>
        </div>
      </div>

      {status && (
        <p data-testid="showcase-status" className={`mb-3 rounded-md px-3 py-2 text-sm ${status.tone === "ok" ? "bg-green-50 text-green-800" : status.tone === "err" ? "bg-red-50 text-red-800" : "bg-gray-100 text-gray-700"}`}>{status.text}</p>
      )}
      {issues.length > 0 && (
        <ul data-testid="showcase-issues" className="mb-3 list-disc rounded-md bg-amber-50 px-6 py-2 text-sm text-amber-900">
          {issues.map((i) => <li key={i}>{i}</li>)}
        </ul>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ---------------- the form, in page order ---------------- */}
        <form className="grid gap-6 rounded-lg border border-gray-200 bg-white p-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Section n={1} title="Hero photo" blurb="The card photo and the big picture at the top of the page. Finished, well lit, landscape.">
            <div className="flex flex-wrap items-start gap-4">
              <div className="relative h-[135px] w-[180px] overflow-hidden rounded-md bg-gray-100">
                {form.hero_path && <Image src={showcaseMediaUrl(form.hero_path)} alt="Hero" fill sizes="180px" className="object-cover" data-testid="showcase-hero-img" />}
              </div>
              <div className="grid gap-2">
                <label className="cursor-pointer rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">
                  {uploading === "hero" ? "Uploading…" : form.hero_path ? "Change photo" : "Upload photo"}
                  <input type="file" accept={acceptAttr("image")} className="hidden" data-testid="showcase-hero-upload" onChange={(e) => void upload("hero", e.target.files)} />
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={form.consent_confirmed} onChange={(e) => set({ consent_confirmed: e.target.checked })} data-testid="showcase-consent" className="mt-1" />
                  <span>The customer has agreed to these photos being used on the website <span className="text-gray-500">(⚑9.11 — publishing is blocked until ticked)</span></span>
                </label>
              </div>
            </div>
          </Section>

          <Section n={2} title="The job" blurb="Title, what kind of job, whose place, and where.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={label} htmlFor="sc-title">Title</label>
                <input id="sc-title" className={input} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Exterior weatherboard" data-testid="showcase-title" />
              </div>
              <div>
                <label className={label} htmlFor="sc-type">Job type</label>
                <select id="sc-type" className={input} value={form.job_type} onChange={(e) => set({ job_type: e.target.value as Form["job_type"] })} data-testid="showcase-type">
                  {JOB_TYPES.map((t) => <option key={t} value={t}>{JOB_TYPE_LABEL[t]}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="sc-prop">Property</label>
                <select id="sc-prop" className={input} value={form.property_type} onChange={(e) => set({ property_type: e.target.value as Form["property_type"] })} data-testid="showcase-property">
                  {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t === "home" ? "A home" : "A business"}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="sc-suburb">Suburb</label>
                <input id="sc-suburb" className={input} value={form.suburb} onChange={(e) => set({ suburb: e.target.value })} placeholder="Thornbury" data-testid="showcase-suburb" />
              </div>
              <div>
                <label className={label} htmlFor="sc-slug">Web address</label>
                {slugLocked
                  ? <p className="rounded-md bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600">/work/{form.slug} <span className="font-sans text-gray-400">· locked once published</span></p>
                  : <input id="sc-slug" className={`${input} font-mono`} value={form.slug} onChange={(e) => set({ slug: e.target.value })} placeholder={slugify(form.title || "title", form.suburb || "suburb")} data-testid="showcase-slug" />}
                {!slugLocked && <p className={hint}>Leave blank to make it from the title and suburb.</p>}
              </div>
            </div>
          </Section>

          <Section n={3} title="When and how long" blurb="Shown as COMPLETED MON YYYY · N DAYS ON SITE.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="sc-month">Completed on</label>
                <input id="sc-month" type="month" className={input} value={form.completedMonth} onChange={(e) => set({ completedMonth: e.target.value })} data-testid="showcase-month" />
              </div>
              <div>
                <label className={label} htmlFor="sc-days">Days on site</label>
                <input id="sc-days" type="number" min={1} max={365} className={input} value={form.daysOnSite} onChange={(e) => set({ daysOnSite: e.target.value })} data-testid="showcase-days" />
              </div>
            </div>
          </Section>

          <Section n={4} title="Price range" blurb="The real price of this job, inc. GST, whole dollars. Shown large, in mono.">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
              <div>
                <label className={label} htmlFor="sc-low">From ($)</label>
                <input id="sc-low" inputMode="numeric" className={`${input} font-mono`} value={form.priceLow} onChange={(e) => set({ priceLow: e.target.value })} placeholder="8400" data-testid="showcase-price-low" />
              </div>
              <span className="pb-2 text-gray-400">–</span>
              <div>
                <label className={label} htmlFor="sc-high">To ($)</label>
                <input id="sc-high" inputMode="numeric" className={`${input} font-mono`} value={form.priceHigh} onChange={(e) => set({ priceHigh: e.target.value })} placeholder="9600" data-testid="showcase-price-high" />
              </div>
            </div>
            {cents(form.priceLow) != null && cents(form.priceHigh) != null && (
              <p className={hint}>Shows as <span className="font-mono">{formatPriceRange(cents(form.priceLow)!, cents(form.priceHigh)!)}</span></p>
            )}
          </Section>

          <Section n={5} title="Scope line" blurb="One line on the card. 90 characters at most.">
            <input className={input} maxLength={90} value={form.scope_line} onChange={(e) => set({ scope_line: e.target.value })} placeholder="Whole exterior, 2 coats, fascias & gutters, front fence" data-testid="showcase-scope" />
            <p className={hint}>{form.scope_line.length}/90</p>
          </Section>

          <Section n={6} title="Summary" blurb="Two to four sentences — the page's introduction.">
            <textarea className={input} rows={4} maxLength={2000} value={form.summary} onChange={(e) => set({ summary: e.target.value })} data-testid="showcase-summary" />
          </Section>

          <Section n={7} title="What we did" blurb="Area by area, in the order a visitor should read them. Drag to reorder.">
            <RowList
              items={form.what_we_did} onChange={(rows) => set({ what_we_did: rows })}
              blank={() => ({ area: "", work: "" })} addLabel="+ Add an area" testId="wwd"
              render={(r, patch) => (
                <div className="grid flex-1 gap-2 sm:grid-cols-[200px_1fr]">
                  <input className={input} placeholder="Living room" value={r.area} onChange={(e) => patch({ area: e.target.value })} aria-label="Area" />
                  <input className={input} placeholder="Walls, ceiling, trim, 2 coats" value={r.work} onChange={(e) => patch({ work: e.target.value })} aria-label="Work" />
                </div>
              )}
            />
          </Section>

          <Section n={8} title="Gallery" blurb="Before, during and after. Several at once is fine; drag to reorder.">
            <label className="inline-block cursor-pointer rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">
              {uploading === "gallery" ? "Uploading…" : "Add photos"}
              <input type="file" multiple accept={acceptAttr("image")} className="hidden" data-testid="showcase-gallery-upload" onChange={(e) => void upload("gallery", e.target.files)} />
            </label>
            <div className="mt-3">
              <RowList
                items={form.gallery} onChange={(rows) => set({ gallery: rows })} testId="gallery"
                render={(g, patch) => (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <div className="relative h-[48px] w-[64px] overflow-hidden rounded bg-gray-100">
                      <Image src={showcaseMediaUrl(g.path)} alt="" fill sizes="64px" className="object-cover" />
                    </div>
                    <select className={`${input} w-auto`} value={g.kind} onChange={(e) => patch({ kind: e.target.value as GalleryKind })} aria-label="Kind">
                      {GALLERY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <input className={`${input} min-w-[160px] flex-1`} placeholder="Caption (optional)" maxLength={160} value={g.caption} onChange={(e) => patch({ caption: e.target.value })} aria-label="Caption" />
                  </div>
                )}
              />
            </div>
          </Section>

          <Section n={9} title="Colours" blurb="Optional. Brand, product and colour name — the swatch is looked up from the name.">
            <RowList
              items={form.colours} onChange={(rows) => set({ colours: rows })}
              blank={() => ({ surface: "", brand: "", product: "", colour: "" })} addLabel="+ Add a colour" testId="colour"
              render={(c, patch) => (
                <div className="grid flex-1 gap-2 sm:grid-cols-4">
                  <input className={input} placeholder="Surface (walls)" value={c.surface} onChange={(e) => patch({ surface: e.target.value })} aria-label="Surface" />
                  <input className={input} placeholder="Brand (Dulux)" value={c.brand} onChange={(e) => patch({ brand: e.target.value })} aria-label="Brand" />
                  <input className={input} placeholder="Product (Wash&Wear)" value={c.product} onChange={(e) => patch({ product: e.target.value })} aria-label="Product" />
                  <input className={input} placeholder="Colour (Natural White)" value={c.colour} onChange={(e) => patch({ colour: e.target.value })} aria-label="Colour" />
                </div>
              )}
            />
          </Section>

          <Section n={10} title="What it was like before" blurb="Optional. The condition of the property when you arrived.">
            <textarea className={input} rows={3} maxLength={2000} value={form.condition_notes} onChange={(e) => set({ condition_notes: e.target.value })} />
          </Section>

          <Section n={11} title="What the customer said" blurb="Optional. First name and suburb only (⚑9.13).">
            <div className="grid gap-2">
              <textarea className={input} rows={2} maxLength={600} placeholder="Their words" value={form.review_quote} onChange={(e) => set({ review_quote: e.target.value })} />
              <input className={input} maxLength={80} placeholder="Sarah · Thornbury" value={form.review_name} onChange={(e) => set({ review_name: e.target.value })} />
            </div>
          </Section>

          <Section n={12} title="Link to the estimate" blurb="Optional. When linked, “Get a price like this” starts the visitor from this job&rsquo;s real scope (session 4).">
            <EstimatePicker estimates={estimates} value={form.estimate_id} onChange={(id) => set({ estimate_id: id })} />
          </Section>

          <Section n={13} title="Featured on the homepage" blurb="Ranks 1–3 are the three homepage cards, in that order. Only one job can hold each rank.">
            <select className={`${input} w-auto`} value={form.featured_rank ?? ""} onChange={(e) => set({ featured_rank: e.target.value === "" ? null : Number(e.target.value) })} data-testid="showcase-rank">
              <option value="">Not featured</option>
              <option value="1">1 — first card</option>
              <option value="2">2 — second card</option>
              <option value="3">3 — third card</option>
            </select>
          </Section>

          <Section n={14} title="Publish" blurb="Published jobs appear on /work and (if featured) the homepage within a minute of saving. Unpublish to take one down; its page then answers 404.">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.published} onChange={(e) => set({ published: e.target.checked })} data-testid="showcase-published" />
              <span>Published — visible on the website</span>
            </label>
            {form.published && checklist.length > 0 && (
              <ul data-testid="showcase-checklist" className="mt-2 list-disc rounded-md bg-amber-50 px-6 py-2 text-sm text-amber-900">
                {checklist.map((c) => <li key={c}>{c}</li>)}
              </ul>
            )}
          </Section>

          <div className="flex justify-end">
            <button type="submit" className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" disabled={busy || uploading != null}>
              {busy ? "Saving…" : form.published ? "Save & publish" : "Save draft"}
            </button>
          </div>
        </form>

        {/* ---------------- live preview (≥1200px) ---------------- */}
        <aside className="hidden xl:block" data-testid="showcase-preview-pane">
          <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-auto rounded-lg border border-gray-200 shadow-sm">
            <div className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">Live preview — exactly what a visitor sees at /work/{preview.slug}</div>
            {previewPane}
          </div>
        </aside>
      </div>

      {/* ---------------- preview sheet (<1200px) ---------------- */}
      {sheet && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label="Preview" data-testid="showcase-preview-sheet">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 text-sm">
            <span className="text-gray-600">Preview — /work/{preview.slug}</span>
            <button type="button" className="rounded-md border border-gray-300 px-3 py-1" onClick={() => setSheet(false)}>Close</button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">{previewPane}</div>
        </div>
      )}

      {/* ---------------- "replace which job?" ---------------- */}
      {rankConflict && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="rank-h" data-testid="rank-dialog">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 id="rank-h" className="text-lg font-semibold">Featured spot {rankConflict.rank} is taken</h2>
            <p className="mt-2 text-sm text-gray-600">
              <b>{rankConflict.holder.title}</b> · {rankConflict.holder.suburb} holds spot {rankConflict.rank} right now. Replace it with this job? The other job stays published, just not on the homepage.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-md border border-gray-300 px-3 py-2 text-sm" onClick={() => { setRankConflict(null); set({ featured_rank: null }); }} data-testid="rank-keep">Keep theirs</button>
              <button type="button" className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white" onClick={() => void save(true)} data-testid="rank-replace">Replace it</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Section({ n, title, blurb, children }: { n: number; title: string; blurb: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <div>
        <h2 className="text-sm font-semibold text-gray-900"><span className="mr-2 font-mono text-xs text-gray-400">{String(n).padStart(2, "0")}</span>{title}</h2>
        <p className="text-xs text-gray-500">{blurb}</p>
      </div>
      {children}
    </section>
  );
}

/** Repeatable rows: drag to reorder, ▲▼ for keyboards, remove, add. */
function RowList<T>({ items, onChange, render, blank, addLabel, testId }: {
  items: T[];
  onChange: (rows: T[]) => void;
  render: (item: T, patch: (p: Partial<T>) => void, index: number) => ReactNode;
  blank?: () => T;
  addLabel?: string;
  testId: string;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= items.length) return;
    const next = [...items]; const [it] = next.splice(from, 1); next.splice(to, 0, it); onChange(next);
  };
  return (
    <div className="grid gap-2" data-testid={`${testId}-rows`}>
      {items.map((it, i) => (
        <div
          key={i} className={`flex items-start gap-2 rounded-md border border-gray-200 p-2 ${drag === i ? "opacity-50" : ""}`}
          draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (drag != null) move(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}
          data-testid={`${testId}-row`}
        >
          <span className="cursor-grab select-none pt-2 text-gray-400" aria-hidden="true">⋮⋮</span>
          {render(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))), i)}
          <div className="flex flex-col gap-1">
            <button type="button" className="rounded border border-gray-200 px-1.5 text-xs" onClick={() => move(i, i - 1)} aria-label="Move up">▲</button>
            <button type="button" className="rounded border border-gray-200 px-1.5 text-xs" onClick={() => move(i, i + 1)} aria-label="Move down">▼</button>
          </div>
          <button type="button" className="rounded border border-gray-200 px-2 py-1 text-xs text-red-700" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove">×</button>
        </div>
      ))}
      {blank && addLabel && (
        <button type="button" className="justify-self-start rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50" onClick={() => onChange([...items, blank()])} data-testid={`${testId}-add`}>{addLabel}</button>
      )}
    </div>
  );
}

function EstimatePicker({ estimates, value, onChange }: { estimates: EstimatePick[]; value: string | null; onChange: (id: string | null) => void }) {
  const [q, setQ] = useState("");
  const chosen = value ? estimates.find((e) => e.id === value) ?? null : null;
  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (words.length === 0) return [];
    return estimates.filter((e) => words.every((w) => e.title.toLowerCase().includes(w))).slice(0, 8);
  }, [estimates, q]);
  if (chosen) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-gray-100 px-2 py-1">{chosen.title} <span className="text-gray-500">· {chosen.status}</span></span>
        <button type="button" className="text-xs text-gray-600 underline" onClick={() => onChange(null)}>Unlink</button>
      </div>
    );
  }
  if (value && !chosen) {
    return <p className="text-sm text-gray-500">Linked to an estimate this list doesn&rsquo;t show (older than the last 400). <button type="button" className="underline" onClick={() => onChange(null)}>Unlink</button></p>;
  }
  return (
    <div className="relative">
      <input className={input} placeholder="Type part of the address to find the estimate" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an estimate" />
      {matches.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow">
          {matches.map((e) => (
            <li key={e.id}>
              <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => { onChange(e.id); setQ(""); }}>
                {e.title} <span className="text-gray-500">· {e.status} · {e.created_at.slice(0, 10)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
