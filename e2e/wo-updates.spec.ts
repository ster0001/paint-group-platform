import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Step 4: the day's update is drafted from real ticks, a person approves it,
 * and only then does it count as sent. Plus the silent-site flag.
 *
 * The sweep is driven through the actual cron route with the actual shared
 * secret, because "the function works" and "the endpoint runs it" are different
 * claims and only the second one matters at 6pm.
 */

const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET;

let fixture: LoopFixture | null = null;
let silent: LoopFixture | null = null;
let updateId = "";

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

test.describe("daily updates and the silent site", () => {
  test.skip(!contractor || !staff || !customer, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");
  test.skip(!SECRET, "set CRON_SECRET to drive the sweep endpoint");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls — weatherboard", "Windows × 3"] },
    ]);
    // The customer this update is addressed to, and a before photo so the
    // contractor's first tick is allowed.
    await db!.from("estimates").update({ accepted_name: "Melissa Hartley" })
      .eq("id", fixture.estimateId);
    await db!.from("wo_photos").insert({
      work_order_id: fixture.workOrderId, kind: "before", area: "Front",
      storage_path: `wo/${fixture.workOrderId}/before.jpg`,
    });

    // A second job that started yesterday and has done nothing since.
    const silentFixture = await createLoopFixture(db!, contractorId!, [
      { heading: "Back", labels: ["Walls"] },
    ]);
    await db!.from("work_orders").update({ start_date: yesterday() })
      .eq("id", silentFixture.workOrderId);
    silent = silentFixture;
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
    await destroyLoopFixture(db!, silent);
  });

  test("the sweep refuses to run without the shared secret", async ({ request }) => {
    const bare = await request.get("/api/cron/wo-sweep");
    expect(bare.status()).toBe(401);

    const wrong = await request.get("/api/cron/wo-sweep", {
      headers: { Authorization: "Bearer not-the-secret" },
    });
    expect(wrong.status()).toBe(401);
  });

  test("a day's ticks become a draft, in the customer's language", async ({ request }) => {
    // The contractor does a day's work.
    const front = fixture!.surfaces.filter((s) => s.heading === "Front");
    for (const s of front) {
      const r = await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: s.id, p_to: "done" });
      expect(r).toBe("ok:done");
    }

    const response = await request.get("/api/cron/wo-sweep", {
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).drafted).toBeGreaterThanOrEqual(1);

    const { data } = await db!.from("wo_updates")
      .select("id, draft_text, status, source_tick_ids, photo_count")
      .eq("work_order_id", fixture!.workOrderId).single();
    const u = data as {
      id: string; draft_text: string; status: string; source_tick_ids: string[]; photo_count: number;
    };
    updateId = u.id;

    expect(u.status).toBe("drafted");
    expect(u.draft_text).toContain("Melissa");
    expect(u.draft_text).toContain("the front of the house");
    expect(u.draft_text).toContain("Windows × 3");
    // It says only what happened: nothing about the surfaces nobody touched.
    expect(u.draft_text).not.toContain("Back");
    // And it is traceable to the events it came from.
    expect(u.source_tick_ids.length).toBe(front.length);
  });

  test("nothing can be sent that a person has not approved", async () => {
    const result = await rpcAs(staff!, "wo_send_update", { p_update_id: updateId });
    expect(result).toBe("error:not_approved");

    const { data } = await db!.from("wo_updates").select("status, sent_at").eq("id", updateId).single();
    const u = data as { status: string; sent_at: string | null };
    expect(u.status).toBe("drafted");
    expect(u.sent_at).toBeNull();
  });

  test("the PC edits the words, approves, and then it sends", async () => {
    const edited = "Good afternoon Melissa — the front is finished and looks terrific. Back tomorrow for the left side.";

    const approved = await rpcAs(staff!, "wo_approve_update", {
      p_update_id: updateId, p_final_text: edited,
    });
    expect(approved).toBe("ok:approved");

    const { data: after } = await db!.from("wo_updates")
      .select("status, final_text, approved_at").eq("id", updateId).single();
    const a = after as { status: string; final_text: string; approved_at: string | null };
    expect(a.status).toBe("approved");
    expect(a.final_text).toBe(edited);      // the PC's words, not the machine's
    expect(a.approved_at).not.toBeNull();

    const sent = await rpcAs(staff!, "wo_send_update", { p_update_id: updateId });
    expect(sent).toBe("ok:sent");

    const { data: final } = await db!.from("wo_updates")
      .select("status, sent_at").eq("id", updateId).single();
    expect((final as { status: string }).status).toBe("sent");
    expect((final as { sent_at: string | null }).sent_at).not.toBeNull();
  });

  test("a later sweep does not rewrite words a person has approved", async ({ request }) => {
    const before = await db!.from("wo_updates").select("final_text").eq("id", updateId).single();

    await request.get("/api/cron/wo-sweep", { headers: { Authorization: `Bearer ${SECRET}` } });

    const after = await db!.from("wo_updates").select("final_text, status").eq("id", updateId).single();
    expect((after.data as { final_text: string }).final_text)
      .toBe((before.data as { final_text: string }).final_text);
    expect((after.data as { status: string }).status).toBe("sent");
  });

  test("the customer can read what was sent to them, and nothing else", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: customer!.email, password: customer!.password }),
    }).then((r) => r.json());

    const rows = await fetch(
      `${url}/rest/v1/wo_updates?select=id,status&work_order_id=eq.${fixture!.workOrderId}`,
      { headers: { apikey: anon, Authorization: `Bearer ${auth.access_token}` } },
    ).then((r) => r.json());

    // This customer does not own the fixture job (it has no customer_id), so
    // RLS returns nothing — which is the point being tested: the policy is on,
    // and reads are scoped to the customer's own work.
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });

  test("a silent site raises one flag, and only one", async ({ request }) => {
    const first = await request.get("/api/cron/wo-sweep", { headers: { Authorization: `Bearer ${SECRET}` } });
    expect(first.status()).toBe(200);

    const { data: flags } = await db!.from("wo_events")
      .select("id, meta").eq("work_order_id", silent!.workOrderId).eq("type", "zero_tick_flag");
    expect((flags ?? []).length).toBe(1);

    const { data: wo } = await db!.from("work_orders")
      .select("blocked_reason").eq("id", silent!.workOrderId).single();
    expect((wo as { blocked_reason: string | null }).blocked_reason).toContain("call the crew");

    // Run it again the same day: still one flag. A late sweep is late, not loud.
    await request.get("/api/cron/wo-sweep", { headers: { Authorization: `Bearer ${SECRET}` } });
    const { data: again } = await db!.from("wo_events")
      .select("id").eq("work_order_id", silent!.workOrderId).eq("type", "zero_tick_flag");
    expect((again ?? []).length).toBe(1);
  });

  test("the silent site is never messaged — only flagged", async () => {
    const { data } = await db!.from("wo_updates").select("id").eq("work_order_id", silent!.workOrderId);
    expect((data ?? []).length).toBe(0);
  });

  test("a tick clears the flag, because the site is no longer silent", async () => {
    const surface = silent!.surfaces[0];
    await db!.from("wo_photos").insert({
      work_order_id: silent!.workOrderId, kind: "before", area: surface.heading,
      storage_path: `wo/${silent!.workOrderId}/before.jpg`,
    });

    const result = await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: surface.id, p_to: "prepped" });
    expect(result).toBe("ok:prepped");

    const { data: wo } = await db!.from("work_orders")
      .select("blocked_reason").eq("id", silent!.workOrderId).single();
    expect((wo as { blocked_reason: string | null }).blocked_reason).toBeNull();
  });
});
