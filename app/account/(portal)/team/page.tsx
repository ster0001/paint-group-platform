import { redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import { viewerTradeRole } from "@/lib/portal/approvalData";
import { createServiceClient } from "@/lib/supabase/service";
import { effectiveDigest } from "@/lib/portal/digest";
import { moneyFmt } from "@/lib/portal/money";
import { InviteForm, MemberPrefs, type TeamMember } from "./TeamClient";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "Admin", admin: "Admin", approver: "Approver", viewer: "Viewer",
  finance: "Finance — invoices only", member: "Member",
};

/**
 * Session 6 · Team (§5.7): seats, per-user property scope, approval limits,
 * and who gets which notifications. Admin only.
 */
export default async function TeamPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");
  const trade = ctx.accounts.find((a) => a.account_type === "trade");
  if (!trade) redirect("/account");
  const role = await viewerTradeRole(ctx);
  if (role === "finance") redirect("/account/money");

  const isAdmin = role === "admin" || role === "owner";
  const orgName = trade.name?.trim() || "Your organisation";

  if (!isAdmin) {
    return (
      <div>
        <div className="greet">{orgName}</div>
        <h1>Team</h1>
        <div className="card" data-testid="team-not-admin">
          <p className="sub" style={{ margin: 0 }}>
            Seats and notification routing live with your organisation&apos;s admin.
          </p>
        </div>
      </div>
    );
  }

  const svc = createServiceClient();
  if (!svc) redirect("/account");
  const [{ data: memberRows }, { data: prefRows }] = await Promise.all([
    svc.from("account_users")
      .select("id, profile_id, role, property_scope, approval_limit_cents, profiles(name)")
      .eq("account_id", trade.id).order("created_at"),
    svc.from("notification_prefs").select("account_user_id, digest_enabled, digest_time, approvals_channel, invoices_email"),
  ]);
  const prefsBy = new Map(((prefRows ?? []) as Array<{ account_user_id: string; digest_enabled: boolean | null; digest_time: string | null; approvals_channel: string; invoices_email: string | null }>)
    .map((p) => [p.account_user_id, p]));
  const addressOf = new Map(ctx.properties.map((p) => [p.id, [p.address, p.suburb].filter(Boolean).join(", ")]));

  const members: TeamMember[] = [];
  for (const m of (memberRows ?? []) as Array<{ id: string; profile_id: string; role: string; property_scope: string[] | null; approval_limit_cents: number | null; profiles: { name: string | null } | { name: string | null }[] | null }>) {
    const { data: user } = await svc.auth.admin.getUserById(m.profile_id);
    const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    const prefs = prefsBy.get(m.id) ?? null;
    const eff = effectiveDigest(m.role, prefs ? { digest_enabled: prefs.digest_enabled, digest_time: prefs.digest_time } : null);
    members.push({
      accountUserId: m.id,
      name: prof?.name?.trim() || user?.user?.email?.split("@")[0] || "Team member",
      email: user?.user?.email ?? "",
      role: ROLE_LABEL[m.role] ?? m.role,
      scopeLabel: m.property_scope
        ? `${m.property_scope.length} propert${m.property_scope.length === 1 ? "y" : "ies"} · ${m.property_scope.map((id) => addressOf.get(id)).filter(Boolean).slice(0, 2).join(", ")}`
        : "All properties",
      limitLabel: m.approval_limit_cents != null ? `approves to ${moneyFmt(m.approval_limit_cents)}` : null,
      isYou: m.profile_id === ctx.userId,
      digest: prefs ? (prefs.digest_enabled === null ? "default" : prefs.digest_enabled ? "on" : "off") : "default",
      digestOnByDefault: effectiveDigest(m.role, null).enabled,
      digestTime: prefs?.digest_time?.slice(0, 5) ?? "17:00",
      approvalsChannel: (prefs?.approvals_channel as TeamMember["approvalsChannel"]) ?? "email",
      invoicesEmail: prefs?.invoices_email ?? "",
      // effectiveDigest keeps the ruling in one place; eff itself is unused
      // beyond the default label above.
      ...(eff ? {} : {}),
    });
  }

  return (
    <div>
      <div className="greet">{orgName}</div>
      <h1>Team</h1>

      <div className="card" style={{ marginTop: 14 }} data-testid="team-list">
        <h3 style={{ marginTop: 0 }}>People</h3>
        {members.map((m, i) => (
          <div key={m.accountUserId} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>{m.name}</b>{m.email ? <span className="sub" style={{ fontSize: 12 }}> · {m.email}</span> : null}
              <div className="refline">
                {m.role} · {m.scopeLabel}{m.limitLabel ? ` · ${m.limitLabel}` : ""}
              </div>
            </div>
            {m.isYou ? <span className="chip cyan nodot">You</span> : <span className="chip mut nodot">Active</span>}
            <MemberPrefs m={m} />
          </div>
        ))}
      </div>

      <InviteForm properties={ctx.properties.map((p) => ({ id: p.id, address: [p.address, p.suburb].filter(Boolean).join(", ") || "Property" }))} />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>How updates flow</h3>
        <p className="sub" style={{ margin: 0 }}>
          Daily site updates go out as a 5 pm digest to admins and approvers — only on days
          something actually happened. Approvals needed always go straight away. Each person&apos;s
          routing is editable above.
        </p>
      </div>
    </div>
  );
}
