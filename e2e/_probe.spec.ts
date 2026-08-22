import { test, expect } from "@playwright/test";
import { credentials } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

test("contractor acceptance seeds the pre-start checklist", async () => {
  const db = serviceClient()!;
  const staff = credentials("STAFF")!;
  const contractor = credentials("CONTRACTOR")!;
  const cid = await contractorIdForEmail(db, contractor.email);
  const f: LoopFixture = await createLoopFixture(db, cid!, [{ heading: "Front", labels: ["Walls"] }]);
  await db.from("work_orders").update({ stage: "offered", status: "issued", contractor_id: null }).eq("id", f.workOrderId);
  // Clear anything the offered-stage trigger may already have seeded.
  await db.from("wo_checklist_items").delete().eq("work_order_id", f.workOrderId);

  await rpcAs(staff, "send_offer", {
    p_work_order_id: f.workOrderId, p_contractor_id: cid,
    p_start: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
    p_end: null, p_note: "",
  });
  const { data: offer } = await db.from("booking_offers").select("id")
    .eq("work_order_id", f.workOrderId).eq("state", "offered").single();

  const before = await db.from("wo_checklist_items").select("id", { count: "exact", head: true })
    .eq("work_order_id", f.workOrderId);
  console.log("ITEMS AFTER OFFER:", before.count);

  await rpcAs(contractor, "respond_to_offer", { p_offer_id: (offer as {id:string}).id, p_action: "accept", p_note: "" });

  const after = await db.from("wo_checklist_items").select("phase")
    .eq("work_order_id", f.workOrderId);
  console.log("ITEMS AFTER CONTRACTOR ACCEPTED:", (after.data ?? []).length);
  const { data: wo } = await db.from("work_orders").select("stage").eq("id", f.workOrderId).single();
  console.log("STAGE:", (wo as {stage:string}).stage);

  await destroyLoopFixture(db, f);
  expect((after.data ?? []).length).toBeGreaterThan(0);
});
