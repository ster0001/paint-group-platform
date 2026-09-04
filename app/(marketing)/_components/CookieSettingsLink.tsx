"use client";

import { OPEN_EVENT } from "./ConsentSheet";

/** Footer link that reopens the consent sheet (Tom's spec). */
export default function CookieSettingsLink() {
  return (
    <a href="#cookies" data-testid="cookie-settings" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new Event(OPEN_EVENT)); }}>
      Cookie settings
    </a>
  );
}
