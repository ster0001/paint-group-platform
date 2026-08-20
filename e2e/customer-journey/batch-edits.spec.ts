import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * R5.1: a save may carry a BATCH of actions — everything the customer tapped
 * while the previous save was in flight. These drive the route directly,
 * because the batch semantics are the risky half: order, partial failure,
 * and the rule that a terminal action is never swept into a batch.
 */

async function post(page: import("@playwright/test").Page, id: string, body: unknown) {
  return page.evaluate(async ([estimateId, payload]) => {
    const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }, [id, body] as const);
}

test.describe("batched edits", () => {
  test("several actions in one request all apply, in order", async ({ page }) => {
    test.setTimeout(180_000);
    await driveNoPlanWizard(page);
    await openScopeEditor(page);
    const id = new URL(page.url()).searchParams.get("id")!;

    const first = await post(page, id, { view: "customer", action: "iloop_dw", ok: true });
    const areaId = (first.json.scopeRooms ?? [])[0]?.areaId as number;
    expect(areaId).toBeTruthy();

    // Size, then cupboards, then confirm — a walk that only works in order:
    // the confirm REFUSES unless the earlier answers already applied.
    const r = await post(page, id, {
      view: "customer",
      actions: [
        { action: "room_size_ok", areaId },
        { action: "room_cupboard", areaId, on: false, count: null },
        { action: "confirm_room_loop", areaId },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.error, "a correctly ordered batch must not refuse").toBeUndefined();
    const room = r.json.interiorLoop.rooms.find((x: { areaId: number }) => x.areaId === areaId);
    expect(room.size).toBe("yes");
    expect(room.confirmed, "the confirm saw the answers from earlier in its own batch").toBe(true);
    expect(r.json.rangeLoCents).toBeGreaterThan(0);
  });

  test("a refusal mid-batch keeps the work that already applied", async ({ page }) => {
    test.setTimeout(180_000);
    await driveNoPlanWizard(page);
    await openScopeEditor(page);
    const id = new URL(page.url()).searchParams.get("id")!;
    const seed = await post(page, id, { view: "customer", action: "iloop_dw", ok: true });
    const areaId = (seed.json.scopeRooms ?? [])[0]?.areaId as number;

    const r = await post(page, id, {
      view: "customer",
      actions: [
        { action: "room_size_ok", areaId },                       // applies
        { action: "confirm_room_loop", areaId: 999999 },           // refused
        { action: "room_cupboard", areaId, on: true, count: 2 },   // never runs
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.error, "the refusal must still reach the customer").toBeTruthy();
    expect(r.json.appliedCount).toBe(1);
    const room = r.json.interiorLoop.rooms.find((x: { areaId: number }) => x.areaId === areaId);
    expect(room.size, "work done before the refusal is NOT thrown away").toBe("yes");
    expect(room.cupboard?.on ?? null, "nothing after the refusal is applied").not.toBe(true);
  });

  test("a batch whose FIRST action fails answers as an error, saving nothing", async ({ page }) => {
    test.setTimeout(180_000);
    await driveNoPlanWizard(page);
    await openScopeEditor(page);
    const id = new URL(page.url()).searchParams.get("id")!;
    const r = await post(page, id, {
      view: "customer",
      actions: [
        { action: "confirm_room_loop", areaId: 999999 },
        { action: "iloop_dw", ok: true },
      ],
    });
    // The same refusal the single-action path gives for this input.
    expect(r.status).toBe(400);
    expect(r.json.error).toBeTruthy();
    expect(r.json.rangeLoCents, "no price crosses the wire on a hard refusal").toBeUndefined();
  });

  test("a terminal action is never accepted inside a batch", async ({ page }) => {
    test.setTimeout(180_000);
    await driveNoPlanWizard(page);
    await openScopeEditor(page);
    const id = new URL(page.url()).searchParams.get("id")!;
    const r = await post(page, id, {
      view: "customer",
      actions: [{ action: "iloop_dw", ok: true }, { action: "accept_intent" }],
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/on its own/i);
  });
});
