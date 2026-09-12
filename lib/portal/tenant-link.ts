import { randomBytes } from "node:crypto";

/**
 * C15 — THE TENANT PHOTO LINK (walk A, screen A4; ⚑61).
 *
 * A token page, phone-first, no account: the tenant takes a few photos and
 * they land on the property as condition photos the estimator sees. The link
 * goes to the tenant directly and the agent sees what was sent (⚑61).
 *
 * copy:new — the message below is CUSTOMER-FACING copy proposed here for Tom
 * to read before it is ever sent. It says who we are, why we are asking, and
 * that it has nothing to do with their bond — the three things a tenant who
 * gets a text from a painter needs to hear first.
 */

export const TENANT_ASKS = [
  { key: "rooms", label: "Each room, from the doorway" },
  { key: "damage", label: "Anything damaged" },
  { key: "ceilings", label: "Ceilings" },
  { key: "openings", label: "Windows and doors" },
] as const;
export type TenantAskKey = (typeof TENANT_ASKS)[number]["key"];

export const TENANT_LINK_DAYS = 14;

export function newTenantToken(): string {
  return randomBytes(18).toString("base64url");
}

/** copy:new — the SMS. Under 320 characters so it is two segments at most. */
export function tenantMessage(input: { companyName: string; agencyName: string | null; address: string; url: string }): string {
  const who = input.agencyName ? `${input.agencyName} has asked us` : "your property manager has asked us";
  return `Hi — this is ${input.companyName}, painters. ${who} to quote some painting at ${input.address}. `
    + "Could you take a few photos on your phone so we can plan it without a visit? "
    + "It's nothing to do with your bond or your lease. "
    + `Photos go here: ${input.url}`;
}

/** copy:new — the token page's opening line, in the same voice. */
export function tenantPageIntro(companyName: string): string {
  return `We're ${companyName}, the painters. A few photos from your phone and we can plan the work without coming round first. `
    + "This has nothing to do with your bond or your lease — nobody is inspecting anything.";
}

export function tenantLinkExpired(expiresAt: string | null | undefined, now = new Date()): boolean {
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  return !Number.isFinite(t) || t < now.getTime();
}
