"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type PBlock =
  | { id: number; type: "heading"; html: string }
  | { id: number; type: "text"; html: string }
  | { id: number; type: "image"; url: string; path: string; caption: string };

let pid = 1;

// An uncontrolled rich-text region. Sets its initial HTML once on mount and
// reports edits upward, but never re-syncs from props — so the caret never jumps.
function RichText({
  initial,
  onInput,
  className,
  placeholder,
}: {
  initial: string;
  onInput: (html: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initial || "";
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={(e) => onInput((e.target as HTMLDivElement).innerHTML)}
      className={
        "rich-text min-h-[1.5em] outline-none focus:ring-1 focus:ring-gray-300 rounded " + (className ?? "")
      }
    />
  );
}

export default function PresentationBuilder({
  blocks,
  onChange,
}: {
  blocks: PBlock[];
  onChange: (b: PBlock[]) => void;
}) {
  if (blocks.length) pid = Math.max(pid, ...blocks.map((b) => b.id)) + 1;
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const update = (id: number, patch: Partial<PBlock>) =>
    onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as PBlock) : b)));
  const remove = (id: number) => onChange(blocks.filter((b) => b.id !== id));
  const add = (type: PBlock["type"]) => {
    const base = { id: pid++ };
    const b: PBlock =
      type === "image"
        ? { ...base, type: "image", url: "", path: "", caption: "" }
        : { ...base, type, html: "" };
    onChange([...blocks, b]);
  };

  const drop = (targetId: number) => {
    if (dragId == null || dragId === targetId) return;
    const from = blocks.findIndex((b) => b.id === dragId);
    const to = blocks.findIndex((b) => b.id === targetId);
    const copy = [...blocks];
    const [m] = copy.splice(from, 1);
    copy.splice(to, 0, m);
    onChange(copy);
    setDragId(null);
    setOverId(null);
  };

  const exec = (cmd: string) => document.execCommand(cmd, false);

  async function uploadImage(id: number, files: FileList | null) {
    if (!files || !files.length) return;
    const supabase = createClient();
    const f = files[0];
    const ext = f.name.split(".").pop() || "jpg";
    const path = `presentation/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("estimate-media").upload(path, f);
    if (error) return;
    const { data } = supabase.storage.from("estimate-media").getPublicUrl(path);
    update(id, { url: data.publicUrl, path } as Partial<PBlock>);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <style>{`.rich-text[data-placeholder]:empty:before{content:attr(data-placeholder);color:#9ca3af}
        .rich-text ul{list-style:disc;margin-left:1.25rem}.rich-text ol{list-style:decimal;margin-left:1.25rem}`}</style>

      {/* formatting toolbar (acts on whichever text block is focused) */}
      <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-white/90 p-2 backdrop-blur">
        {[
          ["Bold", "bold", "font-bold"],
          ["Italic", "italic", "italic"],
          ["Underline", "underline", "underline"],
        ].map(([label, cmd, cls]) => (
          <button
            key={cmd}
            onMouseDown={(e) => { e.preventDefault(); exec(cmd); }}
            className={`h-7 w-8 rounded text-sm hover:bg-gray-100 ${cls}`}
            title={label}
          >
            {label[0]}
          </button>
        ))}
        <button onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }} className="h-7 rounded px-2 text-sm hover:bg-gray-100" title="Bullet list">• List</button>
        <button onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }} className="h-7 rounded px-2 text-sm hover:bg-gray-100" title="Numbered list">1. List</button>
        <div className="mx-1 h-5 w-px bg-gray-200" />
        <span className="text-xs text-gray-400">Drag ⠿ to reorder</span>
      </div>

      {/* the document */}
      <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-6">
        {blocks.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-400">
            Empty proposal. Add a block below to start.
          </p>
        )}
        {blocks.map((b) => (
          <div
            key={b.id}
            onDragOver={(e) => { e.preventDefault(); setOverId(b.id); }}
            onDrop={() => drop(b.id)}
            className={`group relative flex gap-2 rounded-lg border p-2 ${overId === b.id && dragId != null ? "border-gray-900" : "border-transparent hover:border-gray-200"}`}
          >
            <span
              draggable
              onDragStart={() => setDragId(b.id)}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              className="mt-1 cursor-grab select-none px-1 text-gray-300 group-hover:text-gray-400"
              title="Drag to reorder"
            >
              ⠿
            </span>

            <div className="min-w-0 flex-1">
              {b.type === "heading" && (
                <RichText initial={b.html} placeholder="Heading" onInput={(html) => update(b.id, { html })} className="text-2xl font-semibold" />
              )}
              {b.type === "text" && (
                <RichText initial={b.html} placeholder="Write text…" onInput={(html) => update(b.id, { html })} className="text-sm leading-relaxed text-gray-700" />
              )}
              {b.type === "image" && (
                <div>
                  {b.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.url} alt={b.caption} className="max-h-80 w-full rounded object-contain" />
                  ) : (
                    <label className="flex h-32 cursor-pointer items-center justify-center rounded border border-dashed border-gray-300 text-sm text-gray-400 hover:bg-gray-50">
                      + Upload image
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadImage(b.id, e.target.files)} />
                    </label>
                  )}
                  <input
                    className="mt-1 w-full border-none text-center text-xs text-gray-500 outline-none"
                    placeholder="Caption (optional)"
                    value={b.caption}
                    onChange={(e) => update(b.id, { caption: e.target.value } as Partial<PBlock>)}
                  />
                </div>
              )}
            </div>

            <button
              onClick={() => remove(b.id)}
              className="absolute right-1 top-1 text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100"
              aria-label="Remove block"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* add-block bar */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => add("heading")} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">+ Heading</button>
        <button onClick={() => add("text")} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">+ Text</button>
        <button onClick={() => add("image")} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">+ Image</button>
      </div>
    </div>
  );
}
