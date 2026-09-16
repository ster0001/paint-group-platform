import { z } from "zod";

/**
 * `view=employee` — the response contract for everything an employed painter
 * is sent (brief §3.3). The shapes here are the ONLY shapes an employee RPC,
 * route or server component may return for a job, work order, variation or
 * schedule entry. They carry a time budget and never a rate.
 *
 * Two things enforce it:
 *   1. employeeView.test.ts walks every schema and asserts no key matches
 *      lib/painters/money.ts — so a money key cannot be added here.
 *   2. e2e/employee-money.spec.ts fetches every employee surface as a real
 *      employee account and asserts the same over the live JSON and HTML.
 *
 * Sessions 2–6 add fields to THESE schemas (assignments, variation cards,
 * timesheets). They do not define a second employee shape elsewhere.
 */

/** Allocated days and hours. The employee's whole view of the job's size. */
export const timeBudgetSchema = z.object({
  days: z.number().int().nonnegative(),
  hours: z.number().nonnegative(),
});
export type TimeBudget = z.infer<typeof timeBudgetSchema>;

/** One surface on the job sheet — what to do, never what it costs. */
export const employeeSurfaceSchema = z.object({
  key: z.string(),
  label: z.string(),
  coats: z.number().int().nonnegative(),
  product: z.string(),
  prep: z.string(),
  hours: z.number().nonnegative(),
  /** lib/workorder/surfaces.ts SurfaceState. */
  status: z.enum(["todo", "prepped", "done"]),
});

export const employeeAreaSchema = z.object({
  id: z.string(),
  title: z.string(),
  finishCode: z.string(),
  surfaces: z.array(employeeSurfaceSchema),
});

/** A job as it appears in the employee's list. */
export const employeeJobListItemSchema = z.object({
  work_order_id: z.string().uuid(),
  wo_ref: z.string(),
  job_title: z.string(),
  /** Suburb until the assignment is accepted — the existing privacy gate. */
  job_address: z.string(),
  stage: z.string(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  time_budget: timeBudgetSchema,
  is_lead: z.boolean(),
  /** null until the employee's Accept tap (Session 2). */
  accepted_at: z.string().nullable(),
});
export type EmployeeJobListItem = z.infer<typeof employeeJobListItemSchema>;

/** The job in full — the work order without its money section. */
export const employeeJobDetailSchema = employeeJobListItemSchema.extend({
  contact_first_name: z.string(),
  contact_phone: z.string(),
  access_notes: z.string(),
  crew_notes: z.string(),
  level_of_finish: z.string(),
  finish_code: z.string(),
  areas: z.array(employeeAreaSchema),
  exclusions: z.array(z.string()),
  materials: z.array(z.object({
    product: z.string(),
    litres: z.number().nonnegative(),
    colourName: z.string(),
    colourHex: z.string(),
    colourStatus: z.string(),
  })),
});
export type EmployeeJobDetail = z.infer<typeof employeeJobDetailSchema>;

/**
 * A variation as the employee sees it (§3.5): the added / changed scope lines
 * and the hours, and the outcome. No delta, no accept step.
 */
export const employeeVariationSchema = z.object({
  id: z.string().uuid(),
  work_order_id: z.string().uuid(),
  category: z.string(),
  comment: z.string(),
  est_hours: z.number().nonnegative().nullable(),
  outcome: z.enum(["raised", "with_office", "approved", "not_going_ahead"]),
  scope_lines: z.array(z.object({ surface: z.string(), area: z.string(), what: z.string() })),
  office_note: z.string(),
  created_at: z.string(),
});
export type EmployeeVariation = z.infer<typeof employeeVariationSchema>;

/** One block on the employee's calendar. */
export const employeeScheduleEntrySchema = z.object({
  work_order_id: z.string().uuid(),
  wo_ref: z.string(),
  job_title: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  is_lead: z.boolean(),
  accepted_at: z.string().nullable(),
  kind: z.enum(["assigned", "unavailable"]),
});
export type EmployeeScheduleEntry = z.infer<typeof employeeScheduleEntrySchema>;

/** Every employee schema, for the contract test to walk. Add new ones here. */
export const EMPLOYEE_VIEW_SCHEMAS = {
  timeBudget: timeBudgetSchema,
  surface: employeeSurfaceSchema,
  area: employeeAreaSchema,
  jobListItem: employeeJobListItemSchema,
  jobDetail: employeeJobDetailSchema,
  variation: employeeVariationSchema,
  scheduleEntry: employeeScheduleEntrySchema,
} as const;

/**
 * Every key a zod object schema (recursively) declares. Used by the contract
 * test and by nothing at runtime.
 */
export function schemaKeys(schema: z.ZodTypeAny, path = ""): string[] {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    return Object.entries(shape).flatMap(([k, v]) => {
      const here = path ? `${path}.${k}` : k;
      return [here, ...schemaKeys(v, here)];
    });
  }
  if (schema instanceof z.ZodArray) return schemaKeys(schema.element as z.ZodTypeAny, `${path}[]`);
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    return schemaKeys(schema.unwrap() as z.ZodTypeAny, path);
  }
  return [];
}
