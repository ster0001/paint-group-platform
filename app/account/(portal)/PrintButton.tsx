"use client";

/** Print = the PDF (the /i Toolbar pattern): the portal's print stylesheet
 * produces the white document, and the browser's dialog saves it as PDF. */
export default function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
      {label}
    </button>
  );
}
