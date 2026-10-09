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
  const stickyHeight = () => {
    const sticky =
      document.querySelector<HTMLElement>(".sc-freeze") ??
      document.querySelector<HTMLElement>(".sd-top") ??
      document.querySelector<HTMLElement>(".wz-top");
    return sticky ? sticky.getBoundingClientRect().height : 0;
  };
  const target = () => Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - stickyHeight() - gap));
  window.scrollTo({ top: target(), behavior: "smooth" });
  // 9 Oct 2026: a card that keeps growing while it opens (the size form, the
  // tiles) can cancel or outrun the smooth scroll, and the page stays where
  // the customer tapped — "Walk in robe added … it's open above" with only
  // its Confirm button on screen. Once it has settled, if the card's top is
  // not between the sticky stack and the middle of the screen, put it there.
  window.setTimeout(() => {
    if (!el.isConnected) return;
    const top = el.getBoundingClientRect().top;
    if (top < stickyHeight() || top > window.innerHeight / 2) window.scrollTo({ top: target(), behavior: "auto" });
  }, 700);
}

/** Run after the card has expanded (two frames — state commit, then layout). */
export function afterLayout(fn: () => void) {
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => requestAnimationFrame(fn));
}
