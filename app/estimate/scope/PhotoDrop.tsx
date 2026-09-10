"use client";

import type { ReactNode, RefObject } from "react";

/**
 * The add-a-photo control.
 *
 * ⚑ Tom, 10 Sep: "need to make the box to add a photo clearer than it is
 * currently — it is just pre written text to be clicked."
 *
 * He is describing exactly what it was: a dashed pill with a paperclip and a
 * sentence, which reads as a caption rather than a thing you press. In the room
 * spots it was worse — a bare `<input type="file">`, styled by the browser.
 *
 * A photo is the single most useful thing a customer can give us (it is what
 * turns "some flaking" into a priced repair rather than an estimator's visit),
 * so the control should look like an invitation and not like fine print. One
 * component, used in both places, so they cannot drift apart again.
 */
export default function PhotoDrop({
  inputRef, testId, accept = "image/*", multiple = false, title, hint, ready, disabled = false, onFiles,
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
  testId: string;
  accept?: string;
  multiple?: boolean;
  /** The invitation — what tapping this does. */
  title: string;
  /** Why it is worth doing. Kept short; it sits under the title. */
  hint: string;
  /** Replaces the invitation once something has been chosen. */
  ready?: string | null;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  return (
    <label className={`sc-photodrop ${ready ? "ready" : ""} ${disabled ? "off" : ""}`} data-testid={`${testId}-label`}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        // capture="environment" opens the CAMERA on a phone rather than the
        // file browser — on site that is the difference between one tap and
        // four, and it falls back to the picker everywhere else.
        capture="environment"
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.currentTarget.value = ""; }}
      />
      <span className="sc-photodrop-icon" aria-hidden="true">{ready ? "✓" : "📷"}</span>
      <span className="sc-photodrop-text">
        <b>{ready ?? title}</b>
        {!ready && <span>{hint}</span>}
      </span>
    </label>
  );
}

/** The wrapper the two callers share, so the control always sits the same way. */
export function PhotoDropRow({ children }: { children: ReactNode }) {
  return <div className="sc-photodrop-row">{children}</div>;
}
