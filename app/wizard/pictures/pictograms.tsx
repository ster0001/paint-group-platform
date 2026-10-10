/**
 * Pictograms for the option cards (UI refresh S2, brief §7.2: "pictures for
 * trade words") — the mockup's `PIC` set, as inline SVG. Keyed
 * `<question>-<answer>` so a card asks for exactly its own picture; an
 * unknown key draws nothing. Decorative: `aria-hidden`, the words carry it.
 */
const D: Record<string, string> = {
  "jobtype-interior": '<path d="M6 42V10h36v32"/><path d="M6 42h36"/><rect x="14" y="20" width="9" height="22"/><rect x="29" y="18" width="9" height="10"/>',
  "jobtype-exterior": '<path d="M5 24L24 8l19 16"/><path d="M10 21v20h28V21"/><rect x="20" y="29" width="8" height="12"/>',
  "jobtype-both": '<path d="M5 24L24 8l19 16"/><path d="M10 21v20h28V21"/><path d="M10 31h28M24 21v20"/>',
  "kind-house": '<path d="M5 24L24 8l19 16"/><path d="M10 21v20h28V21"/><rect x="20" y="29" width="8" height="12"/>',
  "kind-townhouse": '<path d="M4 41V20l10-8 10 8v21"/><path d="M24 41V20l10-8 10 8v21"/><path d="M2 41h44"/><path d="M11 41v-8h6v8M31 41v-8h6v8"/>',
  "kind-unit_apartment": '<rect x="11" y="6" width="26" height="36"/><path d="M17 13h4M27 13h4M17 21h4M27 21h4M17 29h4M27 29h4M21 42v-6h6v6"/>',
  "kind-commercial": '<path d="M6 42V18h36v24M4 42h40"/><path d="M6 18l4-9h28l4 9"/><rect x="12" y="25" width="12" height="10"/><path d="M30 42V25h7v17"/>',
  "storeys-single": '<path d="M5 30L24 16l19 14"/><path d="M10 28v13h28V28"/>',
  "storeys-double": '<path d="M5 20L24 6l19 14"/><path d="M10 18v23h28V18M10 30h28"/>',
  "condition-good": '<rect x="8" y="8" width="32" height="32" rx="3"/><path d="M17 25l5 5 10-11"/>',
  "condition-wear": '<rect x="8" y="8" width="32" height="32" rx="3"/><path d="M14 30q5-4 9 0M28 16l-3 7 4 4"/><circle cx="33" cy="33" r="1.2"/>',
  "condition-needs_work": '<rect x="8" y="8" width="32" height="32" rx="3"/><path d="M30 8l-5 10 5 6-6 8 3 8"/><path d="M12 14q8 6 2 12"/>',
  "occupied-no": '<path d="M6 42V10h36v32M6 42h36"/><path d="M6 34h36" stroke-dasharray="3 4"/>',
  "occupied-yes": '<path d="M6 42V10h36v32M6 42h36"/><rect x="13" y="28" width="22" height="9" rx="3"/><path d="M16 28v-5h16v5"/>',
};

// UI refresh S5: the Outside step's storeys cards use the same two drawings.
D["ext-storeys-single"] = D["storeys-single"];
D["ext-storeys-double"] = D["storeys-double"];

export function Pic({ name }: { name: string }) {
  const d = D[name];
  if (!d) return null;
  // The paths are our own constants above — never customer text — so inlining them is safe.
  return <svg className="wz-pic-icon" viewBox="0 0 48 48" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;
}
