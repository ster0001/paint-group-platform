"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { freshConnection, listCompanyFiles, saveConnection } from "@/lib/myob/client";
import { MYOB_ACCOUNTS_KEY, MYOB_ACCOUNT_SLOTS } from "@/lib/myob/config";

export type MyobActionResult = { ok: boolean; message: string };

/**
 * MYOB settings actions — tokens never reach the browser; the card sends
 * choices, the server does the talking. All staff-gated on top of RLS.
 */

export async function pickBusinessAction(fileId: string): Promise<MyobActionResult> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  if (!z.string().min(1).max(100).safeParse(fileId).success) return { ok: false, message: "Pick a business." };

  try {
    const conn = await freshConnection(supabase, Date.now());
    if (!conn) return { ok: false, message: "Not connected to MYOB — connect first." };
    const file = (await listCompanyFiles(conn)).find((f) => f.id === fileId);
    if (!file) return { ok: false, message: "That business isn't visible to this MYOB login." };
    await saveConnection(supabase, { ...conn, companyFile: file });
    revalidatePath("/settings");
    return { ok: true, message: `Connected to ${file.name}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "MYOB didn't answer — try again." };
  }
}

export async function disconnectMyobAction(): Promise<MyobActionResult> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };
  await saveConnection(supabase, {});
  revalidatePath("/settings");
  return { ok: true, message: "Disconnected. Nothing will be sent to MYOB." };
}

const accountRef = z.object({
  uid: z.string().min(1).max(64),
  displayId: z.string().max(20),
  name: z.string().max(200),
});

export async function saveAccountMapAction(map: Record<string, unknown>): Promise<MyobActionResult> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return { ok: false, message: "Staff only." };

  const clean: Record<string, z.infer<typeof accountRef>> = {};
  for (const slot of MYOB_ACCOUNT_SLOTS) {
    const v = map[slot.key];
    if (v == null) continue;
    const parsed = accountRef.safeParse(v);
    if (!parsed.success) return { ok: false, message: `Bad account for ${slot.label}.` };
    clean[slot.key] = parsed.data;
  }

  const { error } = await supabase
    .from("settings")
    .upsert({ key: MYOB_ACCOUNTS_KEY, value: { accounts: clean } }, { onConflict: "key" });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/settings");
  return { ok: true, message: "Account mapping saved." };
}
