/**
 * Scroll a confirm-loop card so its HEADER — the room / side name and the
 * rename box — sits just under whatever sticky stack is above it.
 *
 * `scrollIntoView({ block: "center" })` centred the card, and an OPEN card
 * (size panel + tiles + cupboard questions + confirm button) is taller than
 * a phone screen, so centring pushed the name above the top of the viewport
 * and behind the sticky score header. The sticky stack's height differs by
 * viewport and job type, so it is measured, not written down.
 */
export function scrollCardToTop(el: Element | null | undefined, gap = 10) {
  if (!el || typeof window === "undefined") return;
  const sticky =
    document.querySelector<HTMLElement>(".sc-freeze") ??
    document.querySelector<HTMLElement>(".sd-top") ??
    document.querySelector<HTMLElement>(".wz-top");
  const stickyH = sticky ? sticky.getBoundingClientRect().height : 0;
  const top = el.getBoundingClientRect().top + window.scrollY - stickyH - gap;
  window.scrollTo({ top: Math.max(0, Math.round(top)), behavior: "smooth" });
}

/** Run after the card has expanded (two frames — state commit, then layout). */
export function afterLayout(fn: () => void) {
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => requestAnimationFrame(fn));
}
