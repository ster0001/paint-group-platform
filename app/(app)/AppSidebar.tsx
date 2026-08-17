"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signout } from "@/app/auth/actions";

const NAV = [
  { href: "/estimates", label: "Estimates", icon: "📄" },
  { href: "/plans", label: "Read a plan", icon: "📐" },
  { href: "/schedule", label: "Schedule", icon: "🗓" },
  { href: "/invoices", label: "Invoices", icon: "🧾" },
  { href: "/contacts", label: "Contacts", icon: "👤" },
  { href: "/contractors", label: "Contractors", icon: "🎨" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function AppSidebar({ name, email, logoUrl = "" }: { name: string; email: string; logoUrl?: string }) {
  const path = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line2 bg-ink p-3 text-gray-300">
      <div className="px-2 py-3">
        {logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={logoUrl} alt="Paint Group" className="h-8 w-auto max-w-full object-contain object-left" />
          : <span className="text-lg font-semibold tracking-tight text-white">Paint<span className="text-paint">·</span>Group</span>}
      </div>
      <nav className="mt-2 flex-1 space-y-1">
        {NAV.map((n) => {
          const active = path === n.href || path.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
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
  );
}
