import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SubNav from "../../SubNav";
import Queue from "./Queue";

export const dynamic = "force-dynamic";

/**
 * "Waiting for you" — the mockup's approval queue.
 *
 * Nothing leaves until someone presses a button here, and pressing it re-runs
 * the guard chain against the customer as they are in that second. A message
 * queued last night for someone who accepted a quote this morning is refused
 * at the moment of approval, with the reason on screen.
 */
export default async function QueuePage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("campaign_messages")
    .select("id, account_id, template_id, step, state, reason, due_at, sent_at, enrolment_id, channel")
    .in("state", ["queued", "held", "stopped", "sent", "failed"])
    .order("due_at", { ascending: true })
    .limit(200);

  const migrationPending = !!error && /does not exist/i.test(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const accountIds = [...new Set(rows.map((r) => r.account_id as string))];
  const templateIds = [...new Set(rows.map((r) => r.template_id as string).filter(Boolean))];
  const enrolmentIds = [...new Set(rows.map((r) => r.enrolment_id as string).filter(Boolean))];

  const [{ data: accounts }, { data: templates }, { data: enrolments }] = await Promise.all([
    accountIds.length ? supabase.from("accounts").select("id, name, email").in("id", accountIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    templateIds.length ? supabase.from("campaign_templates").select("id, name, subject, approved_at").in("id", templateIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    enrolmentIds.length ? supabase.from("campaign_enrolments").select("id, campaign_id").in("id", enrolmentIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const campaignIds = [...new Set((enrolments ?? []).map((e) => e.campaign_id as string))];
  const { data: campaigns } = campaignIds.length
    ? await supabase.from("campaigns").select("id, name").in("id", campaignIds)
    : { data: [] as Record<string, unknown>[] };

  const accountOf = new Map((accounts ?? []).map((a) => [a.id as string, a]));
  const templateOf = new Map((templates ?? []).map((t) => [t.id as string, t]));
  const campaignOfEnrolment = new Map((enrolments ?? []).map((e) => [e.id as string, e.campaign_id as string]));
  const campaignName = new Map((campaigns ?? []).map((c) => [c.id as string, c.name as string]));

  const items = rows.map((r) => {
    const a = accountOf.get(r.account_id as string);
    const t = templateOf.get(r.template_id as string);
    return {
      id: r.id as string,
      accountName: (a?.name as string) || (a?.email as string) || "Unknown",
      email: (a?.email as string) ?? "",
      campaign: campaignName.get(campaignOfEnrolment.get(r.enrolment_id as string) ?? "") ?? "Campaign",
      templateName: (t?.name as string) ?? "No email",
      templateId: (r.template_id as string) ?? null,
      subject: (t?.subject as string) ?? "",
      templateApproved: t?.approved_at != null,
      step: (r.step as number) ?? 1,
      channel: (r.channel as string) === "sms" ? "sms" : "email",
      state: r.state as string,
      reason: (r.reason as string) ?? null,
    };
  });

  const waiting = items.filter((i) => i.state === "queued" || i.state === "held");
  const done = items.filter((i) => i.state !== "queued" && i.state !== "held");

  return (
    <>
      <h2>Waiting for you</h2>
      <SubNav />
      {migrationPending ? (
        <p className="partial">Run migration <b>20261209_campaign_engine</b> first.</p>
      ) : (
        <>
          <p className="sub">
            {waiting.length === 0
              ? "Nothing waiting. Messages appear here when a live campaign sweeps."
              : `${waiting.length} message${waiting.length === 1 ? "" : "s"} to approve. Nothing leaves until you say so.`}
          </p>
          <Queue waiting={waiting} done={done} />
          <p className="bhint" style={{ marginTop: 18 }}>
            Approving re-checks everything against the customer as they are right now — if they
            accepted a quote this morning, it refuses and tells you.{" "}
            <Link href="/crm/campaigns" style={{ textDecoration: "underline" }}>Campaigns</Link>
          </p>
        </>
      )}
    </>
  );
}
