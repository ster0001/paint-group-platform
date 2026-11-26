import { NextResponse } from "next/server";
import { z } from "zod";
import { agentActor, agentDb, displayText } from "@/lib/agent/session";
import { SupabaseAgentStore, loadAgentSettings } from "@/lib/agent/store-supabase";
import { supportHoursState } from "@/lib/agent/scope-tools";
import { CLOSED_CONTACT_TEXT, CLOSED_TEXT, CONTACT_ASK_TEXT, CONTACT_THANKS_TEXT, isContactAsk, isContactThanks, onDutyNumbers, websiteGreeting } from "@/lib/agent/handoff";
import { extractContact, findAuPhone } from "@/lib/agent/contactCapture";
import { ensureAccount } from "@/lib/accounts/link";
import { logRequestEvent } from "@/lib/staff/requestAlerts";
import { leadKey } from "@/lib/marketing/success";
import { allowTokenRoute, clientIpFromHeaders } from "@/lib/security/tokenRouteLimit";
import { wizardBrandName } from "@/lib/wizard/brandServer";
import { sendAutomation } from "@/lib/automations/dispatch";
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
 *   { action: "contact", conversationId, name?, email, phone } → the details, from the chat's own form
 *
 * Outside support hours the reply is the closed script with the next
 * opening, and the message still waits on Today for the morning. The
 * assistant model is deliberately not in this loop yet.
 *
 * Contact details (Tom, 26 Nov 2026): when the account behind the visitor has
 * no email AND phone, the chat asks for them once — in hours while a person
 * picks it up, out of hours in the closed reply itself. They arrive through
 * the form in the chat, or typed into a message (lib/agent/contactCapture.ts).
 * A NEW capture files the account (ensureAccount), links the conversation,
 * writes a `website_chat` request event, thanks them — and the response
 * carries `lead`, a hash of the mobile, so the page counts ONE conversion
 * (lib/marketing/success.ts countLeadKey). Details already on file: no ask,
 * no capture, no `lead`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), conversationId: z.string().uuid().optional(), brand: z.enum(["paintgroup", "painthome"]).optional() }),
  z.object({ action: z.literal("say"), conversationId: z.string().uuid(), text: z.string().trim().min(1).max(2000) }),
  z.object({
    action: z.literal("contact"), conversationId: z.string().uuid(),
    name: z.string().trim().max(120).optional(),
    email: z.string().trim().email("That email doesn't look right.").max(200),
    phone: z.string().trim().min(8, "Please give us your mobile number.").max(30),
  }),
]);

export async function POST(request: Request) {
  const actor = await agentActor();
  if (!actor) return NextResponse.json({ error: "Start the estimate first." }, { status: 403 });
  const db = agentDb();
  if (!db) return NextResponse.json({ error: "Chat isn't available just now." }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.find((i) => i.path[0] === "email" || i.path[0] === "phone")?.message ?? "Bad request." }, { status: 400 });
  const body = parsed.data;
  if (body.action === "contact" && !allowTokenRoute(clientIpFromHeaders((n) => request.headers.get(n)))) return NextResponse.json({ error: "Too many requests — give it a minute." }, { status: 429 });
  const store = new SupabaseAgentStore(db);

  // Email AND phone on the account behind this chat. A read that fails is "known": the chat never nags, and
  // never counts a conversion, on a guess (reported, not swallowed).
  const contactKnown = async (accountId: string | null): Promise<boolean> => {
    if (!accountId) return false;
    const { data, error } = await db.from("accounts").select("email, phone").eq("id", accountId).maybeSingle();
    if (error) { reportError(new Error(`agent.website contactKnown: ${error.message}`), { where: "agent.website", bestEffort: true }); return true; }
    const a = data as { email?: string | null; phone?: string | null } | null;
    return Boolean(a?.email?.trim() && a?.phone?.trim());
  };
  const snapshot = async (id: string, lead: string | null = null) => {
    const [conv, messages, handoff] = await Promise.all([store.getConversation(id), store.listMessages(id), store.openHandoff(id)]);
    return {
      conversationId: id, status: conv?.status ?? "open", handoff: handoff ? { status: handoff.status } : null,
      contactNeeded: !messages.some((m) => m.role === "assistant" && isContactThanks(displayText(m.content))) && !(await contactKnown(conv?.accountId ?? null)),
      asked: messages.some((m) => m.role === "assistant" && isContactAsk(displayText(m.content))),
      lead,
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

    const capturedHere = async (convId: string) => (await store.listMessages(convId)).some((m) => m.role === "assistant" && isContactThanks(displayText(m.content)));
    // A new capture: the account, the conversation linked to it, the office told, a thank-you. Returns the lead key.
    const capture = async (convId: string, c: { email: string; phone: string; name?: string | null }): Promise<string | null> => {
      const { accountId } = await ensureAccount(db, { email: c.email, phone: c.phone, name: c.name?.trim() || null });
      if (!accountId) return null;
      const { error } = await db.from("agent_conversations").update({ account_id: accountId }).eq("id", convId);
      if (error) throw new Error(`agent.website link account: ${error.message}`);
      await logRequestEvent(db, {
        type: "website_chat", source: "customer", accountId,
        payload: { excerpt: "Left their name, email and mobile in the website chat", answered: false },
        dedupeKey: `chat-contact:${convId}`,
      });
      const first = c.name?.trim().split(/\s+/)[0] || null;
      await store.appendMessage({ conversationId: convId, role: "assistant", content: CONTACT_THANKS_TEXT(first), modelId: null, tokensIn: 0, tokensOut: 0 });
      return leadKey(c.phone);
    };

    if (body.action === "contact") {
      const conv = await own(body.conversationId);
      if (!conv) return NextResponse.json({ error: "No such conversation." }, { status: 404 });
      if (conv.status === "closed") return NextResponse.json({ error: "This chat has ended — start a new one." }, { status: 409 });
      const phone = findAuPhone(body.phone);
      if (!phone) return NextResponse.json({ error: "That number doesn't look right — an Australian mobile, please." }, { status: 400 });
      if (await capturedHere(conv.id) || await contactKnown(conv.accountId ?? (await accountFor()))) return NextResponse.json(await snapshot(conv.id));
      const lead = await capture(conv.id, { email: body.email, phone, name: body.name });
      if (!lead) return NextResponse.json({ error: "That didn't save — try again, or ring us." }, { status: 500 });
      return NextResponse.json(await snapshot(conv.id, lead));
    }

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
      await store.appendMessage({ conversationId: conv.id, role: "assistant", // Part B (26 Nov 2026): the greeting names the shopfront the visitor is on — the request's host,
        // or the brand the wizard says it is wearing (a ?brand=painthome preview on another host).
        content: websiteGreeting(await wizardBrandName(body.brand)), modelId: null, tokensIn: 0, tokensOut: 0 });
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
    const linked = (await store.getConversation(conv.id))?.accountId ?? null;
    let needContact = !(await capturedHere(conv.id)) && !(await contactKnown(linked));

    const open = await store.openHandoff(conv.id);
    if (!open) {
      const settings = await loadAgentSettings(db);
      const now = new Date();
      const hours = supportHoursState(settings.supportHours, now);
      // In or out of hours the request is filed — the office answers when it
      // opens. Out of hours the customer is told so, honestly.
      await store.requestHandoff(conv.id, "customer_asked");
      if (!hours.open) {
        // Out of hours with no details: the closed reply asks for them (Tom, 26 Nov 2026), instead of a slot.
        await store.appendMessage({ conversationId: conv.id, role: "assistant", content: needContact ? CLOSED_CONTACT_TEXT(hours.nextOpening) : CLOSED_TEXT(hours.nextOpening), modelId: null, tokensIn: 0, tokensOut: 0 });
      } else {
        const { onDuty } = onDutyNumbers(settings.supportHours, now);
        if (onDuty.length) {
          await Promise.all(onDuty.map((n) => sendAutomation(db, {
            key: "assistant_handoff", to: { phone: n }, ctx: { kind: "assistant_handoff" },
            sms: { body: "Paint Group: a customer is chatting from the online estimate and waiting for a person. The chat is in the corner of every staff screen." },
          }).catch(() => undefined)));
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
    // Their details, typed into the chat — or, if they have not given them yet, the question (once).
    let lead: string | null = null;
    if (needContact) {
      const lines = await store.listMessages(conv.id);
      const found = extractContact(lines.filter((m) => m.role === "user").map((m) => displayText(m.content)));
      if (found) { lead = await capture(conv.id, found); needContact = !lead; }
      else if (!lines.some((m) => m.role === "assistant" && isContactAsk(displayText(m.content)))) {
        await store.appendMessage({ conversationId: conv.id, role: "assistant", content: CONTACT_ASK_TEXT, modelId: null, tokensIn: 0, tokensOut: 0 });
      }
    }
    return NextResponse.json(await snapshot(conv.id, lead));
  } catch (e) {
    reportError(e, { where: "agent.website", bestEffort: true });
    return NextResponse.json({ error: "That didn't go through — try again." }, { status: 500 });
  }
}
