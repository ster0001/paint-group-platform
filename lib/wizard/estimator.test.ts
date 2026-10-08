/**
 * C11 — who the wizard names as the customer's estimator when no staff patch
 * covers the postcode. Tom, 5 Oct 2026: "update your estimator details in
 * the wizard to Tom Roman" — the fallback read the Project coordinator, so
 * the wizard named one person while every estimate said "Prepared by"
 * another. Settings → Estimator is the one place now.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NO_ESTIMATOR, resolveEstimator } from "./estimator.ts";

const noDb = { from() { throw new Error("no postcode — the resolver must not touch the database"); } } as unknown as SupabaseClient;
const settings = (profile: Record<string, string>) => [{ key: "company_profile", value: profile }];

test("5 Oct: with no patch to match, the wizard names Settings → Estimator, with the estimator's own phone", async () => {
  const got = await resolveEstimator(noDb, settings({ estimatorName: " Tom Roman ", estimatorPhone: "0400 000 000", coordinatorName: "Someone Else", phone: "03 9000 0000" }), null);
  assert.deepEqual(got, { id: null, name: "Tom Roman", phone: "0400 000 000", covers: false });
});

test("the estimator's phone falls back to the company line, and the name to the coordinator only when the Estimator field is blank", async () => {
  const noMobile = await resolveEstimator(noDb, settings({ estimatorName: "Tom Roman", estimatorPhone: "", phone: "03 9000 0000" }), undefined);
  assert.deepEqual(noMobile, { id: null, name: "Tom Roman", phone: "03 9000 0000", covers: false });
  const blank = await resolveEstimator(noDb, settings({ estimatorName: "  ", coordinatorName: "Office Person", phone: "03 9000 0000" }), null);
  assert.deepEqual(blank, { id: null, name: "Office Person", phone: "03 9000 0000", covers: false });
});

test("no record at all → no invented name", async () => {
  assert.deepEqual(await resolveEstimator(noDb, [], null), NO_ESTIMATOR);
  assert.deepEqual(await resolveEstimator(noDb, settings({ phone: "03 9000 0000" }), null), NO_ESTIMATOR);
});
