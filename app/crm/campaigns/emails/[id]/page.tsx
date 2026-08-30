import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { templateSchema, type Template } from "@/lib/campaigns/blocks";
import { getSegment } from "@/lib/crm/segmentsStore";
import Studio from "./Studio";
import SmsStudio from "./SmsStudio";

export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [full, { data: profileRow }] = await Promise.all([
    supabase.from("campaign_templates")
      .select("id, name, subject, preheader, blocks, segment_key, approved_at, kind, sms_body")
      .eq("id", id).maybeSingle(),
    supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle(),
  ]);
  // Pre-migration-20261212 fallback: the SMS columns aren't there yet, and an
  // email must still open while they wait.
  const row = full.data ?? (full.error && /kind|sms_body/.test(full.error.message)
    ? (await supabase.from("campaign_templates")
        .select("id, name, subject, preheader, blocks, segment_key, approved_at")
        .eq("id", id).maybeSingle()).data
    : null);
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
  const segment = row.segment_key ? await getSegment(supabase, row.segment_key as string) : null;

  if ((row as { kind?: string }).kind === "sms") {
    return (
      <>
        <Link className="back" href="/crm/campaigns/emails">← Emails &amp; texts</Link>
        <SmsStudio
          id={row.id as string}
          initialName={row.name as string}
          initialBody={String((row as { sms_body?: string }).sms_body ?? "")}
          approvedAt={row.approved_at as string | null}
          segment={segment ? { name: segment.name, description: segment.description } : null}
        />
      </>
    );
  }

  return (
    <>
      <Link className="back" href="/crm/campaigns/emails">← Emails &amp; texts</Link>
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
