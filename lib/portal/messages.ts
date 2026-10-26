import { reportError } from "@/lib/monitoring/report";
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
 *
 * Unread (portal UX brief G2, 25 Oct 2026): estimate_messages carries no read
 * marker, but every staff reply is mirrored into `messages` (provider portal,
 * direction out) by trigger, and `customer_thread_opened` stamps those rows
 * read when the customer opens the thread. Unread = mirrored staff replies
 * still unstamped. Opening the LIST stamps nothing — only the thread does.
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
  /** The estimate's state — the thread header wears its chip (G3). */
  status: string;
  shareToken: string | null;
  /** True when the estimate has issued invoices — the thread covers both. */
  hasInvoice: boolean;
  messages: PortalMessage[];
  lastAt: string | null;
  /** Staff replies the customer has not opened yet (G2). */
  unread: number;
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
  unreadByEstimate: ReadonlyMap<string, number> = new Map(),
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
        status: e.status,
        shareToken: e.share_token,
        hasInvoice: invoicedEstimateIds.has(e.id),
        messages: msgs,
        lastAt: msgs.length ? msgs[msgs.length - 1].created_at : null,
        unread: unreadByEstimate.get(e.id) ?? 0,
      };
    })
    .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}

/** Threads for the accounts the caller was proven to own. Reads only. */
export async function getPortalThreads(accountIds: string[]): Promise<PortalThread[]> {
  if (!accountIds.length) return [];
  const svc = createServiceClient();
  if (!svc) return [];

  const { data: estimates, error: estError } = await svc
    .from("estimates")
    .select("id, title, status, share_token, sent_at, created_at")
    .in("account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(50);
  if (estError) reportError(estError, { where: "portal.threads.estimates" });
  const rows = (estimates ?? []) as ThreadEstimate[];
  if (!rows.length) return [];
  const estIds = rows.map((e) => e.id);

  const [{ data: messages, error: msgError }, { data: invoices, error: invError }, { data: unreadRows, error: unreadError }] = await Promise.all([
    svc.from("estimate_messages")
      .select("id, estimate_id, direction, body, author_name, created_at")
      .in("estimate_id", estIds).order("created_at").limit(500),
    svc.from("invoices").select("estimate_id").in("estimate_id", estIds),
    svc.from("messages").select("estimate_id")
      .eq("provider", "portal").eq("direction", "out").is("read_at", null)
      .in("estimate_id", estIds).limit(1000),
  ]);
  if (msgError) reportError(msgError, { where: "portal.threads.messages" });
  if (invError) reportError(invError, { where: "portal.threads.invoices" });
  if (unreadError) reportError(unreadError, { where: "portal.threads.unread", bestEffort: true });

  const unread = new Map<string, number>();
  for (const r of (unreadRows ?? []) as { estimate_id: string | null }[]) {
    if (r.estimate_id) unread.set(r.estimate_id, (unread.get(r.estimate_id) ?? 0) + 1);
  }

  return groupThreads(
    rows,
    (messages ?? []) as (PortalMessage & { estimate_id: string })[],
    new Set(((invoices ?? []) as { estimate_id: string }[]).map((i) => i.estimate_id)),
    unread,
  );
}

/** Opening a thread is reading it: staff replies on THIS estimate get read_at
 * (readSource portal). Best-effort, never in the way. Ownership is the
 * caller's to prove first — the thread page only calls this for a thread it
 * found through getPortalThreads. */
export async function markPortalThreadOpened(estimateId: string): Promise<void> {
  const svc = createServiceClient();
  if (!svc) return;
  const opened = await svc.rpc("customer_thread_opened", { p_estimate_ids: [estimateId] });
  if (opened.error) reportError(opened.error, { where: "portal.threads.opened", bestEffort: true });
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
