// Instant skeleton for the app pages (Estimates, Settings, Contacts…) so
// switching between them feels immediate.
export default function Loading() {
  return (
    <div className="p-6">
      <div className="h-7 w-40 animate-pulse rounded bg-gray-200" />
      <div className="mt-6 space-y-3">
        <div className="h-12 animate-pulse rounded-lg bg-gray-100" />
        <div className="h-12 animate-pulse rounded-lg bg-gray-100" />
        <div className="h-12 animate-pulse rounded-lg bg-gray-100" />
      </div>
    </div>
  );
}
