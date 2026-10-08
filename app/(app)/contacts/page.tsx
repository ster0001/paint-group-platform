import { createClient } from "@/lib/supabase/server";
import type { Contact } from "@/app/quote/company";
import SearchBox from "./SearchBox";

export const dynamic = "force-dynamic";

/** Tom, 1 Oct 2026: the list is searchable — by name, company, email, phone or suburb (`?q=`). */
export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: qRaw } = await searchParams;
  const q = (qRaw ?? "").trim().slice(0, 80);
  // `%`/`_` are wildcards; `,` and `(` would split the or() filter list.
  const needle = q.toLowerCase().replace(/[%_,()]/g, "");
  const supabase = await createClient();
  let query = supabase.from("contacts").select("*").order("last_name");
  if (needle) {
    const like = `%${needle}%`;
    // The phone is matched with and without its spaces, so "0412 345" and "0412345" both find it.
    const digits = needle.replace(/\s+/g, "");
    query = query.or([
      `first_name.ilike.${like}`, `last_name.ilike.${like}`, `company.ilike.${like}`,
      `email.ilike.${like}`, `phone.ilike.${like}`, `phone.ilike.%${digits}%`, `city.ilike.${like}`,
    ].join(","));
  }
  const { data, error } = await query;
  // A rejected read is not an empty address book (CLAUDE.md, 16 Sep): say so.
  const contacts = (data as Contact[] | null) ?? [];

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Contacts</h1>
        <SearchBox q={q} />
      </div>
      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" data-testid="contacts-load-failed">
          <strong>The contacts could not be loaded — this is not an empty list.</strong> {error.message}
        </p>
      )}
      <div className="relative mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {contacts.length > 0 ? (
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">City</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contacts.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50" data-testid="contact-row">
                  <td className="px-4 py-2.5 font-medium">{[c.first_name, c.last_name].filter(Boolean).join(" ")}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.company || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.email || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.phone || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.city || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : error ? null : q ? (
          <div className="p-10 text-center text-sm text-gray-400" data-testid="contacts-search-empty">
            No contact matches “{q}”.
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-gray-400">
            No contacts yet. Every CRM customer and every contact used on an estimate lands here by itself.
          </div>
        )}
      </div>
    </div>
  );
}
