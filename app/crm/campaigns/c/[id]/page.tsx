import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { STANDING_SEGMENTS } from "@/lib/crm/segments";
import CampaignBuilder from "./CampaignBuilder";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: campaign }, { data: templates }] = await Promise.all([
    supabase.from("campaigns").select("id, name, segment_key, status, steps, auto_send").eq("id", id).maybeSingle(),
    supabase.from("campaign_templates").select("id, name, approved_at").order("updated_at", { ascending: false }).limit(100),
  ]);
  if (!campaign) notFound();

  return (
    <>
      <Link className="back" href="/crm/campaigns">← Campaigns</Link>
      <CampaignBuilder
        id={campaign.id as string}
        initial={{
          name: campaign.name as string,
          segmentKey: campaign.segment_key as string,
          status: campaign.status as "draft" | "live" | "paused",
          steps: (Array.isArray(campaign.steps) ? campaign.steps : []) as Array<{
            step: number; templateId: string | null; waitDays: number; channel: "email" | "sms";
          }>,
          autoSend: campaign.auto_send as boolean,
        }}
        segments={STANDING_SEGMENTS.map((s) => ({ key: s.key, name: s.name, description: s.description }))}
        templates={(templates ?? []).map((t) => ({
          id: t.id as string, name: t.name as string, approved: t.approved_at != null,
        }))}
      />
    </>
  );
}
