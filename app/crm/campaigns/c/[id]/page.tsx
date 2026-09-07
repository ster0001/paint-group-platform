import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadSegments } from "@/lib/crm/segmentsStore";
import { normaliseSteps } from "@/lib/campaigns/sweep";
import type { ExitRule } from "@/lib/campaigns/guard";
import CampaignBuilder from "./CampaignBuilder";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [segments, { data: campaign }, { data: templates }] = await Promise.all([
    loadSegments(supabase),
    supabase.from("campaigns")
      .select("id, name, class, entry, segment_key, trigger_event, exit_rules, status, steps, auto_send, conversion_days, last_swept_at")
      .eq("id", id).maybeSingle(),
    supabase.from("campaign_templates").select("id, name, approved_at, kind").order("updated_at", { ascending: false }).limit(100),
  ]);
  if (!campaign) notFound();

  return (
    <>
      <Link className="back" href="/crm/campaigns">← Campaigns</Link>
      <CampaignBuilder
        id={campaign.id as string}
        initial={{
          name: campaign.name as string,
          class: campaign.class === "followup" ? "followup" : "marketing",
          entry: campaign.entry === "event" ? "event" : "audience",
          segmentKey: (campaign.segment_key as string | null) ?? null,
          triggerEvent: (campaign.trigger_event as string | null) ?? null,
          exitRules: ((campaign.exit_rules as string[] | null) ?? []) as ExitRule[],
          status: campaign.status as "draft" | "live" | "paused",
          steps: normaliseSteps(campaign.steps),
          autoSend: campaign.auto_send === true,
          conversionDays: (campaign.conversion_days as number) ?? 30,
          lastSweptAt: (campaign.last_swept_at as string | null) ?? null,
        }}
        segments={segments.filter((s) => !s.invalid).map((s) => ({ key: s.key, name: s.name, description: s.description }))}
        templates={(templates ?? []).map((t) => ({
          id: t.id as string, name: t.name as string, approved: t.approved_at != null,
          kind: ((t as { kind?: string }).kind === "sms" ? "sms" : "email") as "email" | "sms",
        }))}
      />
    </>
  );
}
