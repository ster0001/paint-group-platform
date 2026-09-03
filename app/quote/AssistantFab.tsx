import Link from "next/link";

/**
 * The floating "ask the assistant" button on the builder (and the estimates
 * list). Opens co-work for THIS estimate — or a fresh staff draft when there
 * is no estimate yet. A link, not a widget: the co-work page is the chat.
 */
export default function AssistantFab({ estimateId }: { estimateId: string | null }) {
  const href = estimateId ? `/estimates/${estimateId}/assist` : "/estimates/new/assist";
  return (
    <Link
      href={href}
      data-testid="assistant-fab"
      aria-label="Ask the assistant"
      title="Ask the assistant"
      className="group fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gray-900 text-white shadow-lg ring-1 ring-black/10 transition hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 print:hidden"
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-4.6A8 8 0 1 1 21 12z" />
        <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth="2.4" />
      </svg>
      <span className="pointer-events-none absolute right-16 whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-sm text-white opacity-0 shadow transition group-hover:opacity-100 group-focus-visible:opacity-100">
        Ask the assistant
      </span>
    </Link>
  );
}
