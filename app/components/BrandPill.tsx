import Link from "next/link";
import { BRAND_FILTERS, BRAND_FILTER_LABEL, brandPillLabel, type BrandFilter } from "@/lib/brand/filter";

/**
 * Paint Home brief §6 — the one brand pill and the one brand filter, on every
 * staff list. Server-safe. The pill renders only on a Paint Home row (the
 * default brand wears nothing); the host list passes its own class so the
 * pill sits in that screen's pill vocabulary (`.pill` on PC Command, `.chip`
 * in Invoicing, Tailwind in the app shell).
 */
export function BrandPill({ brand, className = "", always = false }: { brand: unknown; className?: string; always?: boolean }) {
  const label = brandPillLabel(brand, always);
  if (!label) return null;
  const painthome = brand === "painthome";
  // Tom, 25 Oct 2026: with `always` the two shopfronts are told apart at a glance — Paint Home in its own
  // slate-and-cyan, Paint Group in a plain grey — and the data attribute lets a spec read the brand.
  const cls = className || (painthome
    ? "inline-block rounded-full border border-transparent bg-[#2E3A3D] px-2 py-0.5 text-[11px] font-semibold text-[#17F9F1]"
    : "inline-block rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-700");
  return <span className={cls} data-testid="brand-pill" data-brand={painthome ? "painthome" : "paintgroup"}>{label}</span>;
}

/** All · Paint Group · Paint Home — three links, the current one pressed; `hrefFor` is the host list's URL builder. */
export function BrandFilterChips({ value, hrefFor, className = "", chipClass, testIdPrefix = "brand-filter" }: {
  value: BrandFilter;
  hrefFor: (f: BrandFilter) => string;
  className?: string;
  /** (filter, on) → the chip's class; default is the app shell's rounded chip. */
  chipClass?: (on: boolean) => string;
  testIdPrefix?: string;
}) {
  const cls = chipClass ?? ((on: boolean) => `rounded-full border px-2.5 py-1 text-xs ${on ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`);
  return (
    <span className={className} style={className ? undefined : { display: "contents" }} role="group" aria-label="Brand" data-testid={testIdPrefix}>
      {BRAND_FILTERS.map((f) => (
        <Link key={f} href={hrefFor(f)} className={cls(value === f)} aria-pressed={value === f} data-testid={`${testIdPrefix}-${f}`}>{BRAND_FILTER_LABEL[f]}</Link>
      ))}
    </span>
  );
}
