import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { templateSchema, type Template } from "@/lib/campaigns/blocks";
import { STANDING_SEGMENTS } from "@/lib/crm/segments";
import Studio from "./Studio";

export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: row }, { data: profileRow }] = await Promise.all([
    supabase.from("campaign_templates")
      .select("id, name, subject, preheader, blocks, segment_key, approved_at")
      .eq("id", id).maybeSingle(),
    supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle(),
  ]);
  if (!row) notFound();

  const company = (profileRow?.value ?? {}) as { name?: string; logoUrl?: string };
  // A stored draft is parsed leniently: a block a later version stopped
  // understanding must not take the whole email down.
  const parsed = templateSchema.safeParse({
    subject: row.subject ?? "",
    preheader: row.preheader ?? "",
    blocks: Array.isArray(row.blocks) ? row.blocks : [],
  });
  const template: Template = parsed.success ? parsed.data : { subject: row.subject ?? "", preheader: "", blocks: [] };
  const segment = STANDING_SEGMENTS.find((s) => s.key === row.segment_key);

  return (
    <>
      <Link className="back" href="/crm/campaigns/emails">← Emails</Link>
      <Studio
        id={row.id as string}
        initialName={row.name as string}
        initialTemplate={template}
        approvedAt={row.approved_at as string | null}
        segment={segment ? { key: segment.key, name: segment.name, description: segment.description } : null}
        brand={{ companyName: company.name || "Paint Group", logoUrl: company.logoUrl || null }}
      />
    </>
  );
}
