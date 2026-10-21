"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { requireContractor } from "@/lib/contractor/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { loadAgreementRules, loadAgreementStatus, loadAgreementVersion, previewValues, wordingHash } from "@/lib/agreements/load";
import { sendAgreementSigned } from "@/lib/agreements/notify";
import { BUCKET } from "@/lib/agreements/pdf";

/**
 * The contractor signs (brief §6). Validates with zod, re-renders what they
 * read from their CURRENT record and refuses if the hash differs (a profile
 * edit between reading and signing), stores the drawn PNG in the bucket
 * under their folder, then calls `agreement_sign` through THEIR session —
 * the one writer, which takes the snapshot and countersigns. The PDF and
 * the emails run after the response.
 */
export type SignResult = { ok: true; id: string; existed: boolean } | { ok: false; message: string };

const Input = z.object({
  version: z.number().int().positive(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().trim().min(2).max(120),
  signature: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(400_000),
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function signAgreementAction(raw: unknown): Promise<SignResult> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Something in the form is missing — tick, your name and your signature are all needed." };
  const { contractor } = await requireContractor();
  if (!contractor) return { ok: false, message: "Your account is not set up as a contractor yet." };
  const service = createServiceClient();
  if (!service) return { ok: false, message: "Signing is not available right now — it has been reported." };

  try {
    const db = await createClient();
    const [{ status }, version, rules] = await Promise.all([loadAgreementStatus(db), loadAgreementVersion(db), loadAgreementRules(db)]);
    if (!status || !version.file) return { ok: false, message: "The agreement could not be loaded. Reload and try again." };
    if (version.file.version !== parsed.data.version) return { ok: false, message: "A newer version of the agreement is out. Reload and read it again." };
    if (wordingHash(version.file, previewValues(contractor, status, rules)) !== parsed.data.hash) {
      return { ok: false, message: "Your details changed since you opened the page. Reload and read it again before signing." };
    }

    const png = Buffer.from(parsed.data.signature.slice("data:image/png;base64,".length), "base64");
    if (png.length < 100 || png.length > 300_000 || !png.subarray(0, 8).equals(PNG_MAGIC)) return { ok: false, message: "The signature could not be read. Clear it and sign again." };
    const path = `${contractor.id}/agreements/signature-${randomUUID()}.png`;
    const up = await service.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: false });
    if (up.error) throw new Error(up.error.message);

    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim();
    const userAgent = h.get("user-agent") ?? "";
    const { data, error } = await db.rpc("agreement_sign", {
      p_version: parsed.data.version, p_signed_name: parsed.data.name, p_signature_path: path, p_ip: ip, p_user_agent: userAgent, p_body_sha256: parsed.data.hash,
    });
    if (error) {
      reportError(error, { where: "agreement.sign" });
      return { ok: false, message: error.code === "42883" ? "Signing is not switched on yet (migration 20270285)." : "Could not save your signature — it has been reported. Try again." };
    }
    const r = (data ?? {}) as { status?: string; id?: string; reason?: string; missing?: string[] };
    if (r.status === "ok" && r.id) {
      const id = r.id;
      after(() => sendAgreementSigned(service, id));
      return { ok: true, id, existed: false };
    }
    if (r.status === "exists" && r.id) return { ok: true, id: r.id, existed: true };
    const wording: Record<string, string> = {
      profile_incomplete: `Your profile is missing ${(r.missing ?? []).join(", ").replace(/_/g, " ") || "details"} — fill it in first.`,
      wrong_version: "A newer version of the agreement is out. Reload and read it again.",
      no_version: "The agreement is not published yet. Ring the office.",
      bad_name: "Type your full name as it should appear on the agreement.",
      bad_signature: "The signature could not be saved. Clear it and sign again.",
      not_contractor: "Your account is not set up as a contractor yet.",
    };
    return { ok: false, message: wording[r.reason ?? ""] ?? "Could not save your signature. Try again." };
  } catch (e) {
    reportError(e, { where: "agreement.sign", extra: { contractorId: contractor.id } });
    return { ok: false, message: "Could not save your signature — it has been reported. Try again." };
  }
}
