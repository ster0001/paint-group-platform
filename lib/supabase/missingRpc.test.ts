import { expect, test } from "vitest";
import { isMissingRpc } from "./missingRpc";

test("only a genuinely absent function reads as 'run the migration'", () => {
  expect(isMissingRpc("Could not find the function public.wo_dismiss_update(p_reason, p_update_id) in the schema cache", "wo_dismiss_update")).toBe(true);
  expect(isMissingRpc("function public.wo_dismiss_update(uuid, text) does not exist", "wo_dismiss_update")).toBe(true);
  expect(isMissingRpc("permission denied for function wo_dismiss_update", "wo_dismiss_update")).toBe(false);
  expect(isMissingRpc("wo_dismiss_update: the job could not be closed (error:gate)", "wo_dismiss_update")).toBe(false);
  expect(isMissingRpc("Could not find the function public.other_fn in the schema cache", "wo_dismiss_update")).toBe(false);
  expect(isMissingRpc(null, "wo_dismiss_update")).toBe(false);
});
