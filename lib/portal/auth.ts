import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { ensureAccount } from "@/lib/accounts/link";
import { normaliseEmail } from "@/lib/accounts/identity";
import { buildEstimateEmailHtml, emailConfigured, sendEmail } from "@/lib/messaging/send";
import { reportError } from "@/lib/monitoring/report";

/**
 * 3a-2 · Magic-link sign-in (⚑3: passwordless by default).
 *
 * SERVER ONLY. The flow:
 *   1. sendMagicLink() — service client mints a Supabase magic-link token for
 *      the email (creating the auth user if it's their first sign-in) and we
 *      email OUR OWN link — /account/auth?token_hash=… — through Resend via
 *      lib/messaging. No dependency on Supabase's SMTP or redirect allowlist,
 *      and the email is in our template and tone.
 *   2. /account/auth verifies the token against the caller's session client
 *      (verifyOtp) — clicking the link is what proves possession of the inbox.
 *   3. ensureMembership() — only THEN does the login join the account chain
 *      (the 3a-1 ruling: an unverified email typed into a form never grants
 *      access; a verified click does).
 */

const LINK_VALID_MINUTES = 60; // Supabase default magic-link expiry

/** Best-effort per-instance throttle: a serverless instance will not send
 * more than 3 links per address per hour. A durable, cross-instance limiter
 * is a named follow-up — this stops casual abuse without a migration. */
const recentSends = new Map<string, number[]>();
const SEND_LIMIT = 3;
const SEND_WINDOW_MS = 60 * 60 * 1000;

function throttled(email: string): boolean {
  const now = Date.now();
  const times = (recentSends.get(email) ?? []).filter((t) => now - t < SEND_WINDOW_MS);
  if (times.length >= SEND_LIMIT) {
    recentSends.set(email, times);
    return true;
  }
  times.push(now);
  recentSends.set(email, times);
  return false;
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/** Only ever redirect within our own site after sign-in. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/account";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/account";
  return raw;
}

export type MagicLinkResult =
  | { status: "sent" }
  | { status: "throttled" }
  | { status: "not_configured" }
  | { status: "unavailable" }
  | { status: "invalid" };

/** Mint a magic link for the address and email it. Never reveals whether an
 * account exists — the reply is the same either way. */
export async function sendMagicLink(opts: {
  email: string;
  next?: string;
  subject?: string;
  intro?: string;
  buttonLabel?: string;
}): Promise<MagicLinkResult> {
  const email = normaliseEmail(opts.email);
  if (!email || !email.includes("@") || email.length > 200) return { status: "invalid" };

  const svc = createServiceClient();
  if (!svc) return { status: "unavailable" };
  if (throttled(email)) return { status: "throttled" };

  const link = await mintMagicLink(svc, email, opts.next);
  if (!link) return { status: "unavailable" };

  if (!emailConfigured()) return { status: "not_configured" };

  const { data: companyRow } = await svc
    .from("settings").select("value").eq("key", "company_profile").maybeSingle();
  const company = (companyRow?.value ?? {}) as { name?: string; phone?: string; logoUrl?: string; logoUrlLight?: string };
  const companyName = company.name || "Paint Group";

  const intro =
    opts.intro ??
    `Here's your sign-in link. It takes you straight to your ${companyName} account — no password needed.\n\nThe link works for ${LINK_VALID_MINUTES} minutes. If it runs out, just ask for a fresh one.`;

  const sent = await sendEmail({
    to: email,
    subject: opts.subject ?? `Sign in to your ${companyName} account`,
    html: buildEstimateEmailHtml({
      intro,
      link,
      companyName,
      // Email renders on a white background — the LIGHT-background logo
      // (Settings "Logo for light backgrounds"), same rule as estimate sends.
      logoUrl: company.logoUrlLight || company.logoUrl,
      companyPhone: company.phone,
      buttonLabel: opts.buttonLabel ?? "Open my account",
    }),
  });
  if (sent.status === "not_configured") return { status: "not_configured" };
  if (sent.status === "error") {
    reportError(new Error(sent.message), { where: "portal.magicLink.send", bestEffort: true });
    return { status: "unavailable" };
  }
  return { status: "sent" };
}

/** Mint the token and return OUR verification URL (not Supabase's). Creates
 * the auth user on first sign-in — the account itself already exists from
 * the estimate save, or is created at verification time. */
async function mintMagicLink(svc: SupabaseClient, email: string, next?: string): Promise<string | null> {
  let linkRes = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (linkRes.error) {
    // First sign-in: the wizard's anonymous user carries no email, so this
    // address has no auth user yet. Create one (unconfirmed — the click
    // confirms it) and mint again.
    const created = await svc.auth.admin.createUser({ email });
    if (created.error && !/already been registered|already exists/i.test(created.error.message)) {
      reportError(created.error, { where: "portal.magicLink.createUser", bestEffort: true });
      return null;
    }
    linkRes = await svc.auth.admin.generateLink({ type: "magiclink", email });
  }
  if (linkRes.error || !linkRes.data?.properties?.hashed_token) {
    reportError(linkRes.error, { where: "portal.magicLink.generate", bestEffort: true });
    return null;
  }
  const params = new URLSearchParams({ token_hash: linkRes.data.properties.hashed_token });
  const safeNext = safeNextPath(next);
  if (safeNext !== "/account") params.set("next", safeNext);
  return `${siteUrl()}/account/auth?${params.toString()}`;
}

/**
 * Join a VERIFIED login onto its account. Called only after verifyOtp
 * succeeds. First login on an account becomes its owner; later logins join
 * as members (⚑6: schema supports many, UI stays single-user).
 */
export async function ensureMembership(userId: string, email: string): Promise<string | null> {
  const svc = createServiceClient();
  if (!svc) return null;

  const ensured = await ensureAccount(svc, { email });
  if (!ensured.accountId) return null;

  const existing = await svc
    .from("account_users").select("id").eq("account_id", ensured.accountId).eq("profile_id", userId)
    .maybeSingle();
  if (existing.data) return ensured.accountId;

  const { count } = await svc
    .from("account_users").select("id", { count: "exact", head: true })
    .eq("account_id", ensured.accountId);
  const role = (count ?? 0) === 0 ? "owner" : "member";

  const inserted = await svc.from("account_users").insert({
    account_id: ensured.accountId,
    profile_id: userId,
    role,
  });
  // 23505 = a concurrent verification already linked it — fine.
  if (inserted.error && inserted.error.code !== "23505") {
    reportError(inserted.error, { where: "portal.membership.insert", bestEffort: true });
    return null;
  }
  return ensured.accountId;
}
