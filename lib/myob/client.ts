// SERVER ONLY — authenticated calls into the MYOB API, with automatic
// access-token refresh (MYOB access tokens live ~20 minutes; refresh tokens
// ROTATE on every use, so every refresh must be persisted immediately).
//
// MYOB Business (cloud) files are served by the AccountRight API surface at
// api.myob.com/accountright — no company-file password header is needed for
// cloud files (that header is a desktop-file relic).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MYOB_CONNECTION_KEY,
  accessTokenFresh,
  type MyobCompanyFile,
  type MyobConnection,
} from "./config";
import { myobEnv, refreshTokens } from "./oauth";

const API_BASE = "https://api.myob.com/accountright";

export async function loadConnection(supabase: SupabaseClient): Promise<MyobConnection | null> {
  const { data } = await supabase.from("settings").select("value").eq("key", MYOB_CONNECTION_KEY).maybeSingle();
  const v = data?.value as Partial<MyobConnection> | null | undefined;
  return v?.refreshToken ? (v as MyobConnection) : null;
}

export async function saveConnection(supabase: SupabaseClient, conn: MyobConnection | Record<string, never>): Promise<void> {
  const { error } = await supabase.from("settings").upsert({ key: MYOB_CONNECTION_KEY, value: conn }, { onConflict: "key" });
  if (error) throw new Error(`myob connection save: ${error.message}`);
}

/**
 * A connection with a guaranteed-fresh access token. Refreshes (and persists
 * the rotated pair) when the stored token is stale. Throws on refresh failure
 * — the UI shows "reconnect" rather than half-working.
 */
export async function freshConnection(supabase: SupabaseClient, nowMs: number): Promise<MyobConnection | null> {
  const conn = await loadConnection(supabase);
  if (!conn) return null;
  if (accessTokenFresh(conn, nowMs)) return conn;
  const t = await refreshTokens(conn.refreshToken);
  const next: MyobConnection = {
    ...conn,
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    accessExpiresAt: new Date(nowMs + t.expiresInSec * 1000).toISOString(),
    myobUser: t.user ?? conn.myobUser,
  };
  await saveConnection(supabase, next);
  return next;
}

async function myobGet<T>(conn: MyobConnection, url: string): Promise<T> {
  const env = myobEnv();
  if (!env) throw new Error("myob env missing");
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      "x-myobapi-key": env.clientId,
      "x-myobapi-version": "v2",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`myob get ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

type RawCompanyFile = { Id?: string; Name?: string; Uri?: string; ProductLevel?: { Name?: string } };

/** The businesses this MYOB login can see. */
export async function listCompanyFiles(conn: MyobConnection): Promise<MyobCompanyFile[]> {
  const rows = await myobGet<RawCompanyFile[]>(conn, `${API_BASE}/`);
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r.Id && r.Uri)
    .map((r) => ({ id: r.Id!, name: r.Name ?? "Unnamed business", uri: r.Uri! }));
}

export type MyobAccount = {
  uid: string;
  displayId: string;
  name: string;
  classification: string; // Income / Expense / Asset / Liability / CostOfSales / Equity
  isHeader: boolean;
};

type RawAccountPage = {
  Items?: { UID?: string; DisplayID?: string; Name?: string; Classification?: string; IsHeader?: boolean; IsActive?: boolean }[];
  NextPageLink?: string | null;
};

/** The business's chart of accounts (active, postable rows only). */
export async function listAccounts(conn: MyobConnection): Promise<MyobAccount[]> {
  if (!conn.companyFile) return [];
  const out: MyobAccount[] = [];
  let url: string | null = `${conn.companyFile.uri}/GeneralLedger/Account?$top=400`;
  for (let page = 0; url && page < 10; page++) {
    const body: RawAccountPage = await myobGet<RawAccountPage>(conn, url);
    for (const a of body.Items ?? []) {
      if (!a.UID || a.IsHeader || a.IsActive === false) continue;
      out.push({
        uid: a.UID,
        displayId: a.DisplayID ?? "",
        name: a.Name ?? "",
        classification: a.Classification ?? "",
        isHeader: false,
      });
    }
    url = body.NextPageLink ?? null;
  }
  return out;
}
