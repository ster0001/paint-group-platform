"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addMaterialCostAction, updateJobCostAction, updateMaterialCostAction } from "../actions";
import type { PanelJobCost, PanelOrder } from "./panelData";
import { centsOf, dollarsText, gstOnExCents } from "@/lib/invoicing/moneyInput";

/**
 * Tom, 22 Oct 2026: costs on the job panel are editable in place — tap Edit on a supplier
 * invoice to fix its label (supplier) or price, or move it to a different order; tap Edit
 * on a recorded cost to fix its label, category or amount (the ones that landed as Other);
 * "+ Add a material cost" records one by hand against an order, no document. Every save is
 * one RPC (migration 20270294); the page re-reads after it.
 */
const CATEGORIES: [string, string][] = [
  ["scaffold", "Scaffold"], ["render", "Render"], ["carpentry", "Carpentry"], ["rubbish", "Rubbish"], ["equipment_hire", "Equipment hire"],
  ["permit", "Permit"], ["traffic_mgmt", "Traffic management"], ["materials", "Materials"], ["other", "Other"],
];
const dollars = dollarsText;
const cents = centsOf;

function useSave() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState("");
  const save = (fn: () => Promise<{ ok: boolean; message?: string }>, done: () => void) => start(async () => {
    const r = await fn();
    if (!r.ok) { setErr(r.message ?? "That did not save."); return; }
    setErr(""); done(); router.refresh();
  });
  return { busy, err, save };
}

export function OrderSelect({ orders, value, onChange }: { orders: PanelOrder[]; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Order" data-testid="cost-order">
      <option value="">No order</option>
      {orders.map((o) => <option key={o.id} value={o.id}>{o.kind === "paint" ? "Paint" : "Materials"} · {o.title}{o.status === "tray" ? " (in the tray)" : ""}</option>)}
    </select>
  );
}

export function EditMaterialButton({ estimateId, cost, orders }: {
  estimateId: string; cost: { id: string; supplier: string; amountCents: number; invoiceDate: string | null; orderRef: string | null; movementId: string | null }; orders: PanelOrder[];
}) {
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState(cost.supplier);
  const [amount, setAmount] = useState(dollars(cost.amountCents));
  const [date, setDate] = useState(cost.invoiceDate ?? "");
  const [ref, setRef] = useState(cost.orderRef ?? "");
  const [order, setOrder] = useState<string | null>(cost.movementId);
  const { busy, err, save } = useSave();
  if (!open) return <button type="button" className="b sm" onClick={() => setOpen(true)} data-testid="material-edit">Edit</button>;
  return (
    <span className="costedit" data-testid="material-edit-form">
      <input type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier / label" aria-label="Supplier" data-testid="material-supplier" />
      <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount inc GST" aria-label="Amount including GST" data-testid="material-amount" />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Invoice date" />
      <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Reference" aria-label="Reference" />
      <OrderSelect orders={orders} value={order} onChange={setOrder} />
      <button type="button" className="b sm pri" disabled={busy} data-testid="material-save" onClick={() => {
        const c = cents(amount);
        if (c === null) return;
        save(() => updateMaterialCostAction({ estimateId, id: cost.id, supplier: supplier.trim(), amountCents: c, invoiceDate: date || null, orderRef: ref.trim(), movementId: order }), () => setOpen(false));
      }}>Save</button>
      <button type="button" className="b sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      {err ? <span className="err">{err}</span> : null}
    </span>
  );
}

export function EditJobCostButton({ estimateId, cost }: { estimateId: string; cost: PanelJobCost }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(cost.description);
  const [category, setCategory] = useState(cost.category);
  const [ex, setEx] = useState(dollars(cost.amountExCents));
  const [gst, setGst] = useState(dollars(cost.gstCents));
  const { busy, err, save } = useSave();
  if (cost.status === "paid") return null;
  if (!open) return <button type="button" className="b sm" onClick={() => setOpen(true)} data-testid="job-cost-edit">Edit</button>;
  return (
    <span className="costedit" data-testid="job-cost-edit-form">
      <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" aria-label="Label" data-testid="job-cost-label" />
      <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" data-testid="job-cost-category">
        {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input type="text" inputMode="decimal" value={ex} onChange={(e) => { setEx(e.target.value); const c = cents(e.target.value); if (c !== null) setGst(dollars(gstOnExCents(c))); }} placeholder="Amount ex GST" aria-label="Amount excluding GST" data-testid="job-cost-ex" />
      <input type="text" inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} placeholder="GST" aria-label="GST" />
      <button type="button" className="b sm pri" disabled={busy} data-testid="job-cost-save" onClick={() => {
        const a = cents(ex), g = cents(gst);
        if (a === null || g === null) return;
        save(() => updateJobCostAction({ estimateId, id: cost.id, description: label.trim(), category, amountExCents: a, gstCents: g }), () => setOpen(false));
      }}>Save</button>
      <button type="button" className="b sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      {err ? <span className="err">{err}</span> : null}
    </span>
  );
}

export function AddMaterialCostButton({ estimateId, woId, orders }: { estimateId: string; woId: string; orders: PanelOrder[] }) {
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [ref, setRef] = useState("");
  const [order, setOrder] = useState<string | null>(orders[0]?.id ?? null);
  const { busy, err, save } = useSave();
  if (!open) return <button type="button" className="b" onClick={() => setOpen(true)} data-testid="add-material-cost">+ Add a material cost to an order</button>;
  return (
    <span className="costedit" data-testid="add-material-cost-form">
      <input type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier" aria-label="Supplier" data-testid="add-material-supplier" />
      <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount inc GST" aria-label="Amount including GST" data-testid="add-material-amount" />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Invoice date" />
      <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Reference" aria-label="Reference" />
      <OrderSelect orders={orders} value={order} onChange={setOrder} />
      <button type="button" className="b sm pri" disabled={busy || !supplier.trim() || cents(amount) === null} data-testid="add-material-save" onClick={() => {
        const c = cents(amount);
        if (c === null) return;
        save(() => addMaterialCostAction({ estimateId, woId, supplier: supplier.trim(), amountCents: c, movementId: order, orderRef: ref.trim(), invoiceDate: date || null }), () => { setOpen(false); setSupplier(""); setAmount(""); setRef(""); });
      }}>Add</button>
      <button type="button" className="b sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
      {err ? <span className="err">{err}</span> : null}
    </span>
  );
}
