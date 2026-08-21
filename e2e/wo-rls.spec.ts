import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds } from "./helpers";
import {
  accessTokenFor, contractorIdForEmail, createLoopFixture, customerIdForEmail,
  destroyLoopFixture, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Reads, asserted through each role's OWN session.
 *
 * This spec exists because of a bug that hid for six steps: the loop's RLS
 * policies were absent, RLS denied every row silently, and nothing caught it —
 * because the other specs read back through the service-role client, which
 * bypasses RLS entirely. A test that only ever asks the database as God cannot
 * tell you what your users can see.
 *
 * So: no service key on the read side here. Every assertion is what that role's
 * own token gets back.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let mine: LoopFixture | null = null;      // assigned to our contractor + customer
let theirs: LoopFixture | null = null;    // somebody else's job entirely

async function readAs(
  who: { email: string; password: string }, path: string,
): Promise<{ rows: unknown[] | null; error: { code?: string; message?: string } | null }> {
  const token = await accessTokenFor(who);
  const body = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  return Array.isArray(body) ? { rows: body, error: null } : { rows: null, error: body };
}

test.describe("what each role can actually read", () => {
  test.skip(!staff || !contractor || !customer, missingCreds("CUSTOMER"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture jobs");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    const customerId = await customerIdForEmail(db!, customer!.email);
    expect(customerId, "the E2E customer needs a customers row").toBeTruthy();

    mine = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }], customerId);
    // Somebody else's: no contractor of ours, no customer of ours.
    theirs = await createLoopFixture(db!, contractorId!, [{ heading: "Back", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ contractor_id: null }).eq("id", theirs.workOrderId);

    for (const f of [mine, theirs]) {
      await db!.from("wo_events").insert({
        work_order_id: f.workOrderId, type: "surface_tick", actor_kind: "system",
        meta: { heading: "Front", label: "Walls", from: "todo", to: "done" },
      });
      await db!.from("wo_updates").insert({
        work_order_id: f.workOrderId, for_date: new Date().toISOString().slice(0, 10),
        draft_text: "A note for the customer.", status: "sent",
      });
    }
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, mine);
    await destroyLoopFixture(db!, theirs);
  });

  test("staff read the loop tables — the bug that hid for six steps", async () => {
    for (const table of ["wo_events", "wo_surfaces", "wo_updates", "wo_stage_transitions"]) {
      const { rows, error } = await readAs(staff!, `${table}?select=*&limit=50`);
      expect(error, `staff reading ${table}`).toBeNull();
      expect(rows!.length, `staff should see rows in ${table}`).toBeGreaterThan(0);
    }
  });

  test("the contractor sees their own job, through their own session", async () => {
    const { rows } = await readAs(contractor!, `wo_surfaces?select=id&work_order_id=eq.${mine!.workOrderId}`);
    expect(rows!.length).toBeGreaterThan(0);

    const events = await readAs(contractor!, `wo_events?select=id&work_order_id=eq.${mine!.workOrderId}`);
    expect(events.rows!.length).toBeGreaterThan(0);
  });

  test("and nothing of a job that is not theirs", async () => {
    for (const table of ["wo_surfaces", "wo_events", "wo_updates", "wo_photos"]) {
      const { rows } = await readAs(contractor!, `${table}?select=id&work_order_id=eq.${theirs!.workOrderId}`);
      expect(rows, `contractor reading ${table}`).toEqual([]);
    }
  });

  test("the customer sees their own job, through their own session", async () => {
    const { rows } = await readAs(customer!, `wo_updates?select=id&work_order_id=eq.${mine!.workOrderId}`);
    expect(rows!.length).toBeGreaterThan(0);
  });

  test("but still cannot read the work order itself — the contractor's pay is on it", async () => {
    const { rows } = await readAs(customer!, `work_orders?select=id,contractor_payment_cents`);
    expect(rows).toEqual([]);
  });

  test("and nothing of anyone else's", async () => {
    for (const table of ["wo_updates", "wo_events", "wo_surfaces"]) {
      const { rows } = await readAs(customer!, `${table}?select=id&work_order_id=eq.${theirs!.workOrderId}`);
      expect(rows, `customer reading ${table}`).toEqual([]);
    }
  });

  test("no non-staff role can write to any of it", async () => {
    for (const who of [contractor!, customer!]) {
      const token = await accessTokenFor(who);
      const response = await fetch(`${URL}/rest/v1/wo_surfaces`, {
        method: "POST",
        headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ work_order_id: mine!.workOrderId, heading: "X", label: "Y" }),
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });

  test("a customer cannot move a job's stage by writing to the column", async () => {
    const token = await accessTokenFor(customer!);
    const response = await fetch(`${URL}/rest/v1/work_orders?id=eq.${mine!.workOrderId}`, {
      method: "PATCH",
      headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "closed" }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);

    const { data } = await db!.from("work_orders").select("stage").eq("id", mine!.workOrderId).single();
    expect((data as { stage: string }).stage).toBe("in_progress");
  });
});
