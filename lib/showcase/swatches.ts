/**
 * §4.4c block 5 — the swatch beside a colour row. A small brand lookup;
 * an unknown colour renders as a neutral chip. Keys are lower-cased
 * "brand|colour". Extend as jobs name new colours.
 */
const SWATCHES: Record<string, string> = {
  "dulux|natural white": "#F2EFE6",
  "dulux|vivid white": "#F7F7F5",
  "dulux|lexicon": "#EDECE6",
  "dulux|lexicon quarter": "#F3F2EE",
  "dulux|whisper white": "#F1EDE3",
  "dulux|antique white usa": "#EAE2CF",
  "dulux|white on white": "#F1F0EA",
  "dulux|monument": "#3E4144",
  "dulux|surfmist": "#E4E2D8",
  "dulux|domino": "#3B3B3F",
  "dulux|grey pail": "#C9C7BE",
  "dulux|tranquil retreat": "#D1CFC4",
  "dulux|snowy mountains half": "#EFEEE7",
  "dulux|black": "#111111",
  "haymes|greyology 1": "#E3E1DA",
  "haymes|minimalist 1": "#EDEBE4",
  "haymes|white on white": "#F2F1EC",
  "haymes|soft white": "#F0ECE2",
  "colorbond|monument": "#3E4144",
  "colorbond|surfmist": "#E4E2D8",
  "colorbond|woodland grey": "#4E4F4A",
  "colorbond|shale grey": "#BDBDB4",
};

export function swatchHex(brand: string, colour: string): string | null {
  return SWATCHES[`${brand.trim().toLowerCase()}|${colour.trim().toLowerCase()}`] ?? null;
}
