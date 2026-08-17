import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Deleting an estimate: allowed unless it has been accepted.
 *
 * Driven through the database function rather than the screen, because that is
 * where the refusals live — a button can be hidden, a function cannot be gone
 * around.
 */
const staff = credentials("STAFF");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

async function staffDb(): Promise<SupabaseClient> {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  await sb.auth.signInWithPassword({ email: staff!.email, password: staff!.password });
  return sb;
}

const makeEstimate = async (sb: SupabaseClient, status: string) => {
  const { data, error } = await sb
    .from("estimates")
    .insert({
      title: `E2E delete test (${status})`,
      status,
      builder_state: { blocks: [] },
      // The schema refuses a non-draft estimate without a level of finish
      // (estimates_finish_required_when_sent) — which this test tripped over,
      // proving that constraint live in passing.
      level_of_finish: status === "draft" ? null : 3,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
};

test.describe("deleting an estimate", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(process.env.E2E_DELETE_READY !== "1", "needs migration 20260911000000 applied");

  test("a draft deletes, an accepted one is refused", async () => {
    const sb = await staffDb();

    // ---- a draft goes ------------------------------------------------------
    const draftId = await makeEstimate(sb, "draft");
    const { data: gone } = await sb.rpc("delete_estimate", { p_estimate_id: draftId });
    expect(gone).toBe("ok:deleted");
    const { data: check } = await sb.from("estimates").select("id").eq("id", draftId).maybeSingle();
    expect(check).toBeNull();

    // ---- a sent one goes too: the rule is about ACCEPTED, not sent ---------
    const sentId = await makeEstimate(sb, "sent");
    expect(await sb.rpc("delete_estimate", { p_estimate_id: sentId }).then((r) => r.data)).toBe("ok:deleted");

    // ---- an accepted one stays --------------------------------------------
    const acceptedId = await makeEstimate(sb, "accepted");
    const { data: refused } = await sb.rpc("delete_estimate", { p_estimate_id: acceptedId });
    expect(refused).toBe("error:accepted");
    const { data: still } = await sb.from("estimates").select("id").eq("id", acceptedId).maybeSingle();
    expect(still).not.toBeNull();

    // ---- and the back door is shut ----------------------------------------
    const direct = await sb.from("estimates").delete().eq("id", acceptedId);
    expect(direct.error).not.toBeNull();
    const { data: stillThere } = await sb.from("estimates").select("id").eq("id", acceptedId).maybeSingle();
    expect(stillThere).not.toBeNull();

    // clean up the accepted one through the same locked door
    await sb.from("estimates").update({ status: "draft" }).eq("id", acceptedId);
    await sb.rpc("delete_estimate", { p_estimate_id: acceptedId });
  });

  test("a missing estimate says so rather than pretending", async () => {
    const sb = await staffDb();
    const { data } = await sb.rpc("delete_estimate", { p_estimate_id: "00000000-0000-0000-0000-000000000000" });
    expect(data).toBe("error:not_found");
  });

  test("a contractor cannot delete anything", async () => {
    const contractor = credentials("CONTRACTOR");
    test.skip(!contractor, missingCreds("CONTRACTOR"));

    const staffSb = await staffDb();
    const id = await makeEstimate(staffSb, "draft");

    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    await sb.auth.signInWithPassword({ email: contractor!.email, password: contractor!.password });
    const { data } = await sb.rpc("delete_estimate", { p_estimate_id: id });
    expect(data).toBe("error:not_staff");

    const { data: survived } = await staffSb.from("estimates").select("id").eq("id", id).maybeSingle();
    expect(survived).not.toBeNull();
    await staffSb.rpc("delete_estimate", { p_estimate_id: id });
  });

  test("the button is on the list, and hidden on an accepted estimate", async ({ page }) => {
    const sb = await staffDb();
    const draftId = await makeEstimate(sb, "draft");
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/estimates");
    await expect(page.getByRole("button", { name: /delete E2E delete test \(draft\)/i })).toBeVisible();
    await sb.rpc("delete_estimate", { p_estimate_id: draftId });
  });
});
