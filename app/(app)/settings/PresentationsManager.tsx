"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { acceptAttr, checkUpload, type UploadKind } from "@/lib/uploads/validate";
import PresentationBlocks from "@/app/e/[token]/PresentationBlocks";

type Block = { id: string; kind: string; position: number; enabled: boolean; content: Record<string, unknown> };
export type PresentationRow = { id: string; name: string; description: string; is_default: boolean; presentation_blocks: Block[] };

const KIND_LABEL: Record<string, string> = { video: "Video", before_after_gallery: "Before / after", review_set: "Reviews", capability_panel: "Capability panel" };
const EMPTY: Record<string, unknown> = {
  video: { title: "", description: "", videos: [{ url: "", storage_path: "", poster_path: "", caption_title: "", caption_sub: "", duration_label: "" }] },
  before_after_gallery: { title: "", description: "", pairs: [] },
  review_set: { title: "", reviews: [], footer_line: "" },
  capability_panel: { title: "", cards: [] },
};
const inp = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";

async function upload(bucket: string, file: File): Promise<string> {
  const supabase = createClient();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw error;
  return path;
}

export default function PresentationsManager({ initial, usage }: { initial: PresentationRow[]; usage: Record<string, number> }) {
  const [rows, setRows] = useState<PresentationRow[]>(() => initial.map((p) => ({ ...p, presentation_blocks: [...p.presentation_blocks].sort((a, b) => a.position - b.position) })));
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function duplicate(p: PresentationRow) {
    const name = prompt("New presentation name:", `${p.name} copy`);
    if (!name) return;
    const supabase = createClient();
    const { data: pres, error } = await supabase.from("presentations").insert({ name, description: p.description, is_default: false }).select("id").single();
    if (error) { setMsg(error.message); return; }
    const blocks = p.presentation_blocks.map((b) => ({ presentation_id: pres.id, kind: b.kind, position: b.position, enabled: b.enabled, content: b.content }));
    if (blocks.length) await supabase.from("presentation_blocks").insert(blocks);
    const { data: full } = await supabase.from("presentations").select("id, name, description, is_default, presentation_blocks(id, kind, position, enabled, content)").eq("id", pres.id).single();
    if (full) { setRows((rs) => [...rs, full as PresentationRow]); setEditing((full as PresentationRow).id); }
  }
  async function createScaffold() {
    const name = prompt("New presentation name:");
    if (!name) return;
    const supabase = createClient();
    const { data: pres, error } = await supabase.from("presentations").insert({ name, description: "" }).select("id").single();
    if (error) { setMsg(error.message); return; }
    const kinds = ["video", "before_after_gallery", "review_set", "capability_panel"];
    await supabase.from("presentation_blocks").insert(kinds.map((k, i) => ({ presentation_id: pres.id, kind: k, position: i, enabled: true, content: EMPTY[k] })));
    const { data: full } = await supabase.from("presentations").select("id, name, description, is_default, presentation_blocks(id, kind, position, enabled, content)").eq("id", pres.id).single();
    if (full) { setRows((rs) => [...rs, { ...(full as PresentationRow), presentation_blocks: [...(full as PresentationRow).presentation_blocks].sort((a, b) => a.position - b.position) }]); setEditing((full as PresentationRow).id); }
  }
  async function remove(p: PresentationRow) {
    if ((usage[p.id] ?? 0) > 0) { alert(`Can't delete — used on ${usage[p.id]} estimate(s). Duplicate it or leave it in place.`); return; }
    if (!confirm(`Delete "${p.name}"?`)) return;
    const { error } = await createClient().from("presentations").delete().eq("id", p.id);
    if (error) { setMsg(error.message); return; }
    setRows((rs) => rs.filter((x) => x.id !== p.id));
  }

  const patchBlock = (presId: string, blockId: string, content: Record<string, unknown>) =>
    setRows((rs) => rs.map((p) => p.id !== presId ? p : { ...p, presentation_blocks: p.presentation_blocks.map((b) => b.id === blockId ? { ...b, content } : b) }));
  const patchBlockMeta = (presId: string, blockId: string, meta: Partial<Block>) =>
    setRows((rs) => rs.map((p) => p.id !== presId ? p : { ...p, presentation_blocks: p.presentation_blocks.map((b) => b.id === blockId ? { ...b, ...meta } : b) }));

  async function saveBlock(b: Block) {
    const { error } = await createClient().from("presentation_blocks").update({ content: b.content, enabled: b.enabled, position: b.position }).eq("id", b.id);
    setMsg(error ? error.message : "Saved ✓");
  }
  async function movePres(p: PresentationRow, blockId: string, dir: -1 | 1) {
    const blocks = [...p.presentation_blocks];
    const i = blocks.findIndex((b) => b.id === blockId);
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    [blocks[i].position, blocks[j].position] = [blocks[j].position, blocks[i].position];
    setRows((rs) => rs.map((x) => x.id !== p.id ? x : { ...x, presentation_blocks: [...blocks].sort((a, b) => a.position - b.position) }));
    const supabase = createClient();
    await supabase.from("presentation_blocks").update({ position: blocks[i].position }).eq("id", blocks[i].id);
    await supabase.from("presentation_blocks").update({ position: blocks[j].position }).eq("id", blocks[j].id);
  }

  const active = rows.find((p) => p.id === editing);

  if (active) {
    return (
      <div className="space-y-4">
        <button onClick={() => setEditing(null)} className="text-sm font-medium text-blue-600 hover:text-blue-800">← All presentations</button>
        <input className={`${inp} max-w-md font-semibold`} value={active.name} onChange={(e) => setRows((rs) => rs.map((p) => p.id === active.id ? { ...p, name: e.target.value } : p))} onBlur={() => createClient().from("presentations").update({ name: active.name, description: active.description }).eq("id", active.id)} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            {active.presentation_blocks.map((b, i) => (
              <div key={b.id} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{KIND_LABEL[b.kind] ?? b.kind}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <button onClick={() => movePres(active, b.id, -1)} disabled={i === 0} className="disabled:opacity-30">↑</button>
                    <button onClick={() => movePres(active, b.id, 1)} disabled={i === active.presentation_blocks.length - 1} className="disabled:opacity-30">↓</button>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={b.enabled} onChange={(e) => { patchBlockMeta(active.id, b.id, { enabled: e.target.checked }); }} /> On</label>
                  </div>
                </div>
                <div className="mt-2">
                  <BlockEditor block={b} onChange={(c) => patchBlock(active.id, b.id, c)} />
                </div>
                <button onClick={() => saveBlock(active.presentation_blocks.find((x) => x.id === b.id)!)} className="mt-2 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700">Save block</button>
              </div>
            ))}
          </div>
          {/* live preview */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            <div className="mb-1 text-xs font-medium text-gray-500">Live preview</div>
            <div className="cv overflow-hidden rounded-xl border border-gray-200 p-4" style={{ background: "var(--ink,#0a0b0d)" }}>
              <PresentationBlocks blocks={active.presentation_blocks.filter((b) => b.enabled).map((b) => ({ kind: b.kind, content: b.content }))} />
            </div>
          </div>
        </div>
        {msg && <p className="text-xs text-green-600">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button onClick={createScaffold} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">+ New presentation (blank)</button>
      </div>
      {rows.length === 0 && <p className="text-sm text-gray-500">No presentations yet. Run the seed to add the Commercial preset, or create a blank one.</p>}
      {rows.map((p) => (
        <div key={p.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
          <div>
            <div className="text-sm font-medium">{p.name}{p.is_default && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">default</span>}</div>
            <div className="text-xs text-gray-400">{p.presentation_blocks.length} blocks · used on {usage[p.id] ?? 0} estimate{(usage[p.id] ?? 0) === 1 ? "" : "s"}</div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => setEditing(p.id)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium hover:bg-gray-50">Edit</button>
            <button onClick={() => duplicate(p)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium hover:bg-gray-50">Duplicate</button>
            <button onClick={() => remove(p)} className="px-1 text-gray-400 hover:text-red-600" title="Delete">×</button>
          </div>
        </div>
      ))}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </div>
  );
}

// -------- per-kind editors ---------------------------------------------------
function T({ label, value, onChange, area }: { label: string; value: string; onChange: (v: string) => void; area?: boolean }) {
  return (
    <label className="block text-xs">
      <span className="text-gray-500">{label}</span>
      {area ? <textarea rows={2} className={`mt-1 ${inp}`} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input className={`mt-1 ${inp}`} value={value} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}
function Up({ label, bucket, kind, path, onDone }: { label: string; bucket: string; kind: UploadKind; path: string; onDone: (p: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <label className="inline-flex cursor-pointer flex-wrap items-center gap-2 text-xs">
      <span className="rounded-md border border-gray-300 px-2 py-1 font-medium hover:bg-gray-50">{busy ? "Uploading…" : path ? `${label} ✓` : label}</span>
      <input
        type="file"
        accept={acceptAttr(kind)}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const bad = checkUpload(f, kind);
          if (bad) { setErr(bad); return; }
          setBusy(true);
          setErr("");
          // This used to swallow the error and simply stop looking busy, which
          // reads as "uploaded" — the file was silently missing from the
          // presentation the customer then saw.
          try { onDone(await upload(bucket, f)); }
          catch (x) { setErr(x instanceof Error ? x.message : String((x as { message?: string })?.message ?? "Upload failed")); }
          setBusy(false);
        }}
      />
      {err && <span className="text-red-600">{err}</span>}
    </label>
  );
}

function BlockEditor({ block, onChange }: { block: Block; onChange: (c: Record<string, unknown>) => void }) {
  const c = block.content as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => onChange({ ...c, ...patch });

  if (block.kind === "video") {
    const v = ((c.videos as Record<string, unknown>[]) ?? [{}])[0] ?? {};
    const setV = (patch: Record<string, unknown>) => set({ videos: [{ ...v, ...patch }] });
    return (
      <div className="space-y-2">
        <T label="Title" value={String(c.title ?? "")} onChange={(x) => set({ title: x })} />
        <T label="Description" value={String(c.description ?? "")} onChange={(x) => set({ description: x })} area />
        <T label="YouTube link (or paste a hosted URL)" value={String(v.url ?? "")} onChange={(x) => setV({ url: x })} />
        <T label="Caption title" value={String(v.caption_title ?? "")} onChange={(x) => setV({ caption_title: x })} />
        <T label="Caption subtitle" value={String(v.caption_sub ?? "")} onChange={(x) => setV({ caption_sub: x })} />
        <T label="Duration label" value={String(v.duration_label ?? "")} onChange={(x) => setV({ duration_label: x })} />
        <div className="flex gap-3">
          <Up label="Poster image" bucket="presentation-media" kind="image" path={String(v.poster_path ?? "")} onDone={(p) => setV({ poster_path: p })} />
          <Up label="Video file (fallback)" bucket="presentation-media" kind="video" path={String(v.storage_path ?? "")} onDone={(p) => setV({ storage_path: p })} />
        </div>
      </div>
    );
  }
  if (block.kind === "before_after_gallery") {
    const pairs = (c.pairs as Record<string, unknown>[]) ?? [];
    const setPair = (i: number, patch: Record<string, unknown>) => set({ pairs: pairs.map((p, j) => j === i ? { ...p, ...patch } : p) });
    return (
      <div className="space-y-2">
        <T label="Title" value={String(c.title ?? "")} onChange={(x) => set({ title: x })} />
        <T label="Description" value={String(c.description ?? "")} onChange={(x) => set({ description: x })} />
        {pairs.map((p, i) => (
          <div key={i} className="rounded border border-gray-100 p-2">
            <div className="flex items-center justify-between"><span className="text-[11px] font-medium text-gray-500">Pair {i + 1}</span>
              <button onClick={() => set({ pairs: pairs.filter((_, j) => j !== i) })} className="text-xs text-gray-400 hover:text-red-600">remove</button></div>
            <div className="mt-1 flex gap-3">
              <Up label="Before" bucket="presentation-media" kind="image" path={String(p.before_path ?? "")} onDone={(x) => setPair(i, { before_path: x })} />
              <Up label="After" bucket="presentation-media" kind="image" path={String(p.after_path ?? "")} onDone={(x) => setPair(i, { after_path: x })} />
            </div>
            <T label="Info title" value={String(p.info_title ?? "")} onChange={(x) => setPair(i, { info_title: x })} />
            <T label="Info subtitle" value={String(p.info_subtitle ?? "")} onChange={(x) => setPair(i, { info_subtitle: x })} />
          </div>
        ))}
        <button onClick={() => set({ pairs: [...pairs, { before_path: "", after_path: "", info_title: "", info_subtitle: "" }] })} className="text-xs font-medium text-blue-600">+ Add pair</button>
      </div>
    );
  }
  if (block.kind === "review_set") {
    const reviews = (c.reviews as Record<string, unknown>[]) ?? [];
    const setR = (i: number, patch: Record<string, unknown>) => set({ reviews: reviews.map((r, j) => j === i ? { ...r, ...patch } : r) });
    return (
      <div className="space-y-2">
        <T label="Title" value={String(c.title ?? "")} onChange={(x) => set({ title: x })} />
        {reviews.map((r, i) => (
          <div key={i} className="rounded border border-gray-100 p-2">
            <div className="flex items-center justify-between"><span className="text-[11px] font-medium text-gray-500">Review {i + 1}</span>
              <button onClick={() => set({ reviews: reviews.filter((_, j) => j !== i) })} className="text-xs text-gray-400 hover:text-red-600">remove</button></div>
            <T label="Body (wrap a phrase in ==marks== to highlight)" value={String(r.body ?? "")} onChange={(x) => setR(i, { body: x })} area />
            <T label="Reviewer title" value={String(r.reviewer_title ?? "")} onChange={(x) => setR(i, { reviewer_title: x })} />
            <T label="Company" value={String(r.company_name ?? "")} onChange={(x) => setR(i, { company_name: x })} />
            <T label="Source" value={String(r.source ?? "")} onChange={(x) => setR(i, { source: x })} />
          </div>
        ))}
        {reviews.length < 3 && <button onClick={() => set({ reviews: [...reviews, { body: "", reviewer_title: "", company_name: "", source: "" }] })} className="text-xs font-medium text-blue-600">+ Add review</button>}
        <T label="Footer line" value={String(c.footer_line ?? "")} onChange={(x) => set({ footer_line: x })} />
      </div>
    );
  }
  // capability_panel
  const cards = (c.cards as Record<string, unknown>[]) ?? [];
  const setCard = (i: number, patch: Record<string, unknown>) => set({ cards: cards.map((cc, j) => j === i ? { ...cc, ...patch } : cc) });
  return (
    <div className="space-y-2">
      <T label="Title" value={String(c.title ?? "")} onChange={(x) => set({ title: x })} />
      {cards.map((cc, i) => {
        const att = (cc.attachment as Record<string, unknown>) ?? {};
        return (
          <div key={i} className="rounded border border-gray-100 p-2">
            <div className="flex items-center justify-between"><span className="text-[11px] font-medium text-gray-500">Card {i + 1}</span>
              <button onClick={() => set({ cards: cards.filter((_, j) => j !== i) })} className="text-xs text-gray-400 hover:text-red-600">remove</button></div>
            <div className="flex gap-2"><div className="w-16"><T label="Icon" value={String(cc.icon ?? "")} onChange={(x) => setCard(i, { icon: x })} /></div>
              <div className="flex-1"><T label="Heading" value={String(cc.heading ?? "")} onChange={(x) => setCard(i, { heading: x })} /></div></div>
            <T label="Body" value={String(cc.body ?? "")} onChange={(x) => setCard(i, { body: x })} area />
            <div className="flex items-center gap-3">
              <T label="Attachment button label (optional)" value={String(att.label ?? "")} onChange={(x) => setCard(i, { attachment: { ...att, label: x } })} />
              <Up label="PDF" bucket="presentation-docs" kind="document" path={String(att.doc_path ?? "")} onDone={(x) => setCard(i, { attachment: { ...att, doc_path: x } })} />
            </div>
          </div>
        );
      })}
      <button onClick={() => set({ cards: [...cards, { icon: "", heading: "", body: "" }] })} className="text-xs font-medium text-blue-600">+ Add card</button>
    </div>
  );
}
