"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type ColourValue = { name: string; hex: string };
type Colour = { id?: string; brand: string; name: string; hex: string; collection?: string | null };

const normHex = (h: string) => {
  let s = h.trim(); if (s && s[0] !== "#") s = "#" + s;
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : "";
};

// Visual colour picker: a swatch button that opens a searchable library (by brand)
// with add-your-own. On-screen colour is a guide only — confirm with a sample.
export default function ColourPicker({ value, onChange, compact }: {
  value: ColourValue | null;
  onChange: (c: ColourValue) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [colours, setColours] = useState<Colour[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("all");
  const [adding, setAdding] = useState(false);
  const [nn, setNn] = useState(""); const [nh, setNh] = useState("#");

  useEffect(() => {
    if (!open || loaded) return;
    createClient().from("colours").select("brand,name,hex,collection").eq("active", true).order("brand").order("name")
      .then(({ data }) => { setColours((data as Colour[]) ?? []); setLoaded(true); });
  }, [open, loaded]);

  const brands = useMemo(() => ["all", ...Array.from(new Set(colours.map((c) => c.brand)))], [colours]);
  const filtered = useMemo(() => colours.filter((c) =>
    (brand === "all" || c.brand === brand) &&
    (q.trim() === "" || `${c.brand} ${c.name}`.toLowerCase().includes(q.toLowerCase()))
  ), [colours, brand, q]);

  const pick = (c: ColourValue) => { onChange(c); setOpen(false); };
  async function addNew() {
    const hex = normHex(nh); const name = nn.trim();
    if (!name || !hex) return;
    const b = brand === "all" ? "Custom" : brand;
    await createClient().from("colours").insert({ brand: b, name, hex });
    setColours((cs) => [...cs, { brand: b, name, hex }]);
    setAdding(false); setNn(""); setNh("#");
    pick({ name, hex });
  }

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid #cbd5e1", borderRadius: 7, padding: compact ? "3px 8px" : "5px 10px", background: "#fff", cursor: "pointer", font: "inherit", fontSize: 13, color: "#111", maxWidth: 220 }}>
        <span style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, border: "1px solid rgba(0,0,0,.15)", background: value?.hex || "repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 50% / 8px 8px" }} />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value?.name || "Pick colour"}</span>
      </button>

      {open && (
        <div style={{ position: "absolute", zIndex: 60, top: "calc(100% + 6px)", left: 0, width: 300, background: "#fff", color: "#111", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,.28)", padding: 12 }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search colour…" style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 7, padding: "6px 9px", fontSize: 13, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
            {brands.map((b) => (
              <button key={b} type="button" onClick={() => setBrand(b)}
                style={{ fontSize: 11, padding: "3px 8px", borderRadius: 100, border: "1px solid #cbd5e1", background: brand === b ? "#0f172a" : "#fff", color: brand === b ? "#fff" : "#334155", cursor: "pointer", textTransform: b === "all" ? "capitalize" : "none" }}>{b}</button>
            ))}
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
            {!loaded && <div style={{ gridColumn: "1/3", color: "#94a3b8", fontSize: 12, padding: 8 }}>Loading…</div>}
            {loaded && filtered.length === 0 && <div style={{ gridColumn: "1/3", color: "#94a3b8", fontSize: 12, padding: 8 }}>No matches.</div>}
            {filtered.map((c, i) => (
              <button key={i} type="button" onClick={() => pick({ name: c.name, hex: c.hex })} title={`${c.brand} ${c.name}`}
                style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid #e2e8f0", borderRadius: 7, padding: "5px 7px", background: "#fff", cursor: "pointer", textAlign: "left", minWidth: 0 }}>
                <span style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, border: "1px solid rgba(0,0,0,.15)", background: c.hex }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                  <span style={{ display: "block", fontSize: 9.5, color: "#94a3b8" }}>{c.brand}</span>
                </span>
              </button>
            ))}
          </div>
          {adding ? (
            <div style={{ marginTop: 8, borderTop: "1px solid #eef2f7", paddingTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
              <input value={nn} onChange={(e) => setNn(e.target.value)} placeholder="Colour name" style={{ flex: 1, border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 7px", fontSize: 12 }} />
              <input value={nh} onChange={(e) => setNh(e.target.value)} placeholder="#hex" style={{ width: 74, border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 7px", fontSize: 12 }} />
              <span style={{ width: 18, height: 18, borderRadius: 4, border: "1px solid rgba(0,0,0,.15)", background: normHex(nh) || "#fff" }} />
              <button type="button" onClick={addNew} style={{ fontSize: 12, background: "#0f172a", color: "#fff", border: "none", borderRadius: 6, padding: "4px 9px", cursor: "pointer" }}>Add</button>
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} style={{ marginTop: 8, fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 4 }}>+ Add a colour</button>
          )}
          <div style={{ marginTop: 6, fontSize: 9.5, color: "#94a3b8", lineHeight: 1.4 }}>On-screen colour is a guide only — confirm with a physical sample.</div>
        </div>
      )}
    </span>
  );
}
