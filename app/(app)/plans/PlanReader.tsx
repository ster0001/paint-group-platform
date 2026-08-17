"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptAttr, checkUpload } from "@/lib/uploads/validate";

/**
 * Read a floorplan.
 *
 * THE SCREEN ASKS FOR EVERYTHING UP FRONT. An earlier version only offered
 * photos after a read had already found something uncertain, and only offered
 * the listing box after the plan had uploaded — so the two inputs that make the
 * result accurate were effectively hidden. All three attachments are now on the
 * page before anything happens, and the pipeline runs in one go.
 *
 * What each one is actually for:
 *   the plan     rooms, names, dimensions, door and window COUNTS
 *   photos       door style, window style, cornice — the three things a plan
 *                physically cannot show, and which decide the rate
 *   the listing  a cross-check on bed/bath counts, and anything the agent says
 *                about ceilings. Questions only; never a number.
 */

type Page = { pageNo: number; pageClass: string; confidence: number; hasTextLayer: boolean };
type Flag = { code: string; room: string | null; message: string; blocking: boolean };
type ReadResult = {
  usable: boolean; rooms: number; dimensioned: number; undimensioned: number;
  areas: number; assumedValues: number; flags: Flag[]; costCents: number;
  skipped: Array<{ name: string; reason: string }>;
  deferred: Array<{ room: string; what: string; count: number; needs: string }>;
  ceilingHeightM: number | null;
};

export default function PlanReader() {
  const router = useRouter();

  // ---- what the estimator has attached, before anything runs ---------------
  const [plan, setPlan] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [listingUrl, setListingUrl] = useState("");

  // ---- what came back -------------------------------------------------------
  const [step, setStep] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [runIds, setRunIds] = useState<string[]>([]);
  const [reading, setReading] = useState<Record<string, ReadResult>>({});
  const [photoNote, setPhotoNote] = useState("");
  const [listingNotes, setListingNotes] = useState<string[]>([]);
  const [height, setHeight] = useState<Record<string, string>>({});

  function choosePlan(f: File) {
    const bad = checkUpload(f, f.type === "application/pdf" ? "document" : "image");
    if (bad) { setErr(bad); return; }
    setErr(""); setPlan(f);
  }

  function choosePhotos(list: FileList) {
    const next: File[] = [];
    for (const f of Array.from(list).slice(0, 12)) {
      const bad = checkUpload(f, "image");
      if (bad) { setErr(bad); return; }
      next.push(f);
    }
    setErr(""); setPhotos((p) => [...p, ...next].slice(0, 12));
  }

  /** Upload, read, apply the photos, cross-check the listing — one press. */
  async function run() {
    if (!plan) return;
    setBusy(true); setErr(""); setPages([]); setRunIds([]); setReading({});
    setPhotoNote(""); setListingNotes([]);

    try {
      setStep("Uploading the plan…");
      const body = new FormData();
      body.append("file", plan);
      const upRes = await fetch("/api/extract/floorplan?kind=floorplan", { method: "POST", body });
      const up = await upRes.json();
      if (!upRes.ok) throw new Error(up.error ?? "The upload failed.");
      setPages(up.pages ?? []);
      setRunIds(up.runIds ?? []);

      const ids: string[] = up.runIds ?? [];
      const results: Record<string, ReadResult> = {};

      for (const [i, runId] of ids.entries()) {
        // Only the pages that look like floor plans are worth a model call.
        if (up.pages?.[i]?.pageClass !== "floorplan_interior") continue;

        setStep(`Reading page ${up.pages[i].pageNo}…`);
        const readRes = await fetch(`/api/extract/${runId}/read`, { method: "POST" });
        const read = await readRes.json();
        if (!readRes.ok) throw new Error(read.error ?? "The plan couldn't be read.");
        results[runId] = read;

        // Photos go in against the FIRST readable page: they answer questions
        // about the property, not about a particular sheet of paper.
        if (photos.length && Object.keys(results).length === 1) {
          setStep(`Reading ${photos.length} photo${photos.length === 1 ? "" : "s"}…`);
          const pBody = new FormData();
          for (const f of photos) pBody.append("file", f);
          const pRes = await fetch(`/api/extract/${runId}/photos`, { method: "POST", body: pBody });
          const p = await pRes.json();
          if (pRes.ok) {
            const settled = [
              p.applied.doorStyle !== "unknown" ? `doors are ${p.applied.doorStyle}` : null,
              p.applied.windowStyle !== "unknown" ? `windows are ${String(p.applied.windowStyle).replace(/_/g, " ")}` : null,
              p.applied.cornice === "present" ? "there is a cornice" : p.applied.cornice === "absent" ? "no cornice" : null,
              p.applied.ceilingHeightM ? `ceiling about ${p.applied.ceilingHeightM} m` : null,
            ].filter(Boolean);
            setPhotoNote(
              `${p.photosRead} photo${p.photosRead === 1 ? "" : "s"} read. ` +
              (settled.length ? `Settled: ${settled.join(", ")}.` : "Nothing could be settled confidently — the answers stay open.") +
              (p.stillUnknown?.length ? ` Still open: ${p.stillUnknown.join(", ")}.` : ""),
            );
            if (p.applied.ceilingHeightM) setHeight((h) => ({ ...h, [runId]: String(p.applied.ceilingHeightM) }));

            // Re-read the draft now the unknowns are settled, so the counts on
            // screen match what would actually be generated.
            const again = await fetch(`/api/extract/${runId}/read`, { method: "POST" });
            const a = await again.json();
            if (again.ok) results[runId] = a;
          } else {
            setPhotoNote(`The photos couldn't be read: ${p.error}`);
          }
        }

        if (listingUrl.trim() && Object.keys(results).length === 1) {
          setStep("Checking the listing…");
          const lRes = await fetch(`/api/extract/${runId}/listing`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: listingUrl.trim() }),
          });
          const l = await lRes.json();
          setListingNotes(lRes.ok
            ? (l.notes?.length ? l.notes : ["Nothing on the listing disagrees with the plan."])
            : [l.error]);
        }
      }

      setReading(results);
      if (Object.keys(results).length === 0) {
        setErr("No page on that file looked like a floor plan. Check the classification below.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); setStep("");
    }
  }

  async function draft(runId: string) {
    const h = Number(height[runId]);
    if (!Number.isFinite(h) || h < 2 || h > 6) {
      setErr("Enter the ceiling height first — it applies to every room and multiplies every wall in the job.");
      return;
    }
    setBusy(true); setErr(""); setStep("Building the estimate…");
    try {
      const res = await fetch(`/api/extract/${runId}/apply`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ceilingHeightM: h }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't build the estimate.");
      router.push(json.openAt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false); setStep("");
    }
  }

  const box = "rounded-lg border border-gray-200 bg-white p-4";

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 rounded-xl bg-ink px-5 py-4 text-white">
        <h1 className="text-2xl font-semibold tracking-tight">Read a floorplan</h1>
        <p className="mt-1 text-sm text-gray-400">
          The plan gives the rooms and their sizes. Photos tell it the door and window types and
          whether there are cornices — none of which a plan can show. Add what you have.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{err}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        {/* ---- 1. the plan ---------------------------------------------------- */}
        <div className={box}>
          <div className="text-sm font-medium">1. Floorplan <span className="text-red-500">*</span></div>
          <p className="mt-1 text-xs text-gray-500">PDF, JPG or PNG. A PDF exported from CAD reads best.</p>
          <label className="mt-3 flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-gray-300 p-4 text-center text-xs hover:bg-gray-50">
            {plan ? <span className="font-medium">{plan.name}</span> : "Choose a plan"}
            <input
              type="file" className="hidden" accept={`application/pdf,${acceptAttr("image")}`}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) choosePlan(f); }}
            />
          </label>
        </div>

        {/* ---- 2. photos ------------------------------------------------------ */}
        <div className={box}>
          <div className="text-sm font-medium">2. Property photos</div>
          <p className="mt-1 text-xs text-gray-500">
            Door and window types, and whether there are cornices. Without these, doors and windows
            aren&rsquo;t priced at all — a guessed type is the wrong rate on every one.
          </p>
          <label className="mt-3 flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-gray-300 p-4 text-center text-xs hover:bg-gray-50">
            {photos.length ? <span className="font-medium">{photos.length} photo{photos.length === 1 ? "" : "s"} ready</span> : "Add photos"}
            <input
              type="file" multiple className="hidden" accept={acceptAttr("image")}
              onChange={(e) => { const f = e.target.files; if (f?.length) choosePhotos(f); }}
            />
          </label>
          {photos.length > 0 && (
            <button onClick={() => setPhotos([])} className="mt-2 text-xs text-gray-400 hover:text-red-600">
              Clear
            </button>
          )}
        </div>

        {/* ---- 3. the listing -------------------------------------------------- */}
        <div className={box}>
          <div className="text-sm font-medium">3. Listing link</div>
          <p className="mt-1 text-xs text-gray-500">
            Cross-checks the bed and bath counts and flags what the agent says about ceilings.
            Questions only — it never sets a number.
          </p>
          <input
            type="url" placeholder="https://www.realestate.com.au/…"
            value={listingUrl} onChange={(e) => setListingUrl(e.target.value)}
            className="mt-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
          />
        </div>
      </div>

      <button
        onClick={run}
        disabled={!plan || busy}
        className="mt-4 rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {busy ? (step || "Working…") : "Read the plan"}
      </button>
      {busy && <p className="mt-2 text-xs text-gray-500">{step}</p>}

      {photoNote && (
        <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">{photoNote}</div>
      )}
      {listingNotes.length > 0 && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs font-medium text-gray-700">From the listing</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-gray-700">
            {listingNotes.map((n, k) => <li key={k}>{n}</li>)}
          </ul>
        </div>
      )}

      {pages.map((p, i) => {
        const runId = runIds[i];
        const r = runId ? reading[runId] : undefined;
        return (
          <div key={runId ?? i} className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">Page {p.pageNo}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                  p.pageClass === "floorplan_interior" ? "bg-emerald-100 text-emerald-900" : "bg-gray-200 text-gray-700"
                }`}>
                  {p.pageClass.replace(/_/g, " ")}
                </span>
                {!p.hasTextLayer && <span className="ml-2 text-xs text-amber-800">image — dimensions read off the picture</span>}
              </div>
              <a href={`/dev/extract/${runId}`} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50">
                Inspect
              </a>
            </div>

            {r && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="flex flex-wrap gap-4 text-sm">
                  <span><b>{r.rooms}</b> rooms</span>
                  <span><b>{r.dimensioned}</b> with sizes</span>
                  {r.undimensioned > 0 && <span className="text-amber-800"><b>{r.undimensioned}</b> without</span>}
                  <span><b>{r.areas}</b> areas drafted</span>
                  <span className="text-gray-400">{r.costCents}c</span>
                </div>

                {r.deferred?.length > 0 && (
                  <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3">
                    <div className="text-xs font-medium text-sky-900">
                      Seen, but not priced — {photos.length ? "the photos couldn't settle these" : "add photos above and these settle themselves"}
                    </div>
                    <ul className="mt-1 space-y-0.5 text-xs text-sky-900">
                      {r.deferred.slice(0, 8).map((d, k) => <li key={k}>{d.room} — {d.what}: {d.needs}</li>)}
                      {r.deferred.length > 8 && <li>…and {r.deferred.length - 8} more</li>}
                    </ul>
                  </div>
                )}

                {r.flags.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {[...r.flags].sort((a, b) => Number(b.blocking) - Number(a.blocking)).slice(0, 10).map((f, k) => (
                      <li key={k} className={`text-xs ${f.blocking ? "text-red-700" : "text-gray-600"}`}>
                        <span className="font-medium">{f.blocking ? "Must fix" : "Note"}</span>
                        {f.room ? ` · ${f.room}` : ""} — {f.message}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <label className="text-xs font-medium text-amber-900" htmlFor={`h-${runId}`}>
                    Ceiling height (metres) — applies to every room
                  </label>
                  <p className="mt-0.5 text-xs text-amber-800">
                    {r.ceilingHeightM
                      ? `The plan prints ${r.ceilingHeightM} m. Confirm it.`
                      : height[runId]
                        ? "Suggested from a photo. Confirm or change it."
                        : "Not on the plan. It multiplies every wall in the job, so it has to come from you."}
                  </p>
                  <input
                    id={`h-${runId}`} type="number" step="0.05" min="2" max="6" placeholder="e.g. 2.7"
                    value={height[runId] ?? ""}
                    onChange={(e) => setHeight((x) => ({ ...x, [runId]: e.target.value }))}
                    className="mt-1 w-32 rounded-md border border-amber-300 px-2 py-1 text-sm"
                  />
                </div>

                <button
                  onClick={() => draft(runId)}
                  disabled={busy || !r.usable || r.areas === 0 || !height[runId]}
                  className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accentink hover:bg-paint disabled:opacity-50"
                >
                  Draft an estimate from {r.areas} rooms
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
