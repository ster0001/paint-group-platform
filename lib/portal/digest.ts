/**
 * Trade portal v2 · Session 6 — the daily digest (⚑11, 31 Aug):
 *   · ON by default at 17:00 Melbourne for admin/approver (and owner — the
 *     legacy first-login role carries admin rights), OFF for finance/viewer;
 *   · a person's own notification_prefs row overrides both the switch and
 *     the hour;
 *   · a digest only sends when at least one in-scope property has a NEW
 *     event since that person's last digest — never an empty email;
 *   · approval-needed notifications are separate and immediate (the send /
 *     decide flows), untouched by any of this.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { isTestEmail } from "@/lib/accounts/identity";
import { sendEmail } from "@/lib/messaging/send";

export type DigestPrefs = { digest_enabled: boolean | null; digest_time: string | null } | null;

export function effectiveDigest(role: string, prefs: DigestPrefs): { enabled: boolean; hour: number } {
  const roleDefault = role === "admin" || role === "approver" || role === "owner";
  const enabled = prefs?.digest_enabled ?? roleDefault;
  const hour = prefs?.digest_time ? Number(prefs.digest_time.slice(0, 2)) : 17;
  return { enabled, hour: Number.isFinite(hour) ? hour : 17 };
}

const EVENT_LABELS: Record<string, string> = {
  surface_tick: "work ticked off on site",
  stage_changed: "the job moved forward",
  colour_record_update: "a colour was updated",
  approved_over_limit: "an over-limit approval",
  variation_raised: "a variation was raised",
};

export type DigestLine = { address: string; count: number; summary: string };
export type DigestPlan = {
  email: string;
  accountUserId: string;
  orgName: string;
  lines: DigestLine[];
};

export function buildDigestEmail(orgName: string, lines: DigestLine[], origin: string): { subject: string; html: string } {
  const total = lines.reduce((n, l) => n + l.count, 0);
  return {
    subject: `Today across your properties — ${total} update${total === 1 ? "" : "s"}`,
    html: [
      `<p>Today's movement across ${escapeHtml(orgName)}'s properties:</p>`,
      "<ul>",
      ...lines.map((l) => `<li><b>${escapeHtml(l.address)}</b> — ${l.count} update${l.count === 1 ? "" : "s"}${l.summary ? ` (${escapeHtml(l.summary)})` : ""}</li>`),
      "</ul>",
      `<p><a href="${origin}/account">Open your workspace</a> for the full story, photos and all.</p>`,
      `<p>Paint Group</p>`,
    ].join("\n"),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * One pass, called by the cron at a given Melbourne hour. Returns the plan
 * (who would get what); dryRun skips both the emails and the
 * last_digest_at stamps so a test run never eats the day's digest.
 */
export async function runTradeDigest(opts: { melbourneHour: number; origin: string; dryRun?: boolean }): Promise<DigestPlan[]> {
  const svc = createServiceClient();
  if (!svc) return [];

  // MEMBER-driven, never org-driven: the volume dataset carries hundreds of
  // trade accounts and tens of thousands of estimates, and an org-wide
  // .in() truncates at the row cap (found live on C1: plans came back
  // empty). Only people with seats can receive a digest — start from them.
  const { data: membersData } = await svc.from("account_users")
    .select("id, account_id, profile_id, role, property_scope");
  const allMembers = (membersData ?? []) as Array<{ id: string; account_id: string; profile_id: string; role: string; property_scope: string[] | null }>;
  if (!allMembers.length) return [];

  const { data: prefsData } = await svc.from("notification_prefs")
    .select("account_user_id, digest_enabled, digest_time, last_digest_at")
    .in("account_user_id", allMembers.map((m) => m.id));
  const prefsByMember = new Map(((prefsData ?? []) as Array<{ account_user_id: string; digest_enabled: boolean | null; digest_time: string | null; last_digest_at: string | null }>)
    .map((p) => [p.account_user_id, p]));

  const members = allMembers.filter((m) => {
    const eff = effectiveDigest(m.role, prefsByMember.get(m.id) ?? null);
    return eff.enabled && eff.hour === opts.melbourneHour;
  });
  if (!members.length) return [];

  // Only the qualifying members' orgs get read — and only TRADE ones digest.
  const orgIds = [...new Set(members.map((m) => m.account_id))];
  const [orgsRes, propsRes, estsRes] = await Promise.all([
    svc.from("accounts").select("id, name, account_type").in("id", orgIds).eq("account_type", "trade"),
    svc.from("properties").select("id, account_id, address, suburb").in("account_id", orgIds),
    svc.from("estimates").select("id, account_id, property_id").in("account_id", orgIds).not("property_id", "is", null),
  ]);
  const orgs = (orgsRes.data ?? []) as Array<{ id: string; name: string | null }>;
  const tradeOrgIds = new Set(orgs.map((o) => o.id));
  const properties = (propsRes.data ?? []) as Array<{ id: string; account_id: string; address: string | null; suburb: string | null }>;
  const estimates = (estsRes.data ?? []) as Array<{ id: string; account_id: string; property_id: string }>;

  const estIds = estimates.map((e) => e.id);
  const wosRes = estIds.length
    ? await svc.from("work_orders").select("id, estimate_id").in("estimate_id", estIds)
    : { data: [] };
  const wos = (wosRes.data ?? []) as Array<{ id: string; estimate_id: string }>;
  const propertyOfEstimate = new Map(estimates.map((e) => [e.id, e.property_id]));
  const propertyOfWo = new Map(wos.map((w) => [w.id, propertyOfEstimate.get(w.estimate_id) ?? null]));
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const eventsRes = wos.length
    ? await svc.from("wo_events").select("work_order_id, type, created_at")
        .in("work_order_id", wos.map((w) => w.id)).gt("created_at", since24h)
    : { data: [] };
  const events = (eventsRes.data ?? []) as Array<{ work_order_id: string; type: string; created_at: string }>;

  const addressOf = new Map(properties.map((p) => [p.id, [p.address, p.suburb].filter(Boolean).join(", ") || "Property"]));
  const plans: DigestPlan[] = [];

  for (const m of members) {
    if (!tradeOrgIds.has(m.account_id)) continue;
    const prefs = prefsByMember.get(m.id) ?? null;

    const scope = m.property_scope
      ? new Set(m.property_scope)
      : new Set(properties.filter((p) => p.account_id === m.account_id).map((p) => p.id));
    const since = prefs?.last_digest_at ?? since24h;

    const byProperty = new Map<string, { count: number; types: Set<string> }>();
    for (const ev of events) {
      if (ev.created_at <= since) continue;
      const pid = propertyOfWo.get(ev.work_order_id);
      if (!pid || !scope.has(pid)) continue;
      const c = byProperty.get(pid) ?? { count: 0, types: new Set<string>() };
      c.count += 1;
      c.types.add(ev.type);
      byProperty.set(pid, c);
    }
    if (!byProperty.size) continue; // no empty digests, ever

    const { data: user } = await svc.auth.admin.getUserById(m.profile_id);
    const email = user?.user?.email;
    if (!email) continue;

    const lines: DigestLine[] = [...byProperty.entries()].map(([pid, c]) => ({
      address: addressOf.get(pid) ?? "Property",
      count: c.count,
      summary: [...c.types].map((t) => EVENT_LABELS[t] ?? "").filter(Boolean).slice(0, 2).join(", "),
    })).sort((a, b) => b.count - a.count);

    const org = orgs.find((o) => o.id === m.account_id);
    plans.push({ email, accountUserId: m.id, orgName: org?.name?.trim() || "your organisation", lines });

    if (!opts.dryRun) {
      if (!isTestEmail(email)) {
        const msg = buildDigestEmail(org?.name?.trim() || "your organisation", lines, opts.origin);
        await sendEmail({ to: email, subject: msg.subject, html: msg.html }).catch(() => {});
      }
      await svc.from("notification_prefs").upsert(
        { account_user_id: m.id, last_digest_at: new Date().toISOString() },
        { onConflict: "account_user_id" },
      );
    }
  }
  return plans;
}
