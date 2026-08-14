// Shown instantly while /quote's data loads, so navigation feels immediate
// instead of hanging on the previous page.
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-48 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 animate-pulse rounded bg-gray-200" />
          <div className="h-9 w-24 animate-pulse rounded bg-gray-100" />
        </div>
      </div>
      <div className="mt-6 h-40 animate-pulse rounded-xl bg-gray-100" />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <div className="h-28 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
        </div>
        <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
      </div>
      <p className="mt-6 text-center text-sm text-gray-400">Loading estimate…</p>
    </main>
  );
}
