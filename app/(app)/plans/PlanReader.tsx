"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptAttr, checkUpload } from "@/lib/uploads/validate";

/**
 * Read a floorplan.
 *
 * Three boxes, all visible before anything runs, all taking MULTIPLES:
 *
 *   1. Floorplans   up to 5 files — listings often ship one image per storey.
 *                   Every file lands in the SAME estimate (apply appends).
 *   2. Photos       up to 12 — door style, window style, cornice: the three
 *                   things a plan cannot show, which decide the rate.
 *   3. Listing links up to 3 — cross-checks only; never sets a number.
 *
 * One press runs the lot, then ONE ceiling height and ONE draft button build a
 * single estimate from every readable page.
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

const MAX_PLANS = 5;
const MAX_PHOTOS = 12;
const MAX_LINKS = 3;

export default function PlanReader() {
  const router = useRouter();

  // ---- what the estimator has attached, before anything runs ---------------
  const [plans, setPlans] = useState<File[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [links, setLinks] = useState<string[]>([""]);

  // ---- what came back -------------------------------------------------------
  const [step, setStep] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [runIds, setRunIds] = useState<string[]>([]);
  const [reading, setReading] = useState<Record<string, ReadResult>>({});
  const [photoNote, setPhotoNote] = useState("");
  const [listingNotes, setListingNotes] = useState<string[]>([]);
  const [height, setHeight] = useState("");

  function addPlans(list: FileList) {
    const next: File[] = [];
    for (const f of Array.from(list)) {
      const bad = checkUpload(f, f.type === "application/pdf" ? "document" : "image");
      if (bad) { setErr(bad); return; }
      next.push(f);
    }
    setErr(""); setPlans((p) => [...p, ...next].slice(0, MAX_PLANS));
  }

  function addPhotos(list: FileList) {
    const next: File[] = [];
    for (const f of Array.from(list)) {
      const bad = checkUpload(f, "image");
      if (bad) { setErr(bad); return; }
      next.push(f);
    }
    setErr(""); setPhotos((p) => [...p, ...next].slice(0, MAX_PHOTOS));
  }

  const setLink = (i: number, v: string) => setLinks((l) => l.map((x, k) => (k === i ? v : x)));
  const realLinks = () => links.map((l) => l.trim()).filter(Boolean);

  /** Upload everything, read every floorplan page, fold photos in, check links. */
  async function run() {
    if (!plans.length) return;
    setBusy(true); setErr(""); setPages([]); setRunIds([]); setReading({});
    setPhotoNote(""); setListingNotes([]);

    try {
      setStep(plans.length === 1 ? "Uploading the plan…" : `Uploading ${plans.length} plan files…`);
      const body = new FormData();
      for (const f of plans) body.append("file", f);
      const upRes = await fetch("/api/extract/floorplan?kind=floorplan", { method: "POST", body });
      const up = await upRes.json();
      if (!upRes.ok) throw new Error(up.error ?? "The upload failed.");
      setPages(up.pages ?? []);
      setRunIds(up.runIds ?? []);

      const ids: string[] = up.runIds ?? [];
      const results: Record<string, ReadResult> = {};
      const readable = ids.filter((_, i) => up.pages?.[i]?.pageClass === "floorplan_interior");

      for (const [n, runId] of readable.entries()) {
        setStep(`Reading plan page ${n + 1} of ${readable.length}…`);
        const readRes = await fetch(`/api/extract/${runId}/read`, { method: "POST" });
        const read = await readRes.json();
        if (!readRes.ok) throw new Error(read.error ?? "The plan couldn't be read.");
        results[runId] = read;

        // Photos answer questions about the PROPERTY, so their findings are
        // folded into every readable page — each storey's doors get a style.
        if (photos.length) {
          setStep(`Applying ${photos.length} photo${photos.length === 1 ? "" : "s"} to page ${n + 1}…`);
          const pBody = new FormData();
          for (const f of photos) pBody.append("file", f);
          const pRes = await fetch(`/api/extract/${runId}/photos`, { method: "POST", body: pBody });
          const p = await pRes.json();
          if (pRes.ok) {
            if (n === 0) {
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
              if (p.applied.ceilingHeightM && !height) setHeight(String(p.applied.ceilingHeightM));
            }
            const again = await fetch(`/api/extract/${runId}/read`, { method: "POST" });
            const a = await again.json();
            if (again.ok) results[runId] = a;
          } else if (n === 0) {
            setPhotoNote(`The photos couldn't be read: ${p.error}`);
          }
        }
      }

      // Listing links: checked once, against the first readable page.
      const notes: string[] = [];
      for (const url of realLinks().slice(0, MAX_LINKS)) {
        if (!readable[0]) break;
        setStep(`Checking ${new URL(url).hostname.replace(/^www\./, "")}…`);
        const lRes = await fetch(`/api/extract/${readable[0]}/listing`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const l = await lRes.json();
        if (lRes.ok) {
          const from = l.source ? ` (${l.source})` : "";
          notes.push(...(l.notes?.length ? l.notes.map((x: string) => x + from) : [`Nothing on the listing disagrees with the plan${from}.`]));
        } else {
          notes.push(l.error);
        }
      }
      setListingNotes(notes);

      setReading(results);
      if (readable.length === 0) {
        setErr("No page looked like a floor plan. Check the classifications below.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); setStep("");
    }
  }

  const readableRuns = runIds.filter((id) => reading[id]?.usable && reading[id]?.areas > 0);
  const totalRooms = readableRuns.reduce((n, id) => n + reading[id].areas, 0);

  /** ONE estimate from every readable page: the first apply creates it, the rest append. */
  async function draft() {
    const h = Number(height);
    if (!Number.isFinite(h) || h < 2 || h > 6) {
      setErr("Enter the ceiling height first — it applies to every room and multiplies every wall in the job.");
      return;
    }
    setBusy(true); setErr("");
    try {
      let estimateId: string | null = null;
      let openAt = "";
      for (const [n, runId] of readableRuns.entries()) {
        setStep(readableRuns.length > 1 ? `Building the estimate — page ${n + 1} of ${readableRuns.length}…` : "Building the estimate…");
        const payload: { ceilingHeightM: number; estimateId?: string } = { ceilingHeightM: h };
        if (estimateId) payload.estimateId = estimateId;
        const res: Response = await fetch(`/api/extract/${runId}/apply`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json: { error?: string; estimateId: string; openAt: string } = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Couldn't build the estimate.");
        estimateId = json.estimateId;
        openAt = json.openAt;
      }
      if (openAt) router.push(openAt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false); setStep("");
    }
  }

  const box = "rounded-lg border border-gray-200 bg-white p-4";
  const fileList = (files: File[], remove: (i: number) => void) => (
    <ul className="mt-2 space-y-1">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-xs text-gray-600">
          <span className="truncate">{f.name}</span>
          <button onClick={() => remove(i)} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${f.name}`}>×</button>
        </li>
      ))}
    </ul>
  );

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
        {/* ---- 1. the plans --------------------------------------------------- */}
        <div className={box}>
          <div className="text-sm font-medium">1. Floorplan <span className="text-red-500">*</span></div>
          <p className="mt-1 text-xs text-gray-500">
            PDF, JPG or PNG — up to {MAX_PLANS} files. A plan split across images (one per storey)
            all goes into the <b>same</b> estimate.
          </p>
          <label className="mt-3 flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-gray-300 p-4 text-center text-xs hover:bg-gray-50">
            {plans.length ? `Add another (${plans.length}/${MAX_PLANS})` : "Choose plan file(s)"}
            <input
              type="file" multiple className="hidden" accept={`application/pdf,${acceptAttr("image")}`}
              onChange={(e) => { const f = e.target.files; if (f?.length) addPlans(f); e.target.value = ""; }}
            />
          </label>
          {fileList(plans, (i) => setPlans((p) => p.filter((_, k) => k !== i)))}
        </div>

        {/* ---- 2. photos ------------------------------------------------------ */}
        <div className={box}>
          <div className="text-sm font-medium">2. Property photos</div>
          <p className="mt-1 text-xs text-gray-500">
            Up to {MAX_PHOTOS}. Door and window types, and whether there are cornices. Without
            these, doors and windows aren&rsquo;t priced at all — a guessed type is the wrong rate
            on every one.
          </p>
          <label className="mt-3 flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-gray-300 p-4 text-center text-xs hover:bg-gray-50">
            {photos.length ? `Add another (${photos.length}/${MAX_PHOTOS})` : "Add photos"}
            <input
              type="file" multiple className="hidden" accept={acceptAttr("image")}
              onChange={(e) => { const f = e.target.files; if (f?.length) addPhotos(f); e.target.value = ""; }}
            />
          </label>
          {fileList(photos, (i) => setPhotos((p) => p.filter((_, k) => k !== i)))}
        </div>

        {/* ---- 3. the listings ------------------------------------------------- */}
        <div className={box}>
          <div className="text-sm font-medium">3. Listing links</div>
          <p className="mt-1 text-xs text-gray-500">
            Up to {MAX_LINKS}. Cross-checks the bed and bath counts and flags what the agent says
            about ceilings. Questions only — it never sets a number.
          </p>
          <div className="mt-3 space-y-2">
            {links.map((l, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="url" placeholder="https://www.realestate.com.au/…"
                  value={l} onChange={(e) => setLink(i, e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                />
                {links.length > 1 && (
                  <button onClick={() => setLinks((x) => x.filter((_, k) => k !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove link">×</button>
                )}
              </div>
            ))}
          </div>
          {links.length < MAX_LINKS && (
            <button onClick={() => setLinks((l) => [...l, ""])} className="mt-2 text-xs font-medium text-gray-600 hover:text-gray-900">
              + Add another link
            </button>
          )}
        </div>
      </div>

      <button
        onClick={run}
        disabled={!plans.length || busy}
        className="mt-4 rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {busy ? (step || "Working…") : plans.length > 1 ? `Read ${plans.length} plan files` : "Read the plan"}
      </button>
      {busy && <p className="mt-2 text-xs text-gray-500">{step}</p>}

      {photoNote && (
        <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">{photoNote}</div>
      )}
      {listingNotes.length > 0 && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs font-medium text-gray-700">From the listing{realLinks().length > 1 ? "s" : ""}</div>
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
                <span className="font-medium">Page {i + 1}</span>
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

                {!r.usable && (
                  <p className="mt-2 text-xs text-red-700">
                    This page can&rsquo;t be drafted from — there is nothing on it to measure with.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {readableRuns.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <label className="text-xs font-medium text-amber-900" htmlFor="height">
              Ceiling height (metres) — applies to every room{readableRuns.length > 1 ? ", on every page" : ""}
            </label>
            <p className="mt-0.5 text-xs text-amber-800">
              {height
                ? "Suggested from the plan or a photo. Confirm or change it."
                : "Not on the plan. It multiplies every wall in the job, so it has to come from you."}
            </p>
            <input
              id="height" type="number" step="0.05" min="2" max="6" placeholder="e.g. 2.7"
              value={height} onChange={(e) => setHeight(e.target.value)}
              className="mt-1 w-32 rounded-md border border-amber-300 px-2 py-1 text-sm"
            />
          </div>
          <button
            onClick={draft}
            disabled={busy || !height}
            className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accentink hover:bg-paint disabled:opacity-50"
          >
            {busy ? (step || "Building…") : `Draft ONE estimate from ${totalRooms} rooms${readableRuns.length > 1 ? ` across ${readableRuns.length} pages` : ""}`}
          </button>
        </div>
      )}
    </main>
  );
}
