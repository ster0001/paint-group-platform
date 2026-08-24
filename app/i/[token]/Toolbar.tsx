"use client";

/** The one interactive control on the customer invoice: print (the browser's
 *  own dialog — the print stylesheet produces the white A4 document). */
export default function Toolbar() {
  return (
    <button className="primary" onClick={() => window.print()}>
      Print
    </button>
  );
}
