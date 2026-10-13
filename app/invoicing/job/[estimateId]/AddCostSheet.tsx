"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { COST_DOCS_BUCKET } from "@/lib/costs/store";
import { checkUpload } from "@/lib/uploads/validate";
import { recordJobCostAction, type InvoicingResult } from "../../actions";
import { fmt2 } from "../../format";

/**
 * Manual cost entry (§6.4) — the fourth door. Document REQUIRED: the file
 * stages through a signed upload URL (the remediated path), the server sniffs
 * the staged bytes, and only then does job_cost_record write the row — with
 * a confirmed intake row alongside so provenance and the duplicate guard see
 * this door too.
 */

const CATEGORIES: { key: string; label: string }[] = [
  // Payments merge Step 6: a paint-shop receipt is materials (§6.9) — first, the common case.
  { key: "materials", label: "Materials" },
  { key: "scaffold", label: "Scaffold" },
  { key: "render", label: "Render" },
  { key: "carpentry", label: "Carpentry" },
  { key: "rubbish", label: "Rubbish" },
  { key: "equipment_hire", label: "Equipment" },
  { key: "permit", label: "Permit" },
  { key: "traffic_mgmt", label: "Traffic" },
  { key: "other", label: "Other" },
];

export default function AddCostSheet({
  estimateId, woId, open, onClose,
}: {
  estimateId: string;
  woId: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [category, setCategory] = useState("other");
  const [description, setDescription] = useState("");
  const [totalDollars, setTotalDollars] = useState("");
  const [gstDollars, setGstDollars] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [paidWith, setPaidWith] = useState<"account" | "company_card" | "personal">("account");

  function onPickFile() {
    const file = fileRef.current?.files?.[0] ?? null;
    if (!file) { setFileName(null); return; }
    const problem = checkUpload(file, "document");
    if (problem) { setMessage(problem); setFileName(null); if (fileRef.current) fileRef.current.value = ""; return; }
    setMessage(null);
    setFileName(file.name);
  }

  function save() {
    const file = fileRef.current?.files?.[0] ?? null;
    if (!file) { setMessage("Attach the invoice or receipt — no document, no cost."); return; }
    const totalCents = Math.round(Number(totalDollars) * 100);
    const gstCents = Math.round(Number(gstDollars || "0") * 100);
    if (!(totalCents > 0) || gstCents < 0 || gstCents >= totalCents) {
      setMessage("Check the amounts — total inc GST, with GST no larger than the total.");
      return;
    }
    if (!vendorName.trim()) { setMessage("Who is this cost from?"); return; }

    start(async () => {
      // 1. sign → 2. PUT the bytes straight to storage → 3. record (server
      // sniffs the staged bytes before any row is written).
      const signRes = await fetch("/api/costs/doc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, size: file.size }),
      });
      const signed = (await signRes.json().catch(() => null)) as { path?: string; token?: string; error?: string } | null;
      if (!signRes.ok || !signed?.path || !signed.token) {
        setMessage(signed?.error ?? "Couldn't get the upload ready — try again.");
        return;
      }
      const supabase = createBrowserClient();
      const { error: upErr } = await supabase.storage
        .from(COST_DOCS_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (upErr) { setMessage("The upload didn't make it — try again."); return; }

      const r: InvoicingResult = await recordJobCostAction({
        estimateId, woId,
        vendorName: vendorName.trim(),
        category, description: description.trim(),
        amountExCents: totalCents - gstCents,
        gstCents,
        docPath: signed.path,
        paidWith,
        invoiceNo: invoiceNo.trim(),
      });
      setMessage(r.message ?? null);
      if (r.ok) { onClose(); router.refresh(); }
    });
  }

  // Payments merge Step 7: the job panel's sheet, in the Payments page's own
  // styles (payments.css — sheet-wrap / sheet / field / methods / b / cancel).
  if (!open) return null;
  return (
    <div className="sheet-wrap on" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label="Add a cost">
        <h3>Add a cost</h3>
        <div className="who">A supplier invoice or receipt for this job. The document is the record — it files with the cost.</div>
        {message && <div className="err" role="status" data-testid="add-cost-message">{message}</div>}

        <div className="field"><label htmlFor="acFile">Photo or PDF of it</label>
          <input id="acFile" ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
            onChange={onPickFile} data-testid="add-cost-file" />
          {fileName && <div className="hint mono">{fileName} ✓</div>}
        </div>
        <div className="field"><label htmlFor="acVendor">Who it is from</label>
          <input id="acVendor" type="text" placeholder="e.g. Dulux, SkyReach Hire" value={vendorName}
            onChange={(e) => setVendorName(e.target.value)} data-testid="add-cost-vendor" /></div>
        <div className="field"><label>What kind of cost</label>
          <div className="chipset">
            {CATEGORIES.map((c) => (
              <button key={c.key} type="button" className={category === c.key ? "on" : undefined} onClick={() => setCategory(c.key)}>{c.label}</button>
            ))}
          </div></div>
        <div className="field"><label htmlFor="acDesc">What was it?</label>
          <input id="acDesc" type="text" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="two">
          <div className="field"><label htmlFor="acTotal">Total inc GST ($)</label>
            <input id="acTotal" className="money" type="number" inputMode="decimal" min={0.01} step="0.01"
              value={totalDollars} data-testid="add-cost-total"
              onChange={(e) => {
                setTotalDollars(e.target.value);
                const t = Number(e.target.value);
                if (t > 0 && !gstDollars) setGstDollars((Math.round((t * 100) / 11) / 100).toFixed(2));
              }} /></div>
          <div className="field"><label htmlFor="acGst">GST ($)</label>
            <input id="acGst" className="money" type="number" inputMode="decimal" min={0} step="0.01" value={gstDollars} onChange={(e) => setGstDollars(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="acNo">Their invoice number</label>
          <input id="acNo" type="text" placeholder="Optional — catches duplicates" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
        <div className="field"><label>How was it paid?</label>
          <div className="methods">
            {([["account", "On account"], ["company_card", "Company card"], ["personal", "My own money"]] as const).map(([k, label]) => (
              <button key={k} type="button" className={paidWith === k ? "on" : undefined} onClick={() => setPaidWith(k)}>{label}</button>
            ))}
          </div></div>
        <button type="button" className="b pri wide" disabled={busy} onClick={save} data-testid="add-cost-save">
          {busy ? "Saving…" : `Record${Number(totalDollars) > 0 ? ` ${fmt2(Math.round(Number(totalDollars) * 100))}` : " cost"}`}
        </button>
        <button type="button" className="cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
