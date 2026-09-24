"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSurfacePhotosOptionalAction } from "@/app/components/wo/tickAction";

/**
 * "Photos not required" on one line of the scope (Tom, 24 Sep 2026), for the
 * static Scope & ticks card the office sees before the job is under way (the
 * live TickList carries the same control while it is). A fuel allowance or a
 * set-up line is not a surface — the painter should not be asked to
 * photograph it. Staff only; the RPC refuses anyone else.
 */
export default function PhotosOptionalToggle({ surfaceId, label, optional }: {
  surfaceId: string; label: string; optional: boolean;
}) {
  const router = useRouter();
  const [isOptional, setIsOptional] = useState(optional);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button type="button" className="btn dim" style={{ fontSize: 10.5, padding: "2px 7px" }}
        disabled={pending} data-testid={`photos-optional-${surfaceId}`}
        title={isOptional ? `Ask for photos on ${label} again` : `Don't ask the painter for photos of ${label}`}
        onClick={() => startTransition(async () => {
          setMessage(null);
          const r = await setSurfacePhotosOptionalAction({ surfaceId, optional: !isOptional });
          if (r.ok) { setIsOptional(r.optional); router.refresh(); } else setMessage(r.message);
        })}>
        {pending ? "…" : isOptional ? "Photos required again" : "Photos not required"}
      </button>
      {message && <span className="note" style={{ color: "var(--amber)" }}>{message}</span>}
    </span>
  );
}
