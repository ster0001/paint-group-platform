"use client";

/** Print = the PDF (the /i Toolbar pattern): the portal's print stylesheet
 * produces the white document, and the browser's dialog saves it as PDF.
 * `small` renders the inline secondary button (the colours action row, E4). */
export default function PrintButton({ label, small = false }: { label: string; small?: boolean }) {
  return (
    <button type="button" className={`btn btn-ghost${small ? " sm" : ""}`} onClick={() => window.print()}>
      {label}
    </button>
  );
}
