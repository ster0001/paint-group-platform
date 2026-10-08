"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { ZONE_KEYS, ZONE_STATUSES, normalisePostcode, resolveZone, type Resolution } from "@/lib/visits/zones";

/**
 * Settings → Visit zones (addendum A, S1 §6). Every write is a staff session
 * under RLS — the tables carry a staff-only policy — validated with zod first.
 * The resolver reads the table live, so a change here is what the next
 * customer gets ("Tom can move a suburb in Settings and the resolver follows
 * at once").
 */

type Result = { ok: true } | { ok: false; message: string };

const status = z.enum(ZONE_STATUSES as unknown as [string, ...string[]]);
const ids = z.array(z.string().uuid()).min(1).max(500);

async function staffClient() {
  const supabase = await createClient();
  const user = await requireStaff(supabase);
  return user ? { supabase, user } : null;
}

function done(): Result {
  revalidatePath("/settings");
  revalidatePath("/crm/today");
  return { ok: true };
}

export async function setSuburbStatusAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ ids, status }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick a status." };
  const c = await staffClient();
  if (!c) return { ok: false, message: "Staff only." };
  const { error } = await c.supabase.from("visit_suburbs")
    .update({ status: parsed.data.status, reviewed: true, basis: "settings", updated_at: new Date().toISOString() })
    .in("id", parsed.data.ids);
  if (error) return { ok: false, message: error.message };
  return done();
}

export async function setSuburbFarEdgeAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ id: z.string().uuid(), farEdge: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Bad request." };
  const c = await staffClient();
  if (!c) return { ok: false, message: "Staff only." };
  const { error } = await c.supabase.from("visit_suburbs")
    .update({ far_edge: parsed.data.farEdge, reviewed: true, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, message: error.message };
  return done();
}

/** Bulk approve: marks the rows reviewed without changing their status. */
export async function approveSuburbsAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ ids }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Nothing selected." };
  const c = await staffClient();
  if (!c) return { ok: false, message: "Staff only." };
  const { error } = await c.supabase.from("visit_suburbs")
    .update({ reviewed: true, updated_at: new Date().toISOString() })
    .in("id", parsed.data.ids);
  if (error) return { ok: false, message: error.message };
  return done();
}

const addSchema = z.object({
  suburb: z.string().trim().min(1).max(80),
  postcode: z.string().trim().regex(/^\d{4}$/, "Postcode is four digits."),
  status,
  farEdge: z.boolean().default(false),
  /** When adding from the unmapped list: the row to mark resolved. */
  unmappedId: z.string().uuid().optional(),
});

/** Add a suburb (also how an unmapped suburb is answered). */
export async function addSuburbAction(raw: unknown): Promise<Result> {
  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the suburb, postcode and status." };
  const c = await staffClient();
  if (!c) return { ok: false, message: "Staff only." };
  const d = parsed.data;
  const suburb = d.suburb.replace(/\s+/g, " ");
  // Upsert by hand: the unique key is an expression index PostgREST cannot name.
  const { data: existing, error: readErr } = await c.supabase.from("visit_suburbs").select("id").ilike("suburb", suburb.toLowerCase()).eq("postcode", d.postcode).maybeSingle();
  if (readErr) return { ok: false, message: readErr.message };
  const row = { suburb, postcode: d.postcode, status: d.status, far_edge: d.farEdge, reviewed: true, basis: "settings", updated_at: new Date().toISOString() };
  const write = existing
    ? await c.supabase.from("visit_suburbs").update(row).eq("id", existing.id)
    : await c.supabase.from("visit_suburbs").insert(row);
  if (write.error) return { ok: false, message: write.error.message };
  if (d.unmappedId) {
    const { error } = await c.supabase.from("visit_unmapped_suburbs")
      .update({ resolved_at: new Date().toISOString(), resolved_by: c.user.id })
      .eq("id", d.unmappedId);
    if (error) return { ok: false, message: error.message };
  }
  // Any other open unmapped rows for the same suburb + postcode are answered too.
  const { error: resolveErr } = await c.supabase.from("visit_unmapped_suburbs")
    .update({ resolved_at: new Date().toISOString(), resolved_by: c.user.id })
    .ilike("suburb", suburb.toLowerCase()).eq("postcode", d.postcode).is("resolved_at", null);
  if (resolveErr) return { ok: false, message: resolveErr.message };
  return done();
}

export async function removeSuburbAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Bad request." };
  const c = await staffClient();
  if (!c) return { ok: false, message: "Staff only." };
  const { error } = await c.supabase.from("visit_suburbs").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, message: error.message };
  return done();
}

/** R11: a zone belongs to one estimator at a time. */
export async function setZoneEstimatorAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ zone: z.enum(ZONE_KEYS), estimatorId: z.string().uuid().nullable() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Bad request." };
  const c = await staffClient();
  if (!c) return { ok: false, message: "Staff only." };
  if (parsed.data.estimatorId) {
    const { data: p, error } = await c.supabase.from("profiles").select("id").eq("id", parsed.data.estimatorId).eq("role", "staff").maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!p) return { ok: false, message: "That person is not a staff login." };
  }
  const { error } = await c.supabase.from("visit_zones")
    .update({ estimator_id: parsed.data.estimatorId, updated_at: new Date().toISOString() })
    .eq("key", parsed.data.zone);
  if (error) return { ok: false, message: error.message };
  return done();
}

/** Mark an unmapped suburb dealt with without adding it (e.g. a typo). */
export async function dismissUnmappedAction(raw: unknown): Promise<Result> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Bad request." };
  const c = await staffClient();
  if (!c) return { ok: false, message: "Staff only." };
  const { error } = await c.supabase.from("visit_unmapped_suburbs")
    .update({ resolved_at: new Date().toISOString(), resolved_by: c.user.id })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, message: error.message };
  return done();
}

/**
 * "Check an address": what the resolver answers for a suburb + postcode, as
 * the staff session sees the live list. Never records an unmapped hit — this
 * is a staff lookup, not a customer.
 */
export async function checkSuburbAction(raw: unknown): Promise<{ ok: true; result: Resolution } | { ok: false; message: string }> {
  const parsed = z.object({ suburb: z.string().trim().min(1).max(80), postcode: z.string().trim().max(12).default("") }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Type a suburb." };
  const c = await staffClient();
  if (!c) return { ok: false, message: "Staff only." };
  try {
    const result = await resolveZone(c.supabase, { suburb: parsed.data.suburb, postcode: normalisePostcode(parsed.data.postcode) }, { record: false });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The lookup failed." };
  }
}
