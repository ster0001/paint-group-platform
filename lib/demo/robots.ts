import "server-only";
import { setTimeout as sleep } from "node:timers/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { DEMO_SIGNATURE_PNG, customerClient, demoRules, isDemoWorkOrder, robotAfter, robotClient, type DemoRules } from "./robot";

/**
 * The robots of 12 Demo Street (induction brief §4.1), one per planted event.
 *
 * Each `demo…` function is called from the server action that handled the
 * painter's tap. It answers at once whether the job is the practice job: a
 * real job returns false and the action carries on exactly as before (staff
 * alerts, customer emails); the practice job returns true, the action skips
 * those — the office and the customer are robots here — and the robot's reply
 * is scheduled `robotDelayMs` later. Every reply is the SAME RPC a person
 * would call, as the Paint Group robot (staff) or by the job's own token (the
 * customer), and lands in the job's Messages thread so the painter sees it
 * where a real reply would be. No robot bypasses a gate: the before-photo gate,
 * the status machine and the release rules all hold.
 */

/** What the demo customer is charged per hour — a sample figure, flagged demo everywhere it shows. */
const DEMO_CHARGE_OUT_CENTS = 11_000;
const DEMO_FLAGGED_AREA = "Hallway";

type Ctx = { service: SupabaseClient; rules: DemoRules };

/** Decide once; schedule the robot. Returns false (and runs nothing) for a real job. */
async function onDemo(label: string, workOrderId: string, run: (ctx: Ctx) => Promise<void>): Promise<boolean> {
  const service = createServiceClient();
  if (!service) return false;
  if (!(await isDemoWorkOrder(service, workOrderId))) return false;
  const rules = await demoRules(service);
  robotAfter(label, rules.robotDelayMs, () => run({ service, rules }));
  return true;
}

/** The robot speaks: a staff message on the painter's thread, through the same RPC the office uses. */
async function say(ctx: Ctx, robot: SupabaseClient, workOrderId: string, contractorId: string, body: string): Promise<void> {
  const { data, error } = await robot.rpc("wo_message_post", {
    p_work_order_id: workOrderId, p_contractor_id: contractorId, p_body: body, p_photo_paths: [],
  });
  const r = (data ?? {}) as { ok?: boolean; error?: string };
  if (error || !r.ok) reportError(error ?? new Error(r.error ?? "robot message refused"), { where: "demo.robot.say", extra: { workOrderId } });
}

async function contractorOf(service: SupabaseClient, workOrderId: string): Promise<string | null> {
  const { data, error } = await service.from("work_orders").select("contractor_id").eq("id", workOrderId).maybeSingle();
  if (error) throw error;
  return (data as { contractor_id: string | null } | null)?.contractor_id ?? null;
}

function expectOk(label: string, result: unknown, ok: (s: string) => boolean = (s) => s.startsWith("ok:")): string {
  const s = String(result ?? "");
  if (!ok(s)) throw new Error(`${label}: ${s || "no answer"}`);
  return s;
}

// ---- Module 10: the offer is accepted ---------------------------------------------------------

export function demoOfferAccepted(workOrderId: string, contractorId: string): Promise<boolean> {
  return onDemo("offerAccepted", workOrderId, async (ctx) => {
    const robot = await robotClient(ctx.service, ctx.rules);
    await say(ctx, robot, workOrderId, contractorId,
      "Booked — thank you. The dates are in your calendar and the customer has been told. We will see you on day one.");
  });
}

// ---- Module 8: a variation is raised → priced → customer-approved → waits for Accept ----------

export function demoVariationRaised(workOrderId: string, variationId: string): Promise<boolean> {
  return onDemo("variation", workOrderId, async (ctx) => {
    const { service, rules } = ctx;
    const { data: v, error: vErr } = await service.from("wo_variations").select("est_hours, status, customer_token").eq("id", variationId).maybeSingle();
    if (vErr) throw vErr;
    const row = v as { est_hours: number | null; status: string; customer_token: string | null } | null;
    if (!row || row.status !== "raised") return;
    const hours = row.est_hours && row.est_hours > 0 ? row.est_hours : 1.5;
    const labourCents = Math.round(hours * DEMO_CHARGE_OUT_CENTS);
    const robot = await robotClient(service, rules);

    // The office prices it (the figures a real PC would type, as a sample).
    const priced = expectOk("wo_price_variation", (await robot.rpc("wo_price_variation", {
      p_variation_id: variationId, p_price_cents: labourCents,
      p_inputs: { hours, chargeOutCents: DEMO_CHARGE_OUT_CENTS, type: "demo", materialsCents: 0, incGst: true },
      p_priced_lines: [{ label: `Labour — ${hours} hr at $${(DEMO_CHARGE_OUT_CENTS / 100).toFixed(2)}/hr`, cents: labourCents }],
      p_hours: hours,
    })).data);
    const token = priced.slice(3);

    // …then the customer approves it, a few seconds later, by the job's own link.
    await sleep(rules.robotDelayMs);
    expectOk("wo_customer_sign_variation", (await customerClient().rpc("wo_customer_sign_variation", {
      p_token: token, p_name: "Demo Customer", p_signature: DEMO_SIGNATURE_PNG,
    })).data, (s) => s === "ok:approved");

    // A painter-raised addition waits for the office's release unless the
    // release setting is automatic — the robot is the office.
    const { data: after, error: aErr } = await service.from("wo_variations").select("status, released_at").eq("id", variationId).maybeSingle();
    if (aErr) throw aErr;
    const a = after as { status: string; released_at: string | null } | null;
    if (a?.status === "customer_approved" && !a.released_at) {
      expectOk("wo_release_variation", (await robot.rpc("wo_release_variation", { p_variation_id: variationId })).data);
    }

    const contractorId = await contractorOf(service, workOrderId);
    if (contractorId) await say(ctx, robot, workOrderId, contractorId,
      "Your variation is priced and the customer has approved it. Open the variation and tap Accept — it goes on your invoice.");
  });
}

// ---- Module 9: the walk-through — the customer flags one area, then walks again -------------

export function demoWalkthroughStarted(workOrderId: string): Promise<boolean> {
  return onDemo("walkthroughFlag", workOrderId, async (ctx) => {
    const { service } = ctx;
    const { data: so, error: soErr } = await service.from("wo_signoff").select("customer_token, signed_at, areas").eq("work_order_id", workOrderId).maybeSingle();
    if (soErr) throw soErr;
    const row = so as { customer_token: string | null; signed_at: string | null; areas: Record<string, { flagged_at?: string; approved_at?: string }> | null } | null;
    if (!row?.customer_token || row.signed_at) return;
    // Flag once. A second walk-through after the fix must come back clean.
    if (row.areas?.[DEMO_FLAGGED_AREA]?.flagged_at || row.areas?.[DEMO_FLAGGED_AREA]?.approved_at) return;
    // The customer walks every room: the others are approved, the hallway is flagged.
    const { data: heads, error: hErr } = await service.from("wo_surfaces").select("heading").eq("work_order_id", workOrderId).eq("rectification", false);
    if (hErr) throw hErr;
    const customer = customerClient();
    for (const area of [...new Set(((heads ?? []) as { heading: string }[]).map((h) => h.heading))]) {
      if (area === DEMO_FLAGGED_AREA || row.areas?.[area]?.approved_at) continue;
      expectOk(`wo_walkthrough_area(approve ${area})`, (await customer.rpc("wo_walkthrough_area", {
        p_token: row.customer_token, p_area: area, p_approve: true, p_note: "",
      })).data, (s) => s === "ok:approved");
    }
    expectOk("wo_walkthrough_area(flag)", (await customer.rpc("wo_walkthrough_area", {
      p_token: row.customer_token, p_area: DEMO_FLAGGED_AREA, p_approve: false, p_note: "Mark on the hallway wall",
    })).data, (s) => s === "ok:flagged");
    const robot = await robotClient(service, ctx.rules);
    const contractorId = await contractorOf(service, workOrderId);
    if (contractorId) await say(ctx, robot, workOrderId, contractorId,
      "The customer flagged the hallway: a mark on the wall. Fix it, tick the fix on your list, then tap Fixed and they will walk again.");
  });
}

export type DemoFixedResult = { demo: false } | { demo: true; ok: true; message: string } | { demo: true; ok: false; message: string };

/**
 * The painter's "Fixed" on the practice job (ruling 6, 14 Oct): instead of
 * closing the job in one go (wo_complete_after_rectification), the customer
 * walks again — the robot withdraws the flag by the same token RPC, the job
 * returns to walkthrough, and the painter signs it off on their phone.
 */
export async function demoFixed(workOrderId: string): Promise<DemoFixedResult> {
  const service = createServiceClient();
  if (!service) return { demo: false };
  if (!(await isDemoWorkOrder(service, workOrderId))) return { demo: false };
  // The same gate the real RPC applies: every rectification row ticked done.
  const { data: open, error: openErr } = await service.from("wo_surfaces").select("id")
    .eq("work_order_id", workOrderId).eq("rectification", true).eq("removed_from_scope", false).neq("state", "done");
  if (openErr) { reportError(openErr, { where: "demo.fixed.surfaces", extra: { workOrderId } }); return { demo: true, ok: false, message: "Couldn't read the flagged areas — try again." }; }
  const n = open?.length ?? 0;
  if (n > 0) return { demo: true, ok: false, message: `${n} flagged area${n === 1 ? "" : "s"} still to put right and tick` };
  const rules = await demoRules(service);
  robotAfter("walkthroughWalkAgain", rules.robotDelayMs, async () => {
    const { data: so, error: soErr } = await service.from("wo_signoff").select("customer_token").eq("work_order_id", workOrderId).maybeSingle();
    if (soErr) throw soErr;
    const token = (so as { customer_token: string | null } | null)?.customer_token;
    if (!token) return;
    expectOk("wo_walkthrough_area(approve)", (await customerClient().rpc("wo_walkthrough_area", {
      p_token: token, p_area: DEMO_FLAGGED_AREA, p_approve: true, p_note: "All good now — thank you",
    })).data, (s) => s === "ok:approved");
    const robot = await robotClient(service, rules);
    const contractorId = await contractorOf(service, workOrderId);
    if (contractorId) await say({ service, rules }, robot, workOrderId, contractorId,
      "The customer walked through again — all clear. Start the walk-through on your phone and they will sign.");
  });
  return { demo: true, ok: true, message: "Fixed. The customer is walking through again — pull down to refresh in a moment." };
}

// ---- Module 11: the invoice and an expense are approved -----------------------------------------

export async function demoInvoiceSubmitted(invoiceId: string): Promise<boolean> {
  const service = createServiceClient();
  if (!service) return false;
  const { data, error } = await service.from("contractor_invoices").select("work_order_id, contractor_id").eq("id", invoiceId).maybeSingle();
  if (error) { reportError(error, { where: "demo.invoice.read", extra: { invoiceId } }); return false; }
  const row = data as { work_order_id: string | null; contractor_id: string } | null;
  if (!row?.work_order_id) return false;
  const workOrderId = row.work_order_id;
  return onDemo("invoiceApprove", workOrderId, async (ctx) => {
    const robot = await robotClient(ctx.service, ctx.rules);
    expectOk("contractor_invoice_approve", (await robot.rpc("contractor_invoice_approve", { p_id: invoiceId })).data, (s) => s === "ok:approved");
    await say(ctx, robot, workOrderId, row.contractor_id,
      "Invoice approved. On a real job it is paid on the due date shown on the invoice — nothing is paid in the practice job.");
  });
}

export function demoExpenseSubmitted(workOrderId: string, expenseId: string): Promise<boolean> {
  return onDemo("expenseApprove", workOrderId, async (ctx) => {
    const robot = await robotClient(ctx.service, ctx.rules);
    expectOk("contractor_expense_decide", (await robot.rpc("contractor_expense_decide", { p_id: expenseId, p_approve: true })).data);
    const contractorId = await contractorOf(ctx.service, workOrderId);
    if (contractorId) await say(ctx, robot, workOrderId, contractorId, "Expense approved — on a real job it goes on your next payment at cost.");
  });
}

// ---- Module 4 and Module 10 (Step 3b): materials, and a rained-off day -------------------------

export function demoMaterialRequested(workOrderId: string, requestId: string): Promise<boolean> {
  return onDemo("materials", workOrderId, async (ctx) => {
    const robot = await robotClient(ctx.service, ctx.rules);
    expectOk("wo_material_request_reply", (await robot.rpc("wo_material_request_reply", {
      p_id: requestId, p_status: "ordered", p_reply: "Ordered. At the paint shop tomorrow from 7 am.",
    })).data);
    const contractorId = await contractorOf(ctx.service, workOrderId);
    if (contractorId) await say(ctx, robot, workOrderId, contractorId, "Ordered. At the paint shop tomorrow from 7 am — it is on the job under Materials too.");
  });
}

export function demoNoWorkRequested(workOrderId: string, flagId: string): Promise<boolean> {
  return onDemo("noWork", workOrderId, async (ctx) => {
    const robot = await robotClient(ctx.service, ctx.rules);
    expectOk("wo_decide_no_work_day", (await robot.rpc("wo_decide_no_work_day", { p_flag_id: flagId, p_confirm: true, p_note: "" })).data);
    const contractorId = await contractorOf(ctx.service, workOrderId);
    if (contractorId) await say(ctx, robot, workOrderId, contractorId, "Marked — no work today. No reminder counts for that day.");
  });
}

// ---- Modules 7 and 10: a question, and a finish-date change -------------------------------------

export function demoPainterMessage(workOrderId: string, contractorId: string): Promise<boolean> {
  return onDemo("reply", workOrderId, async (ctx) => {
    const robot = await robotClient(ctx.service, ctx.rules);
    await say(ctx, robot, workOrderId, contractorId, "Thanks, your Project Coordinator will call you today.");
  });
}

export function demoFinishDateChanged(workOrderId: string, contractorId: string): Promise<boolean> {
  return onDemo("finishDate", workOrderId, async (ctx) => {
    const robot = await robotClient(ctx.service, ctx.rules);
    await say(ctx, robot, workOrderId, contractorId, "Noted. We will update the customer and the walk-through.");
  });
}
