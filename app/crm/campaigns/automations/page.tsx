import { createClient } from "@/lib/supabase/server";
import { MESSAGING_KEY, type MessagingSettings } from "@/lib/messaging/config";
import { brandWordingFrom, type BrandWordingRow } from "@/lib/messaging/brandWording";
import { loadFunnelStats } from "@/lib/automations/funnelStats";
import { reportError } from "@/lib/monitoring/report";
import AutomationsSettings from "@/app/(app)/settings/AutomationsSettings";
import SubNav from "../../SubNav";

export const dynamic = "force-dynamic";

/**
 * Campaigns › Automations (ruling A‑C, 11 Nov 2026; built 17 Nov). Every
 * message a customer gets from their range to a finished job — the funnel
 * keys of lib/automations/funnel.ts, in the plan's order — with the last 30
 * days' sends. The same editor as Settings → Automations (one component, one
 * saved row), which keeps the rest and links across. Staff only (the CRM
 * layout's guard).
 */
export default async function CampaignAutomationsPage() {
  const supabase = await createClient();
  const [settings, wording, stats] = await Promise.all([
    supabase.from("settings").select("key, value").in("key", [MESSAGING_KEY, "wo_loop"]),
    supabase.from("automation_brand_wording").select("brand, field, body"),
    loadFunnelStats(supabase),
  ]);
  if (settings.error) reportError(settings.error, { where: "campaigns.automations.settings" });
  if (wording.error) reportError(wording.error, { where: "campaigns.automations.wording", bestEffort: true });
  if (stats.error) reportError(new Error(stats.error), { where: "campaigns.automations.stats", bestEffort: true });
  const rows = (settings.data ?? []) as { key: string; value: unknown }[];
  const messaging = (rows.find((r) => r.key === MESSAGING_KEY)?.value as Partial<MessagingSettings> | undefined) ?? null;
  const variationRelease = ((rows.find((r) => r.key === "wo_loop")?.value as { variationRelease?: string } | undefined)?.variationRelease === "pc") ? "pc" as const : "auto" as const;

  return (
    <>
      <h2>Campaigns</h2>
      <SubNav />
      {settings.error ? (
        <p className="partial" data-testid="funnel-load-error">The automations couldn&apos;t be loaded just now — refresh to try again.</p>
      ) : (
        <AutomationsSettings
          view="funnel"
          initial={messaging}
          initialVariationRelease={variationRelease}
          initialBrandWording={brandWordingFrom((wording.data ?? []) as BrandWordingRow[])}
          brandWordingError={wording.error ? "Paint Home wording couldn't be loaded — refresh to try again." : null}
          stats={stats.stats}
          statsError={stats.error}
        />
      )}
    </>
  );
}
