import Link from "next/link";
import { notFound } from "next/navigation";
import { readGuide, rolesFor, type HelpRole } from "@/lib/help/content";
import HelpArticle from "@/app/components/help/HelpArticle";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { staff: "Office", pc: "Project coordinator" };

export default async function HelpGuidePage({ params }: { params: Promise<{ feature: string; role: string }> }) {
  const { feature, role } = await params;
  const roles = rolesFor("staff");
  // Only a role the office may read resolves; a contractor file at this URL is
  // simply not found.
  if (!roles.includes(role as HelpRole)) notFound();
  const guide = readGuide(feature, role as HelpRole, roles, "app");
  if (!guide) notFound();

  return (
    <div className="p-6" data-testid="help-guide">
      <Link href="/help" className="text-xs uppercase tracking-wide text-gray-500 hover:text-gray-800">← Help</Link>
      <div className="mt-2 text-xs uppercase tracking-wide text-gray-500">
        {guide.entry.feature.replace(/-/g, " ")} · {ROLE_LABEL[guide.entry.role] ?? guide.entry.role}
      </div>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">{guide.entry.title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">{guide.entry.summary}</p>
      {guide.entry.walkthrough && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4" data-testid="help-film">
          <div className="text-sm font-medium">Watch it first</div>
          <div className="mb-2 text-xs text-gray-500">A short silent film of the steps below, on the real screens.</div>
          {/* eslint-disable-next-line @next/next/no-img-element -- our own role-gated media route; a GIF, not an optimisable image */}
          <img
            src={`/api/help/media/${guide.entry.feature}/${guide.entry.walkthrough.replace(/^media\//, "")}`}
            alt="Walkthrough"
            className="block w-full max-w-3xl rounded-lg border border-gray-200"
          />
        </div>
      )}
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5">
        <HelpArticle blocks={guide.blocks} mode="app" />
      </div>
    </div>
  );
}
