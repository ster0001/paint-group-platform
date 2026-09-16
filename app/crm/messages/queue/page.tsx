import { createClient } from "@/lib/supabase/server";
import { automationByKey } from "@/lib/automations/registry";
import HoldQueue, { type HoldItem } from "./HoldQueue";


export const dynamic = "force-dynamic";

/**
 * Messages to approve (Session 1, 16 Sep 2026): every automatic job message
 * the office chose to approve first, plus anything held for quiet hours or
 * the daily cap, in one list — the campaign queue's design, for the job
 * messages. Approve / Edit then send / Skip. The Today card counts the
 * pending rows here (lib/crm/work-queue.ts buildMessageApprovalItem).
 */
export default async function MessageQueuePage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_holds")
    .select("id, automation_key, audience, account_id, contractor_id, work_order_id, estimate_id, to_email, to_phone, channels, subject, body_html, sms_body, reason, reason_detail, release_at, status, result, created_at, decided_at")
    .in("status", ["pending", "held", "sent", "skipped", "failed"])
    .order("created_at", { ascending: false })
    .limit(300);
  const migrationPending = !!error && /does not exist/i.test(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const accountIds = [...new Set(rows.map((r) => r.account_id as string | null).filter((x): x is string => !!x))];
  const contractorIds = [...new Set(rows.map((r) => r.contractor_id as string | null).filter((x): x is string => !!x))];
  const [{ data: accounts }, { data: contractors }] = await Promise.all([
    accountIds.length ? supabase.from("accounts").select("id, name, email").in("id", accountIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    contractorIds.length ? supabase.from("contractors").select("id, company_name, profiles(name)").in("id", contractorIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const accountOf = new Map((accounts ?? []).map((a) => [a.id as string, a]));
  const contractorOf = new Map((contractors ?? []).map((c) => [c.id as string, c]));

  const items: HoldItem[] = rows.map((r) => {
    const a = automationByKey(r.automation_key as string);
    const acc = accountOf.get(r.account_id as string);
    const con = contractorOf.get(r.contractor_id as string) as { company_name?: string | null; profiles?: { name?: string | null } | null } | undefined;
    const who = (acc?.name as string | null) || con?.profiles?.name || con?.company_name || (r.to_email as string | null) || (r.to_phone as string | null) || "Recipient";
    const html = (r.body_html as string | null) ?? "";
    const marked = html.match(/<!--BODY-->([\s\S]*?)<!--\/BODY-->/);
    const bodyText = htmlToText(marked ? marked[1] : html);
    return {
      id: r.id as string, key: r.automation_key as string, name: a?.name ?? (r.automation_key as string), audience: r.audience as string,
      who, accountId: (r.account_id as string | null) ?? null, workOrderId: (r.work_order_id as string | null) ?? null,
      toEmail: (r.to_email as string | null) ?? null, toPhone: (r.to_phone as string | null) ?? null,
      channels: (r.channels as string[]) ?? [], subject: (r.subject as string | null) ?? null, bodyText, hasHtml: Boolean(html),
      smsBody: (r.sms_body as string | null) ?? null, reason: r.reason as HoldItem["reason"], reasonDetail: (r.reason_detail as string | null) ?? null,
      releaseAt: (r.release_at as string | null) ?? null, status: r.status as HoldItem["status"],
      result: (r.result as Record<string, unknown> | null) ?? null, createdAt: r.created_at as string,
    };
  });
  const waiting = items.filter((i) => i.status === "pending" || i.status === "held");
  const done = items.filter((i) => i.status !== "pending" && i.status !== "held");

  return (
    <main>
      <h1 style={{ margin: "0 0 4px" }}>Messages to approve</h1>
      <p className="bhint" style={{ margin: "0 0 14px" }}>
        Automatic messages the office chose to approve first (Settings → Automations → &ldquo;Office approves first&rdquo;), and anything
        held for sending hours or the daily limit. Nothing here has gone out.
      </p>
      {migrationPending && <p className="said bad">The messages queue table is not in this database yet (migration 20270150).</p>}
      <HoldQueue waiting={waiting} done={done} />
    </main>
  );
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}
