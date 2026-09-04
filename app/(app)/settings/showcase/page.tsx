import Image from "next/image";
import Link from "next/link";
import { listShowcaseJobsForStaff } from "@/lib/showcase/staff";
import { formatPriceRange, showcaseMediaUrl } from "@/lib/showcase/format";
import { JOB_TYPE_LABEL } from "@/lib/showcase/schema";

/**
 * Settings → Showcase jobs (homepage brief §4.4b) — the list. Every job,
 * drafts included, under the staff read policy: thumbnail, title, suburb,
 * price range, published pill, featured rank. Row click → editor.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Showcase jobs · Settings" };

export default async function ShowcaseListPage() {
  const jobs = await listShowcaseJobsForStaff();
  return (
    <main className="mx-auto max-w-5xl p-6" data-testid="showcase-list">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-900">← Settings</Link>
          <h1 className="mt-1 text-2xl font-semibold">Showcase jobs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Finished jobs shown as “Real jobs, real prices” on the website. Only published jobs are public; the three
            with featured ranks 1–3 are the homepage cards.
          </p>
        </div>
        <Link href="/settings/showcase/new" data-testid="showcase-new" className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
          + New job
        </Link>
      </div>

      {jobs.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          No showcase jobs yet. Add one, or run the placeholder seed (docs/testing/homepage-v2-session2-manual.md).
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Photo</th><th className="px-3 py-2">Job</th><th className="px-3 py-2">Suburb</th>
                <th className="px-3 py-2">Price range</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Featured</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-gray-100 hover:bg-gray-50" data-testid={`showcase-row-${j.slug}`}>
                  <td className="px-3 py-2">
                    <Link href={`/settings/showcase/${j.id}`} className="block h-[54px] w-[72px] overflow-hidden rounded bg-gray-100">
                      {j.hero_path && <Image src={showcaseMediaUrl(j.hero_path)} alt="" width={72} height={54} className="h-full w-full object-cover" />}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/settings/showcase/${j.id}`} className="font-medium text-gray-900 hover:underline">{j.title}</Link>
                    <div className="text-xs text-gray-500">{JOB_TYPE_LABEL[j.job_type]} · {j.property_type} · /work/{j.slug}</div>
                  </td>
                  <td className="px-3 py-2">{j.suburb}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {j.price_low_cents != null && j.price_high_cents != null ? formatPriceRange(j.price_low_cents, j.price_high_cents) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {j.published
                      ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Published</span>
                      : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Draft</span>}
                  </td>
                  <td className="px-3 py-2">{j.featured_rank != null ? <span className="font-mono text-xs">#{j.featured_rank}</span> : <span className="text-gray-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
