"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signout } from "@/app/auth/actions";

const NAV = [
  { href: "/estimates", label: "Estimates", icon: "📄" },
  { href: "/invoices", label: "Invoices", icon: "🧾" },
  { href: "/contacts", label: "Contacts", icon: "👤" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function AppSidebar({ name, email }: { name: string; email: string }) {
  const path = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white p-3">
      <div className="px-2 py-3 text-lg font-semibold tracking-tight">Paint Group</div>
      <nav className="mt-2 flex-1 space-y-1">
        {NAV.map((n) => {
          const active = path === n.href || path.startsWith(n.href + "/");
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                active ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <span aria-hidden>{n.icon}</span>
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-gray-200 pt-3">
        <div className="truncate px-3 text-sm font-medium">{name}</div>
        <div className="truncate px-3 text-xs text-gray-400">{email}</div>
        <form action={signout}>
          <button className="mt-2 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
