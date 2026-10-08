import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { suburbOnly } from "@/lib/scheduling/offers";
import { MESSAGE_BUCKET, notifyLine, painterJobLabel, type MessageMode, type MessageSide } from "./messageModel";

/**
 * Reading a project's messages (Tom, 9 Oct 2026) — SERVER ONLY. Every read
 * goes through the CALLER's session, so RLS decides what comes back: staff
 * see every thread, a painter only their own on a job they are on. Photo
 * links are signed through the same session (the bucket's policies ask the
 * same question), never the service key.
 */

/** The newest this many messages are shown; older ones are said, not dropped silently. */
export const THREAD_PAGE = 100;
const PHOTO_TTL_SECONDS = 3600;

export type ThreadPhoto = { path: string; url: string };
export type ThreadMessage = {
  id: string; side: MessageSide; authorName: string; body: string; at: string;
  photos: ThreadPhoto[];
  /** Staff mode only — what telling the painter came to. Never put in a painter's page. */
  notify: string | null;
};
export type ThreadView = {
  threadId: string | null;
  workOrderId: string;
  contractorId: string;
  messages: ThreadMessage[];
  /** Older messages exist beyond THREAD_PAGE. */
  more: boolean;
  /** Something the other side wrote that this side has not read. */
  unread: boolean;
  failure: string | null;
};

type MessageRow = {
  id: string; author_kind: MessageSide; author_name: string; body: string; photo_paths: string[];
  notify_status: string | null; notify_detail: string; created_at: string;
};

export async function loadThread(db: SupabaseClient, workOrderId: string, contractorId: string, mode: MessageMode): Promise<ThreadView> {
  const view: ThreadView = { threadId: null, workOrderId, contractorId, messages: [], more: false, unread: false, failure: null };
  const { data: t, error: tErr } = await db.from("wo_message_threads")
    .select("id, staff_unread, painter_unread")
    .eq("work_order_id", workOrderId).eq("contractor_id", contractorId).maybeSingle();
  if (tErr) return { ...view, failure: `Couldn't read the messages: ${tErr.message}` };
  if (!t) return view;
  const thread = t as { id: string; staff_unread: boolean; painter_unread: boolean };
  view.threadId = thread.id;
  view.unread = mode === "staff" ? thread.staff_unread : thread.painter_unread;

  const { data: rows, error } = await db.from("wo_messages")
    .select("id, author_kind, author_name, body, photo_paths, notify_status, notify_detail, created_at")
    .eq("thread_id", thread.id).order("created_at", { ascending: false }).limit(THREAD_PAGE + 1);
  if (error) return { ...view, failure: `Couldn't read the messages: ${error.message}` };
  const list = (rows ?? []) as MessageRow[];
  view.more = list.length > THREAD_PAGE;
  const shown = list.slice(0, THREAD_PAGE).reverse();

  const paths = shown.flatMap((m) => m.photo_paths);
  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed, error: signErr } = await db.storage.from(MESSAGE_BUCKET).createSignedUrls(paths, PHOTO_TTL_SECONDS);
    if (signErr) view.failure = `The photos couldn't be loaded: ${signErr.message}`;
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  view.messages = shown.map((m) => ({
    id: m.id, side: m.author_kind, authorName: m.author_name, body: m.body, at: m.created_at,
    photos: m.photo_paths.flatMap((p) => { const url = urlByPath.get(p); return url ? [{ path: p, url }] : []; }),
    notify: mode === "staff" && m.author_kind === "staff" ? notifyLine(m.notify_status, m.notify_detail) : null,
  }));
  return view;
}

export type JobPainter = {
  contractorId: string; name: string;
  /** Lead (the work order's painter or the lead assignment), Crew, or Earlier (a thread from before they left the job). */
  role: "Lead" | "Crew" | "Earlier";
  onJob: boolean;
  unread: boolean;
};

/**
 * Who the office can write to on this job — one thread per painter: the job's
 * painter, everyone assigned to it, and anyone who already has a thread here
 * (a painter taken off the job keeps their history readable, but can't be
 * written to — wo_message_post refuses a painter who isn't on the job).
 */
export async function loadJobPainters(db: SupabaseClient, workOrderId: string, leadContractorId: string | null): Promise<{ painters: JobPainter[]; failure: string | null }> {
  type Named = { company_name: string | null; profiles: { name: string | null } | null } | null;
  const nameOf = (c: Named) => (c?.profiles?.name || c?.company_name || "Painter").trim();
  const [assignRes, threadRes, leadRes] = await Promise.all([
    db.from("wo_assignments").select("contractor_id, is_lead, status, contractors(company_name, profiles(name))")
      .eq("work_order_id", workOrderId).neq("status", "released"),
    db.from("wo_message_threads").select("contractor_id, staff_unread, contractors(company_name, profiles(name))")
      .eq("work_order_id", workOrderId),
    leadContractorId
      ? db.from("contractors").select("id, company_name, profiles(name)").eq("id", leadContractorId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const failure = [assignRes.error, threadRes.error, leadRes.error].flatMap((e) => (e ? [e.message] : [])).join(" · ") || null;
  const out = new Map<string, JobPainter>();
  if (leadContractorId) {
    out.set(leadContractorId, { contractorId: leadContractorId, name: nameOf(leadRes.data as Named), role: "Lead", onJob: true, unread: false });
  }
  for (const a of (assignRes.data ?? []) as unknown as { contractor_id: string; is_lead: boolean; contractors: Named }[]) {
    const had = out.get(a.contractor_id);
    out.set(a.contractor_id, { contractorId: a.contractor_id, name: nameOf(a.contractors), role: had?.role === "Lead" || a.is_lead ? "Lead" : "Crew", onJob: true, unread: false });
  }
  for (const t of (threadRes.data ?? []) as unknown as { contractor_id: string; staff_unread: boolean; contractors: Named }[]) {
    const had = out.get(t.contractor_id);
    out.set(t.contractor_id, had
      ? { ...had, unread: t.staff_unread }
      : { contractorId: t.contractor_id, name: nameOf(t.contractors), role: "Earlier", onJob: false, unread: t.staff_unread });
  }
  return { painters: [...out.values()], failure: failure ? `Couldn't read who is on this job: ${failure}` : null };
}

/** Whose thread the job page opens on: the one asked for, else one with something unread, else the lead. */
export function pickPainter(painters: readonly JobPainter[], asked: string | null | undefined): string | null {
  if (asked && painters.some((p) => p.contractorId === asked)) return asked;
  return painters.find((p) => p.unread)?.contractorId ?? painters.find((p) => p.role === "Lead")?.contractorId ?? painters[0]?.contractorId ?? null;
}

export type MyThread = {
  threadId: string; workOrderId: string; label: string; lastAt: string | null;
  lastLine: string; unread: number;
};

/**
 * The painter's Messages box: their threads, newest first, each named by its
 * PROJECT — job ref and suburb, nothing else. The thread list (and which jobs
 * they may see) comes from wo_my_message_threads through their own session;
 * the job's location is then looked up for exactly those jobs and reduced to
 * the suburb here, so no street, customer name or contact detail reaches the
 * painter's browser (the privacy gate lives in the server render).
 */
export async function loadMyThreads(db: SupabaseClient): Promise<{ threads: MyThread[]; failure: string | null }> {
  const { data, error } = await db.rpc("wo_my_message_threads");
  if (error) return { threads: [], failure: `Couldn't read your messages: ${error.message}` };
  const rows = (data ?? []) as {
    thread_id: string; work_order_id: string; wo_ref: string; last_message_at: string | null;
    last_author_kind: MessageSide | null; last_body: string | null; last_photo_count: number; unread: number;
  }[];
  if (rows.length === 0) return { threads: [], failure: null };

  const suburbs = new Map<string, string>();
  let failure: string | null = null;
  const service = createServiceClient();
  if (service) {
    const { data: wos, error: wErr } = await service.from("work_orders").select("id, wo_snapshot")
      .in("id", rows.map((r) => r.work_order_id));
    if (wErr) failure = `Couldn't read where your jobs are: ${wErr.message}`;
    for (const w of (wos ?? []) as { id: string; wo_snapshot: { jobAddress?: string } | null }[]) {
      suburbs.set(w.id, suburbOnly(w.wo_snapshot?.jobAddress));
    }
  }
  return {
    failure,
    threads: rows.map((r) => {
      const said = (r.last_body ?? "").trim() || (r.last_photo_count ? `📷 ${r.last_photo_count} photo${r.last_photo_count === 1 ? "" : "s"}` : "");
      return {
        threadId: r.thread_id, workOrderId: r.work_order_id,
        label: painterJobLabel(r.wo_ref, suburbs.get(r.work_order_id) ?? ""),
        lastAt: r.last_message_at,
        lastLine: said ? `${r.last_author_kind === "painter" ? "You: " : "Office: "}${said}` : "",
        unread: r.unread,
      };
    }),
  };
}
