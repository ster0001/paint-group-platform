"use client";

import { useEffect, useRef } from "react";

// Lightweight rich-text editor (contentEditable). Stores HTML.
// Uncontrolled DOM synced from `value` only when it differs, so typing never
// jumps the caret, but applying a template / loading saved content updates it.
export default function RichTextEditor({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== (value ?? "")) el.innerHTML = value ?? "";
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    // Treat a lone <br> or whitespace as empty so the placeholder shows.
    const html = el.innerHTML === "<br>" ? "" : el.innerHTML;
    el.classList.toggle("is-empty", el.textContent?.trim() === "" && !el.querySelector("li"));
    onChange(html);
  };
  const exec = (cmd: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false);
    emit();
  };
  const btn = "rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200";

  return (
    <div className="rounded-md border border-gray-300 focus-within:border-gray-500">
      <div className="flex items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-1.5 py-1">
        <button type="button" className={btn} title="Bold" onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}><b>B</b></button>
        <button type="button" className={btn} title="Italic" onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}><i>I</i></button>
        <button type="button" className={btn} title="Underline" onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}><u>U</u></button>
        <span className="mx-1 h-4 w-px bg-gray-300" />
        <button type="button" className={btn} title="Bulleted list" onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}>• List</button>
        <button type="button" className={btn} title="Numbered list" onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}>1. List</button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emit}
        className="rte min-h-[84px] px-3 py-2 text-sm focus:outline-none"
      />
    </div>
  );
}
