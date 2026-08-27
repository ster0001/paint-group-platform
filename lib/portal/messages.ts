import { createServiceClient } from "@/lib/supabase/service";

/**
 * The portal Messages tab — the SAME conversation the estimate page's live
 * chat uses (estimate_messages, one thread per estimate). Invoices belong to
 * an estimate, so invoice questions land in the estimate's thread too: one
 * messenger, wherever the customer opens it.
 *
 * Reads/writes go through the service client scoped to PROVEN account ids
 * (the standing explicit-ownership pattern) — customers have no direct table
 * access to estimate_messages.
 */

export type PortalMessage = {
  id: string;
  direction: "staff" | "customer";
  body: string;
  author_name: string | null;
  created_at: string;
};

export type PortalThread = {
  estimateId: string;
  title: string;
  shareToken: string | null;
  /** True when the estimate has issued invoices — the thread covers both. */
  hasInvoice: boolean;
  messages: PortalMessage[];
  lastAt: string | null;
};

type ThreadEstimate = {
  id: string;
  title: string | null;
  status: string;
  share_token: string | null;
  sent_at: string | null;
  created_at: string;
};

/** Pure grouping: one thread per SENT estimate (a draft has no customer
 * document to talk about yet), newest activity first. */
export function groupThreads(
  estimates: readonly ThreadEstimate[],
  messages: readonly (PortalMessage & { estimate_id: string })[],
  invoicedEstimateIds: ReadonlySet<string>,
): PortalThread[] {
  const byEstimate = new Map<string, PortalMessage[]>();
  for (const m of messages) {
    const list = byEstimate.get(m.estimate_id) ?? [];
    list.push({ id: m.id, direction: m.direction, body: m.body, author_name: m.author_name, created_at: m.created_at });
    byEstimate.set(m.estimate_id, list);
  }
  return estimates
    .filter((e) => e.sent_at && e.status !== "draft")
    .map((e) => {
      const msgs = (byEstimate.get(e.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
      return {
        estimateId: e.id,
        title: e.title?.trim() || "Your estimate",
        shareToken: e.share_token,
        hasInvoice: invoicedEstimateIds.has(e.id),
        messages: msgs,
        lastAt: msgs.length ? msgs[msgs.length - 1].created_at : null,
      };
    })
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}

/** Threads for the accounts the caller was proven to own. */
export async function getPortalThreads(accountIds: string[]): Promise<PortalThread[]> {
  if (!accountIds.length) return [];
  const svc = createServiceClient();
  if (!svc) return [];

  const { data: estimates } = await svc
    .from("estimates")
    .select("id, title, status, share_token, sent_at, created_at")
    .in("account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (estimates ?? []) as ThreadEstimate[];
  if (!rows.length) return [];
  const estIds = rows.map((e) => e.id);

  const [{ data: messages }, { data: invoices }] = await Promise.all([
    svc.from("estimate_messages")
      .select("id, estimate_id, direction, body, author_name, created_at")
      .in("estimate_id", estIds).order("created_at").limit(500),
    svc.from("invoices").select("estimate_id").in("estimate_id", estIds),
  ]);

  return groupThreads(
    rows,
    (messages ?? []) as (PortalMessage & { estimate_id: string })[],
    new Set(((invoices ?? []) as { estimate_id: string }[]).map((i) => i.estimate_id)),
  );
}

/** Post a customer message into an estimate's thread — ownership proven
 * through the account chain first. Mirrors post_estimate_message_by_token:
 * trimmed, capped, and logged to the activity feed. */
export async function postPortalMessage(
  accountIds: string[],
  estimateId: string,
  body: string,
): Promise<"ok" | "empty" | "not_found" | "unavailable"> {
  const trimmed = body.trim().slice(0, 4000);
  if (!trimmed) return "empty";
  if (!accountIds.length) return "not_found";
  const svc = createServiceClient();
  if (!svc) return "unavailable";

  const { data: est } = await svc
    .from("estimates").select("id, account_id").eq("id", estimateId).maybeSingle();
  if (!est || !accountIds.includes(est.account_id as string)) return "not_found";

  const { error } = await svc.from("estimate_messages")
    .insert({ estimate_id: estimateId, direction: "customer", body: trimmed });
  if (error) return "unavailable";
  // Best-effort, same as the token RPC: the feed stays honest.
  await svc.from("estimate_events")
    .insert({ estimate_id: estimateId, type: "customer_message", payload: { body: trimmed } });
  return "ok";
}
