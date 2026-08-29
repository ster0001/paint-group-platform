"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signout } from "@/app/auth/actions";

// "Read a plan" was removed from this rail on 22 Aug — the wizard covers plan
// reading now. The /plans ROUTE still exists and still works; only the nav
// entry is gone, so anything holding a link to it (and the wizard's own use of
// the extraction pipeline) is untouched.
const NAV = [
  { href: "/estimates", label: "Estimates", icon: "📄" },
  { href: "/proving", label: "Proving", icon: "🎯" },
  // Projects — the job workflow, from scheduling through to sign-off. It lives
  // outside this route group (its own chrome), so it has to be linked
  // explicitly; the scheduling timeline is its first tab rather than a separate
  // entry here.
  { href: "/pc", label: "Projects", icon: "◉" },
  // Two money tabs (Tom, 24 Aug): Invoicing = the per-job invoice list that
  // opens the revision builder; Payments = the ledger dashboard
  // (receivables / payables / activity, the old "Invoicing").
  { href: "/invoices", label: "Invoicing", icon: "🧾" },
  { href: "/invoicing", label: "Payments", icon: "💳" },
  { href: "/contacts", label: "Contacts", icon: "👤" },
  // The CRM lives outside this shell (its own dark chrome, like /pc), so it
  // needs its link here or it is a screen nobody can find.
  { href: "/crm", label: "CRM", icon: "📣" },
  { href: "/contractors", label: "Contractors", icon: "🎨" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

/**
 * The staff nav. A fixed 224px column on a laptop; on a phone it is off-canvas
 * behind a menu button (Tom, 23 Aug) — 224px of a 390px screen left almost
 * nothing for the page itself.
 *
 * The bar at the top of a small screen carries the logo and the current page's
 * name, so you still know where you are with the drawer shut.
 */
export default function AppSidebar({ name, email, logoUrl = "" }: { name: string; email: string; logoUrl?: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => path === href || path.startsWith(href + "/");
  const current = NAV.find((n) => isActive(n.href));

  // Escape closes it too — a drawer with no keyboard way out is a trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const brand = logoUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={logoUrl} alt="Paint Group" className="h-8 w-auto max-w-full object-contain object-left" />
    : <span className="text-lg font-semibold tracking-tight text-white">Paint<span className="text-paint">·</span>Group</span>;

  return (
    <>
      {/* ---- phone: top bar ------------------------------------------------ */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center gap-3 border-b border-line2 bg-ink px-3 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="staff-nav"
          className="rounded-md border border-line2 px-2.5 py-1.5 text-gray-300 hover:bg-white/5"
        >
          <span aria-hidden className="block h-3 w-4 border-y-2 border-current before:block before:h-0.5 before:w-full before:translate-y-[3px] before:bg-current" />
        </button>
        <span className="min-w-0 flex-1 truncate">{brand}</span>
        {current && <span className="truncate text-sm font-medium text-gray-300">{current.label}</span>}
      </div>
      {/* ---- the scrim, phone only ----------------------------------------- */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}

      <aside
        id="staff-nav"
        className={`fixed inset-y-0 left-0 z-50 flex w-56 shrink-0 flex-col border-r border-line2 bg-ink p-3 text-gray-300 transition-transform duration-200 md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-2 py-3">
          {brand}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="rounded-md px-2 py-1 text-lg leading-none text-gray-400 hover:bg-white/5 hover:text-white md:hidden"
          >
            ×
          </button>
        </div>
        <nav className="mt-2 flex-1 space-y-1 overflow-y-auto">
          {NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                // Tapping a link closes the drawer. Left open, it sits over the
                // page you just asked for, which reads as a tap that did nothing.
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                  active ? "bg-accent text-accentink" : "text-gray-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span aria-hidden>{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line2 pt-3">
          <div className="truncate px-3 text-sm font-medium text-gray-200">{name}</div>
          <div className="truncate px-3 text-xs text-gray-500">{email}</div>
          <form action={signout}>
            <button className="mt-2 w-full rounded-md border border-line2 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/5">
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
