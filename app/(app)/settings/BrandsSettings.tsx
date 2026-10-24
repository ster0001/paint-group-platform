"use client";

import { useState, useTransition } from "react";
import { saveBrandSettingsAction } from "./brandsActions";
import { BRAND_DEFAULTS, brandFor, type BrandKey, type BrandSettings } from "@/lib/marketing/brand";
import PaintHomeLogo from "@/app/(marketing)/_components/PaintHomeLogo";

/**
 * Settings → Brands (Paint Home brief §6): the editable face of
 * lib/marketing/brand.ts — domain, phone, legal line and accent colour per
 * shopfront. Blank = the default in code (shown as the placeholder). The
 * logos are not edited here: Paint Group's is Company details → logo 1;
 * Paint Home's is the supplied vector, drawn inline everywhere.
 */
const FIELDS: Array<{ key: keyof BrandSettings["painthome"]; label: string; hint: string }> = [
  { key: "domain", label: "Domain", hint: "The hostname this brand answers on." },
  { key: "phoneDisplay", label: "Phone number", hint: "As shown on the site; the tel: link is derived from it." },
  { key: "legalLine", label: "Legal line", hint: "The footer's legal entity line." },
  { key: "primaryColour", label: "Accent colour", hint: "Hex. Drives --brand on every page of this brand." },
];

export default function BrandsSettings({ initial }: { initial: BrandSettings }) {
  const [settings, setSettings] = useState<BrandSettings>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (brand: BrandKey, key: keyof BrandSettings["painthome"], value: string) => {
    setMsg(null);
    setSettings((s) => ({ ...s, [brand]: { ...s[brand], [key]: value } }));
  };

  function save() {
    start(async () => {
      const r = await saveBrandSettingsAction(settings).catch(() => null);
      if (!r) { setMsg({ ok: false, text: "That didn't save." }); return; }
      if (r.status === "invalid") { setMsg({ ok: false, text: r.issues.join(" ") }); return; }
      if (r.status === "error") { setMsg({ ok: false, text: r.message }); return; }
      setSettings(r.settings);
      setMsg({ ok: true, text: "Saved. Live on the websites within a minute." });
    });
  }

  const input = "mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";
  return (
    <div className="grid gap-4" data-testid="brands-settings">
      <p className="text-xs text-gray-500">
        One business, two shopfronts. Paint Home is the same wizard, painters, CRM and invoicing with its own domain, logo and words; every lead carries which door it came through. Leave a field blank to use the default shown.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {(["paintgroup", "painthome"] as const).map((b) => {
          const live = brandFor(b === "painthome" ? "painthome" : "home", settings);
          const d = BRAND_DEFAULTS[b];
          return (
            <section key={b} className="rounded-lg border border-gray-200 bg-white p-3" data-testid={`brand-${b}`}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-gray-900">{d.name}</h3>
                {b === "painthome"
                  ? <span className="rounded-md px-2 py-1" style={{ background: live.inkColour }}><PaintHomeLogo variant="nav" on="dark" className="h-5 w-auto" /></span>
                  : <span className="text-xs text-gray-500">Logo: Company details → logo 1</span>}
              </div>
              <p className="mt-1 text-xs text-gray-500">{d.tagline}</p>
              <div className="mt-3 grid gap-3">
                {FIELDS.map((f) => (
                  <label key={f.key} className="text-xs text-gray-600">
                    {f.label}
                    <input className={input} value={settings[b][f.key]} placeholder={d[f.key]} onChange={(e) => set(b, f.key, e.target.value)} data-testid={`brand-${b}-${f.key}`} />
                    <span className="mt-0.5 block text-[11px] text-gray-400">{f.hint}</span>
                  </label>
                ))}
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="inline-block h-4 w-4 rounded-full border border-gray-300" style={{ background: live.primaryColour }} aria-hidden="true" />
                  <span>Accent in use: <code>{live.primaryColour}</code> · phone link <code>{live.phoneTel}</code> · <code>{live.url}</code></span>
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={pending} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" data-testid="brands-save">
          {pending ? "Saving…" : "Save"}
        </button>
        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`} role="status" data-testid="brands-status">{msg.text}</p>}
      </div>
    </div>
  );
}
