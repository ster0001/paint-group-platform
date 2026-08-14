import { createClient } from "@/lib/supabase/server";
import type { Contact } from "@/app/quote/company";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const supabase = await createClient();
  const res = await supabase.from("contacts").select("*").order("last_name");
  const contacts = (res.data as Contact[] | null) ?? [];

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight">Contacts</h1>
      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {contacts.length > 0 ? (
          <table className="w-full text-sm">
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
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">{[c.first_name, c.last_name].filter(Boolean).join(" ")}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.company || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.email || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.phone || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{c.city || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-10 text-center text-sm text-gray-400">
            No contacts yet. Add one from an estimate’s <strong>Contact</strong> card (Save to Contacts),
            and it will appear here.
          </div>
        )}
      </div>
    </div>
  );
}
