"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptAttr, checkUpload } from "@/lib/uploads/validate";

/**
 * Upload a plan, read it, look at what came back, put it in the builder.
 *
 * The order on screen is the order of the pipeline, and each step reports what
 * it did rather than spinning and then presenting a finished estimate. The
 * estimator is meant to see the assumptions before the numbers.
 */

type Page = { pageNo: number; pageClass: string; confidence: number; reasons: string[]; hasTextLayer: boolean };
type Flag = { level: string; code: string; room: string | null; message: string; blocking: boolean };
type ReadResult = {
  usable: boolean; rooms: number; dimensioned: number; undimensioned: number;
  areas: number; assumedValues: number; flags: Flag[]; costCents: number;
  skipped: Array<{ name: string; reason: string }>;
  deferred: Array<{ room: string; what: string; count: number; needs: string }>;
  ceilingHeightM: number | null;
};

export default function PlanReader() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [runIds, setRunIds] = useState<string[]>([]);
  const [reading, setReading] = useState<Record<string, ReadResult>>({});
  // Tom's rule: the height is asked for before publishing and applies to every
  // room. It is never assumed silently — the field starts EMPTY on purpose.
  const [height, setHeight] = useState<Record<string, string>>({});
  const [photoNote, setPhotoNote] = useState<Record<string, string>>({});
  const [listingUrl, setListingUrl] = useState("");
  const [listingNotes, setListingNotes] = useState<string[]>([]);

  async function upload(file: File) {
    const bad = checkUpload(file, file.type === "application/pdf" ? "document" : "image");
    if (bad) { setErr(bad); return; }
    setBusy("upload"); setErr(""); setPages([]); setRunIds([]); setReading({});
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/extract/floorplan?kind=floorplan", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed.");
      setPages(json.pages ?? []);
      setRunIds(json.runIds ?? []);
      if (json.floorplanPages === 0) {
        setErr("No page looked like a floor plan. You can still read it, but check the classification below first.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function read(runId: string) {
    setBusy(runId); setErr("");
    try {
      const res = await fetch(`/api/extract/${runId}/read`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "The read failed.");
      setReading((r) => ({ ...r, [runId]: json }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function addPhotos(runId: string, files: FileList) {
    setBusy(runId); setErr(""); setPhotoNote((p) => ({ ...p, [runId]: "" }));
    try {
      const body = new FormData();
      for (const f of Array.from(files).slice(0, 12)) {
        const bad = checkUpload(f, "image");
        if (bad) throw new Error(bad);
        body.append("file", f);
      }
      const res = await fetch(`/api/extract/${runId}/photos`, { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "The photos couldn't be read.");
      const got = [
        json.applied.doorStyle !== "unknown" ? `doors: ${json.applied.doorStyle}` : null,
        json.applied.windowStyle !== "unknown" ? `windows: ${json.applied.windowStyle.replace(/_/g, " ")}` : null,
        json.applied.cornice !== "unknown" ? `cornice: ${json.applied.cornice}` : null,
        json.applied.ceilingHeightM ? `ceiling about ${json.applied.ceilingHeightM} m` : null,
      ].filter(Boolean);
      setPhotoNote((p) => ({
        ...p,
        [runId]: `${json.photosRead} photo(s) read. ${got.length ? `Settled — ${got.join(", ")}.` : "Nothing could be settled confidently."}` +
          (json.stillUnknown.length ? ` Still unknown: ${json.stillUnknown.join(", ")}.` : ""),
      }));
      if (json.applied.ceilingHeightM && !height[runId]) {
        setHeight((h) => ({ ...h, [runId]: String(json.applied.ceilingHeightM) }));
      }
      await read(runId); // re-read the draft now the unknowns are settled
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function checkListing(runId: string) {
    if (!listingUrl.trim()) return;
    setBusy(runId); setErr("");
    try {
      const res = await fetch(`/api/extract/${runId}/listing`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: listingUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't read that listing.");
      setListingNotes(json.notes.length ? json.notes : ["Nothing on the listing disagrees with the plan."]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function apply(runId: string) {
    const h = Number(height[runId]);
    if (!Number.isFinite(h) || h < 2 || h > 6) {
      setErr("Enter the ceiling height first — it applies to every room and it multiplies every wall in the job.");
      return;
    }
    setBusy(runId); setErr("");
    try {
      const res = await fetch(`/api/extract/${runId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ceilingHeightM: h }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't apply the draft.");
      router.push(json.openAt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 rounded-xl bg-ink px-5 py-4 text-white">
        <h1 className="text-2xl font-semibold tracking-tight">Read a floorplan</h1>
        <p className="mt-1 text-sm text-gray-400">
          Upload a plan and it drafts the rooms and surfaces. You confirm the sizes it couldn&rsquo;t
          read, then it prices exactly like any other estimate.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{err}</div>}

      <label className="mb-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 p-10 text-center hover:bg-gray-50">
        <span className="text-sm font-medium">{busy === "upload" ? "Reading the file…" : "Choose a plan (PDF, JPG, PNG)"}</span>
        <span className="mt-1 text-xs text-gray-500">Up to 25 MB. A PDF exported from CAD reads far better than a photo of one.</span>
        <input
          type="file"
          accept={`application/pdf,${acceptAttr("image")}`}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        />
      </label>

      {pages.length > 0 && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
          <label className="text-sm font-medium" htmlFor="listing">Listing link (optional)</label>
          <p className="mt-0.5 text-xs text-gray-500">
            Cross-checks the bedroom and bathroom count, and flags anything the agent says about
            ceilings or cornices. It never sets a number — it is copy written to sell a house.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              id="listing" type="url" placeholder="https://www.realestate.com.au/property-..."
              value={listingUrl} onChange={(e) => setListingUrl(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            />
            <button
              onClick={() => runIds[0] && checkListing(runIds[0])}
              disabled={!listingUrl.trim() || !runIds[0]}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Check
            </button>
          </div>
          {listingNotes.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-gray-700">
              {listingNotes.map((n, k) => <li key={k}>{n}</li>)}
            </ul>
          )}
        </div>
      )}

      {pages.map((p, i) => {
        const runId = runIds[i];
        const r = runId ? reading[runId] : undefined;
        return (
          <div key={runId ?? i} className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">Page {p.pageNo}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                  p.pageClass === "floorplan_interior" ? "bg-emerald-100 text-emerald-900" : "bg-gray-200 text-gray-700"
                }`}>
                  {p.pageClass.replace(/_/g, " ")}
                </span>
                <span className="ml-2 text-xs text-gray-500">{Math.round(p.confidence * 100)}% sure</span>
              </div>
              <div className="flex gap-2">
                <a href={`/dev/extract/${runId}`} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50">
                  Inspect
                </a>
                {!r && (
                  <button
                    onClick={() => read(runId)}
                    disabled={busy === runId}
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    {busy === runId ? "Reading…" : "Read this page"}
                  </button>
                )}
              </div>
            </div>

            {!p.hasTextLayer && (
              <p className="mt-2 text-xs text-amber-800">
                No text layer — this is an image, so the dimensions have to be read off the picture.
                Expect it to be less accurate than a plan exported from CAD.
              </p>
            )}

            {r && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="flex flex-wrap gap-4 text-sm">
                  <span><b>{r.rooms}</b> rooms</span>
                  <span><b>{r.dimensioned}</b> dimensioned</span>
                  {r.undimensioned > 0 && <span className="text-amber-800"><b>{r.undimensioned}</b> without sizes</span>}
                  <span><b>{r.areas}</b> areas drafted</span>
                  {r.assumedValues > 0 && <span className="text-amber-800"><b>{r.assumedValues}</b> assumptions</span>}
                  <span className="text-gray-400">read cost {(r.costCents / 100).toFixed(2)}c</span>
                </div>

                {r.flags.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {[...r.flags].sort((a, b) => Number(b.blocking) - Number(a.blocking)).map((f, k) => (
                      <li key={k} className={`text-xs ${f.blocking ? "text-red-700" : "text-gray-600"}`}>
                        <span className="font-medium">{f.blocking ? "Must fix" : "Note"}</span>
                        {f.room ? ` · ${f.room}` : ""} — {f.message}
                      </li>
                    ))}
                  </ul>
                )}

                {r.skipped.length > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    Skipped: {r.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}
                  </p>
                )}

                {r.deferred?.length > 0 && (
                  <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3">
                    <div className="text-xs font-medium text-sky-900">
                      Seen, but not priced — add photos and these settle themselves
                    </div>
                    <ul className="mt-1 space-y-0.5 text-xs text-sky-900">
                      {r.deferred.slice(0, 8).map((d, k) => (
                        <li key={k}>{d.room} — {d.what}: {d.needs}</li>
                      ))}
                      {r.deferred.length > 8 && <li>…and {r.deferred.length - 8} more</li>}
                    </ul>
                    <label className="mt-2 inline-flex cursor-pointer items-center rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium">
                      Add property photos
                      <input
                        type="file" multiple accept={acceptAttr("image")} className="hidden"
                        onChange={(e) => { const f = e.target.files; if (f?.length) addPhotos(runId, f); }}
                      />
                    </label>
                    {photoNote[runId] && <p className="mt-2 text-xs text-sky-900">{photoNote[runId]}</p>}
                  </div>
                )}

                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <label className="text-xs font-medium text-amber-900" htmlFor={`h-${runId}`}>
                    Ceiling height (metres) — applies to every room
                  </label>
                  <p className="mt-0.5 text-xs text-amber-800">
                    {r.ceilingHeightM
                      ? `The plan prints ${r.ceilingHeightM} m. Confirm it.`
                      : "Not printed on the plan. This multiplies every wall in the job, so it has to come from you."}
                  </p>
                  <input
                    id={`h-${runId}`}
                    type="number" step="0.05" min="2" max="6" placeholder="e.g. 2.7"
                    value={height[runId] ?? ""}
                    onChange={(e) => setHeight((x) => ({ ...x, [runId]: e.target.value }))}
                    className="mt-1 w-32 rounded-md border border-amber-300 px-2 py-1 text-sm"
                  />
                </div>

                <button
                  onClick={() => apply(runId)}
                  disabled={busy === runId || !r.usable || r.areas === 0 || !height[runId]}
                  className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accentink hover:bg-paint disabled:opacity-50"
                >
                  {busy === runId ? "Building…" : `Draft an estimate from ${r.areas} rooms`}
                </button>
                {!r.usable && (
                  <p className="mt-2 text-xs text-red-700">
                    This plan can&rsquo;t be drafted from — there is nothing on it to measure with.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </main>
  );
}
