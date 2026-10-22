import { z } from "zod";

// The editable business policy. Everything the assistant decides about qualification, routing and
// scheduling comes from here and is applied by code; the model never sees a way to change it.

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM");
const Day = z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

export const LeadField = z.enum(["company", "service", "budget_usd", "timeline_months"]);
export type LeadField = z.infer<typeof LeadField>;

export const Criterion = z.discriminatedUnion("rule", [
  z.object({ id: z.string(), field: LeadField, rule: z.literal("present"), text: z.string() }),
  z.object({ id: z.string(), field: z.literal("service"), rule: z.literal("offered_service"), text: z.string() }),
  z.object({ id: z.string(), field: z.enum(["budget_usd", "timeline_months"]), rule: z.literal("min"), value: z.number(), text: z.string() }),
  z.object({ id: z.string(), field: z.enum(["budget_usd", "timeline_months"]), rule: z.literal("max"), value: z.number(), text: z.string() }),
]);
export type Criterion = z.infer<typeof Criterion>;

export const RoutingRule = z.object({
  id: z.string(),
  when: z.object({
    services: z.array(z.string()).optional(),
    min_budget_usd: z.number().optional(),
  }),
  assign_to: z.string(),
  reason: z.string(),
});
export type RoutingRule = z.infer<typeof RoutingRule>;

export const Policy = z
  .object({
    company: z.string().min(1),
    about: z.string(),
    timezone: z.string().refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown IANA timezone"),
    working_hours: z.object({ days: z.array(Day).min(1), start: Time, end: Time }),
    meeting: z.object({
      duration_minutes: z.number().int().min(15).max(120),
      slots_to_offer: z.number().int().min(1).max(5),
      min_notice_hours: z.number().min(0).max(72),
      horizon_days: z.number().int().min(1).max(21),
    }),
    services: z.array(z.object({ id: z.string().regex(/^[a-z0-9_]+$/), name: z.string(), description: z.string() })).min(1),
    criteria: z.array(Criterion).min(1),
    reps: z
      .array(z.object({ id: z.enum(["rep_1", "rep_2"]), name: z.string().min(1), title: z.string(), focus: z.string() }))
      .length(2),
    routing_rules: z.array(RoutingRule).min(1),
  })
  .superRefine((p, ctx) => {
    if (p.working_hours.start >= p.working_hours.end) ctx.addIssue({ code: "custom", path: ["working_hours"], message: "Start must be before end" });
    const reps = new Set(p.reps.map((r) => r.id));
    const services = new Set(p.services.map((s) => s.id));
    p.routing_rules.forEach((r, i) => {
      if (!reps.has(r.assign_to as "rep_1")) ctx.addIssue({ code: "custom", path: ["routing_rules", i, "assign_to"], message: `Unknown rep ${r.assign_to}` });
      for (const s of r.when.services ?? []) if (!services.has(s)) ctx.addIssue({ code: "custom", path: ["routing_rules", i], message: `Unknown service ${s}` });
    });
    const last = p.routing_rules.at(-1);
    if (last && (last.when.services || last.when.min_budget_usd != null))
      ctx.addIssue({ code: "custom", path: ["routing_rules"], message: "The last routing rule must have no conditions (the default)" });
  });
export type Policy = z.infer<typeof Policy>;

export const DEFAULT_POLICY: Policy = {
  company: "Quillfield Analytics",
  about: "A small analytics consultancy that builds dashboards, data pipelines and forecasting models for mid-sized companies.",
  timezone: "Asia/Kolkata",
  working_hours: { days: ["Mon", "Tue", "Wed", "Thu", "Fri"], start: "10:00", end: "18:00" },
  meeting: { duration_minutes: 30, slots_to_offer: 3, min_notice_hours: 4, horizon_days: 7 },
  services: [
    { id: "dashboards", name: "BI dashboards and reporting", description: "Power BI, Looker or Metabase dashboards on existing data." },
    { id: "data_engineering", name: "Data engineering", description: "Pipelines and warehouses (dbt, Airflow, BigQuery, Snowflake)." },
    { id: "forecasting", name: "Forecasting and predictive analytics", description: "Demand, churn and revenue forecasting models." },
  ],
  criteria: [
    { id: "Q1", field: "company", rule: "present", text: "Enquiring on behalf of a company" },
    { id: "Q2", field: "service", rule: "offered_service", text: "Needs a service we offer" },
    { id: "Q3", field: "budget_usd", rule: "min", value: 5000, text: "Budget of at least $5,000" },
    { id: "Q4", field: "timeline_months", rule: "max", value: 6, text: "Wants to start within 6 months" },
  ],
  reps: [
    { id: "rep_1", name: "Asha Mehta", title: "Analytics Consultant", focus: "Dashboards and reporting" },
    { id: "rep_2", name: "Daniel Okafor", title: "Principal Consultant", focus: "Data engineering, forecasting and large projects" },
  ],
  routing_rules: [
    { id: "RT1", when: { min_budget_usd: 25000 }, assign_to: "rep_2", reason: "Budgets of $25,000 or more go to the principal consultant" },
    { id: "RT2", when: { services: ["data_engineering", "forecasting"] }, assign_to: "rep_2", reason: "Engineering and forecasting work goes to Daniel" },
    { id: "RT3", when: {}, assign_to: "rep_1", reason: "Everything else goes to Asha" },
  ],
};
