import { NextResponse } from "next/server";
import { z } from "zod";
import { agentActor, agentDb, displayText } from "@/lib/agent/session";
import { SupabaseAgentStore, loadAgentSettings } from "@/lib/agent/store-supabase";
import { supportHoursState } from "@/lib/agent/scope-tools";
import { CLOSED_TEXT, onDutyNumbers } from "@/lib/agent/handoff";
import { sendSms } from "@/lib/messaging/send";
import { automationOn } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { logCrmEvent } from "@/lib/crm/events";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/agent/website — the chat bubble in the corner of the online
 * estimate (Tom, 8 Sep: "add in the chat bot in the bottom left hand corner
 * so they can talk to us"). A direct line to a person: the first message
 * opens a `website` conversation and asks for a hand-off, which is the
 * card on Today AND the pop-up on every staff screen (StaffChatDock). Staff
 * answer through /api/agent/handoff; Realtime carries both directions.
 *
 *   { action: "start" }                        → the conversation (resumed if open)
 *   { action: "say", conversationId, text }    → the customer's line; requests a person if none is on
 *
 * Outside support hours the reply is the closed script with the next
 * opening, and the message still waits on Today for the morning. The
 * assistant model is deliberately not in this loop yet.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), conversationId: z.string().uuid().optional() }),
  z.object({ action: z.literal("say"), conversationId: z.string().uuid(), text: z.string().trim().min(1).max(2000) }),
]);

const GREETING = "Hi — you're talking to Paint Group. Ask us anything about your estimate and one of the team will answer here. You can keep filling in the questions while you wait.";

export async function POST(request: Request) {
  const actor = await agentActor();
  if (!actor) return NextResponse.json({ error: "Start the estimate first." }, { status: 403 });
  const db = agentDb();
  if (!db) return NextResponse.json({ error: "Chat isn't available just now." }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const body = parsed.data;
  const store = new SupabaseAgentStore(db);

  const snapshot = async (id: string) => {
    const [conv, messages, handoff] = await Promise.all([store.getConversation(id), store.listMessages(id), store.openHandoff(id)]);
    return {
      conversationId: id, status: conv?.status ?? "open", handoff: handoff ? { status: handoff.status } : null,
      transcript: messages.filter((m) => m.role !== "system").map((m) => ({ id: m.id, role: m.role, text: displayText(m.content), createdAt: m.createdAt })),
    };
  };
  const own = async (id: string) => {
    const conv = await store.getConversation(id);
    return conv && conv.createdBy === actor.userId ? conv : null;
  };

  try {
    // The account behind this visitor, if the wizard has one (a verified
    // member, or a draft that reached the contact page) — so the chat opens
    // their CRM record for staff (Tom, 8 Sep).
    const accountFor = async (): Promise<string | null> => {
      if (actor.verifiedEmail) {
        const { data } = await db.from("accounts").select("id").eq("email", actor.verifiedEmail).maybeSingle();
        if ((data as { id?: string } | null)?.id) return (data as { id: string }).id;
      }
      const { data: d } = await db.from("wizard_drafts").select("account_id").eq("user_id", actor.userId).not("account_id", "is", null).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
      return (d as { account_id?: string | null } | null)?.account_id ?? null;
    };

    if (body.action === "start") {
      const existing = body.conversationId ? await own(body.conversationId) : null;
      if (existing && existing.status !== "closed") {
        if (!existing.accountId) {
          const acct = await accountFor();
          if (acct) await db.from("agent_conversations").update({ account_id: acct }).eq("id", existing.id);
        }
        return NextResponse.json(await snapshot(existing.id));
      }
      const accountId = await accountFor();
      const conv = await store.createConversation({ accountId, propertyId: null, estimateId: null, channel: "website", mode: "support", view: "customer", createdBy: actor.userId, anonToken: null, externalThreadId: null });
      await store.appendMessage({ conversationId: conv.id, role: "assistant", content: GREETING, modelId: null, tokensIn: 0, tokensOut: 0 });
      return NextResponse.json(await snapshot(conv.id));
    }

    const conv = await own(body.conversationId);
    if (!conv) return NextResponse.json({ error: "No such conversation." }, { status: 404 });
    if (conv.status === "closed") return NextResponse.json({ error: "This chat has ended — start a new one." }, { status: 409 });
    if (!conv.accountId) {
      const acct = await accountFor();
      if (acct) await db.from("agent_conversations").update({ account_id: acct }).eq("id", conv.id);
    }
    await store.appendMessage({ conversationId: conv.id, role: "user", content: body.text, modelId: null, tokensIn: 0, tokensOut: 0 });

    const open = await store.openHandoff(conv.id);
    if (!open) {
      const settings = await loadAgentSettings(db);
      const now = new Date();
      const hours = supportHoursState(settings.supportHours, now);
      // In or out of hours the request is filed — the office answers when it
      // opens. Out of hours the customer is told so, honestly.
      await store.requestHandoff(conv.id, "customer_asked");
      if (!hours.open) {
        await store.appendMessage({ conversationId: conv.id, role: "assistant", content: CLOSED_TEXT(hours.nextOpening), modelId: null, tokensIn: 0, tokensOut: 0 });
      } else {
        const { onDuty } = onDutyNumbers(settings.supportHours, now);
        if (onDuty.length && automationOn((await loadMessaging(db)).messaging, "assistant_handoff")) {
          await Promise.all(onDuty.map((n) => sendSms({ to: n, body: "Paint Group: a customer is chatting from the online estimate and waiting for a person. The chat is in the corner of every staff screen." }).catch(() => undefined)));
        }
      }
      // The session's own record: "asked to talk to a person" on the timeline.
      const { data: draft } = await db.from("wizard_drafts").select("id, account_id, estimate_id").eq("user_id", actor.userId).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
      if (draft) {
        await db.from("wizard_drafts").update({ outcome: "question_asked", outcome_at: now.toISOString(), outcome_note: body.text.slice(0, 600), bucket: "needs_help" }).eq("id", draft.id).is("converted_at", null);
        await logCrmEvent(db, {
          type: "wizard_question_asked", source: "customer", accountId: (draft.account_id as string | null) ?? conv.accountId, estimateId: (draft.estimate_id as string | null) ?? null,
          payload: { note: body.text.slice(0, 600), page: "Chat" }, dedupeKey: `website-chat:${conv.id}`,
        });
      }
    }
    return NextResponse.json(await snapshot(conv.id));
  } catch (e) {
    reportError(e, { where: "agent.website", bestEffort: true });
    return NextResponse.json({ error: "That didn't go through — try again." }, { status: 500 });
  }
}
