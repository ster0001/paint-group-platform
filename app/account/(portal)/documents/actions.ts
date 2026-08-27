"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { checkUpload } from "@/lib/uploads/validate";
import { reportError } from "@/lib/monitoring/report";

const inputSchema = z.object({
  workOrderId: z.string().uuid(),
  note: z.string().trim().min(5, "Tell us a little about what you've noticed.").max(2000),
});

/**
 * 3a-5 · "Report an issue" — photo-first, routed to the PC console.
 * Ownership is proven through the account chain before anything is written;
 * photos are validated (lib/uploads rules + the bucket's own server-side
 * limits) and stored under warranty/<wo>/ in the private wo-photos bucket.
 */
export async function reportIssueAction(formData: FormData): Promise<void> {
  const parsed = inputSchema.safeParse({
    workOrderId: String(formData.get("workOrderId") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) {
    redirect(`/account/documents?issue=invalid`);
  }
  const { workOrderId, note } = parsed.data;

  const ctx = await getPortalContext();
  if (!ctx || ctx.accounts.length === 0) redirect("/account/login");
  const svc = createServiceClient();
  if (!svc) redirect("/account/documents?issue=failed");

  // The chain: work order → estimate → one of the caller's accounts.
  const { data: wo } = await svc
    .from("work_orders")
    .select("id, estimates!inner(account_id)")
    .eq("id", workOrderId)
    .maybeSingle();
  const accountId = (wo as { estimates?: { account_id: string | null } } | null)?.estimates?.account_id;
  const owned = new Set(ctx!.accounts.map((a) => a.id));
  if (!accountId || !owned.has(accountId)) redirect("/account/documents?issue=failed");

  // Photos: up to 4, optional — §5: "if you can't photograph it, we will
  // simply come and look."
  const photoPaths: string[] = [];
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 4);
  for (const [i, file] of files.entries()) {
    const problem = checkUpload({ name: file.name, size: file.size, type: file.type }, "image");
    if (problem) redirect(`/account/documents?issue=photo&why=${encodeURIComponent(problem)}`);
    const path = `warranty/${workOrderId}/${Date.now()}-${i}-${file.name.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
    const up = await svc.storage.from("wo-photos").upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "image/jpeg",
    });
    if (up.error) {
      reportError(up.error, { where: "portal.warranty.photo", bestEffort: true });
      redirect(`/account/documents?issue=photo&why=${encodeURIComponent("The photo didn't upload — try again, or send it without.")}`);
    }
    photoPaths.push(path);
  }

  const inserted = await svc.from("warranty_issues").insert({
    work_order_id: workOrderId,
    account_id: accountId,
    note,
    photo_paths: photoPaths,
  });
  if (inserted.error) {
    reportError(inserted.error, { where: "portal.warranty.insert" });
    redirect("/account/documents?issue=failed");
  }
  redirect("/account/documents?issue=reported");
}
