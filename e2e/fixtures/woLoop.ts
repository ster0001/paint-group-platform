import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A throwaway job for the tick-list tests.
 *
 * Built with the service key so it never depends on the UI it is about to test,
 * and torn down by deleting the estimate — work_orders, wo_surfaces, wo_photos
 * and wo_events all cascade from it. Nothing here touches a real job: the
 * estimate is created for the test and deleted after it, so a failed run leaves
 * at worst one obviously-named orphan rather than a mutated customer record.
 */

export type LoopFixture = {
  estimateId: string;
  workOrderId: string;
  surfaces: { id: string; heading: string; label: string }[];
};

export function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Email lives on auth.users, not on profiles — profiles carries id/role/name/
 * contact only. So the map from a test login to its contractors row goes
 * through the admin user list.
 */
export async function contractorIdForEmail(db: SupabaseClient, email: string): Promise<string | null> {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const user = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (user) {
      const { data: row } = await db.from("contractors").select("id").eq("profile_id", user.id).maybeSingle();
      return (row as { id: string } | null)?.id ?? null;
    }
    if (data.users.length < 200) return null;
  }
  return null;
}

const token = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join("");

export async function createLoopFixture(
  db: SupabaseClient,
  contractorId: string,
  headings: { heading: string; labels: string[] }[],
  /** Attach the job to a customer, so customer-side RLS can be exercised. */
  customerId?: string | null,
): Promise<LoopFixture> {
  const { data: est, error: estErr } = await db
    .from("estimates")
    // level_of_finish is required once an estimate is past draft
    // (estimates_finish_required_when_sent) — the DB is the last line of defence
    // and the fixture has to satisfy it like any other row.
    .insert({ status: "accepted", source: "manual", level_of_finish: 3, customer_id: customerId ?? null })
    .select("id")
    .single();
  if (estErr) throw new Error(`fixture estimate: ${estErr.message}`);
  const estimateId = (est as { id: string }).id;

  const { data: wo, error: woErr } = await db
    .from("work_orders")
    .insert({
      estimate_id: estimateId,
      wo_ref: `WO-E2E${Math.floor(Math.random() * 10000)}`,
      share_token: token(),
      contractor_id: contractorId,
      stage: "in_progress",
      status: "in_progress",
      issued_at: new Date().toISOString(),
      wo_snapshot: {
        version: 1, woRef: "WO-E2E", status: "in_progress",
        jobTitle: "E2E tick fixture", jobAddress: "1 Test St, Melbourne",
        contactFirstName: "Test", contactPhone: "", startDate: null,
        accessNotes: "", crewNotes: "", levelOfFinish: "Level 3", finishCode: "PG-3",
        contractorName: "", contractorPaymentCents: 0,
        // One product, so anything reading the colour chips has something to read.
        materials: [{ product: "Weathershield", photoUrl: "", litres: 10, coverageMissing: false,
                      colourName: "", colourHex: "", colourStatus: "tbc" }],
        areas: headings.map((h, i) => ({
          id: `a${i}`, title: h.heading, finishCode: "PG-3", finishOverridden: false, photos: [],
          surfaces: h.labels.map((label, j) => ({
            key: `a${i}:${j}`, label, coats: 2, product: "Test", prep: "", hours: 1,
            status: "not_started",
          })),
        })),
        exclusions: [], company: { name: "Paint Group", phone: "", logoUrl: "" },
      },
    })
    .select("id")
    .single();
  if (woErr) throw new Error(`fixture work order: ${woErr.message}`);
  const workOrderId = (wo as { id: string }).id;

  const rows = headings.flatMap((h, i) =>
    h.labels.map((label, j) => ({
      work_order_id: workOrderId,
      heading: h.heading,
      heading_meta: `${h.labels.length} surfaces · 2 coats · PG-3`,
      label,
      surface_key: `a${i}:${j}`,
      sort: i * 100 + j,
    })),
  );
  // No .order() here: PostgREST will not sort an insert's returning rows. The
  // insert order is the order asked for, and the page sorts by `sort` anyway.
  const { data: seeded, error: sErr } = await db
    .from("wo_surfaces").insert(rows).select("id, heading, label");
  if (sErr) throw new Error(`fixture surfaces: ${sErr.message} (${sErr.code ?? "?"})`);

  return { estimateId, workOrderId, surfaces: seeded as LoopFixture["surfaces"] };
}

export async function destroyLoopFixture(db: SupabaseClient, fixture: LoopFixture | null) {
  if (!fixture) return;
  // Invoices FIRST. A2 made invoices.estimate_id ON DELETE RESTRICT, and a
  // spec that signs its job creates a stub invoice — deleting the estimate
  // with it still attached is refused by the database, the delete fails
  // silently here, and the fixture leaks (found 23 Aug: three $0 stubs and
  // three closed WO-E2E* jobs left behind by the walkthrough-v3 gate run).
  await db.from("invoices").delete().eq("estimate_id", fixture.estimateId);
  // Contractor invoices too (Step 5): work_order_id is ON DELETE RESTRICT and
  // sign-off auto-drafts one, so a signed job's fixture would leak without this.
  await db.from("contractor_invoices").delete().eq("work_order_id", fixture.workOrderId);
  // Everything else cascades from the estimate.
  const { error } = await db.from("estimates").delete().eq("id", fixture.estimateId);
  // A leak is a bug in the spec, not a shrug — fail loudly so it gets fixed.
  if (error) throw new Error(`fixture leak: estimate ${fixture.estimateId} not deleted — ${error.message}`);
}

/**
 * Call an RPC as a real signed-in user.
 *
 * The service key is NOT a shortcut for "staff": it carries no JWT claims, so
 * is_staff() is false under it and every staff-gated RPC answers
 * 'error:not_staff'. Anything the office does has to be driven with an actual
 * staff session, which is also closer to what the app does.
 */
const tokenCache = new Map<string, string>();

/** One sign-in per account per run: the auth endpoint throttles repeats. */
export async function accessTokenFor(who: { email: string; password: string }): Promise<string> {
  const cached = tokenCache.get(who.email);
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: who.email, password: who.password }),
  }).then((r) => r.json());
  if (!auth.access_token) {
    throw new Error(`sign-in failed for ${who.email}: ${auth.error_description ?? auth.msg ?? "no token"}`);
  }
  tokenCache.set(who.email, auth.access_token);
  return auth.access_token;
}

export async function rpcAs(
  who: { email: string; password: string },
  fn: string,
  args: Record<string, unknown>,
): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const accessToken = await accessTokenFor(who);

  const result = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  }).then((r) => r.json());
  return String(result);
}

/** Same as rpcAs, for functions that return json rather than a status string. */
export async function rpcAsJson<T = unknown>(
  who: { email: string; password: string },
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const accessToken = await accessTokenFor(who);
  return fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  }).then((r) => r.json()) as Promise<T>;
}

/** The customers row behind a login, for fixtures that need customer-side RLS. */
export async function customerIdForEmail(db: SupabaseClient, email: string): Promise<string | null> {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const user = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (user) {
      const { data: row } = await db.from("customers").select("id").eq("profile_id", user.id).maybeSingle();
      return (row as { id: string } | null)?.id ?? null;
    }
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Complete the finishing-up list the way a person would (Tom, 23 Aug): ticks
 * are ticked, the yes/no questions are answered, the optional note is left.
 * Seeds the list first (idempotent). Returns the number of items handled.
 */
export async function completePrep(
  db: SupabaseClient,
  who: { email: string; password: string },
  workOrderId: string,
  answers: { rubbish?: "yes" | "no"; equipment?: "yes" | "no"; equipmentList?: string; note?: string } = {},
): Promise<number> {
  await rpcAs(who, "wo_seed_prep_checklist", { p_work_order_id: workOrderId });
  const { data } = await db.from("wo_checklist_items")
    .select("id, kind, item_key, required")
    .eq("work_order_id", workOrderId).eq("phase", "completion_prep");
  let n = 0;
  for (const item of (data ?? []) as { id: string; kind: string | null; item_key: string | null; required: boolean }[]) {
    const kind = item.kind ?? "tick";
    if (kind === "tick") {
      await rpcAs(who, "wo_tick_checklist_item", { p_item_id: item.id, p_done: true });
    } else if (kind === "yes_no") {
      const answer = item.item_key === "equipment" ? (answers.equipment ?? "no") : (answers.rubbish ?? "no");
      await rpcAs(who, "wo_answer_checklist_item", {
        p_item_id: item.id, p_answer: answer,
        p_note: item.item_key === "equipment" && answer === "yes" ? (answers.equipmentList ?? "a ladder") : "",
      });
    } else if (answers.note) {
      await rpcAs(who, "wo_answer_checklist_item", { p_item_id: item.id, p_answer: null, p_note: answers.note });
    } else {
      continue;
    }
    n += 1;
  }
  return n;
}

/**
 * Complete the pre-start list the way the office would (Tom, 23 Aug): the
 * colours yes/no is answered (Yes unless told otherwise), required ticks are
 * ticked in sort order (colours before materials), derived/optional left.
 */
export async function completePreStart(
  db: SupabaseClient,
  who: { email: string; password: string },
  workOrderId: string,
  answers: { colours?: "yes" | "no" } = {},
): Promise<void> {
  const { data } = await db.from("wo_checklist_items")
    .select("id, auto_key, required, kind, item_key")
    .eq("work_order_id", workOrderId).eq("phase", "pre_start").order("sort");
  for (const i of (data ?? []) as { id: string; auto_key: string | null; required: boolean; kind: string | null; item_key: string | null }[]) {
    if (i.auto_key || !i.required) continue;
    if (i.kind === "yes_no") {
      await rpcAs(who, "wo_answer_checklist_item", { p_item_id: i.id, p_answer: answers.colours ?? "yes", p_note: "" });
    } else {
      await rpcAs(who, "wo_tick_checklist_item", { p_item_id: i.id, p_done: true });
    }
  }
}
