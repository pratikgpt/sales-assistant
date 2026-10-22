import type { Criterion, LeadField, Policy } from "./policy";

/** A value the customer stated, with the exact words it came from. */
export interface Evidence {
  value: string | number;
  quote: string;
  message_id: string;
}
export type LeadFields = Partial<Record<LeadField, Evidence>>;

export type QualificationStatus = "qualified" | "not_qualified" | "needs_info";

export interface CriterionResult {
  id: string;
  text: string;
  field: LeadField;
  outcome: "pass" | "fail" | "missing";
  evidence: Evidence | null;
}

export interface Qualification {
  status: QualificationStatus;
  results: CriterionResult[];
}

function check(c: Criterion, e: Evidence | undefined, policy: Policy): CriterionResult["outcome"] {
  if (!e) return "missing";
  switch (c.rule) {
    case "present":
      return String(e.value).trim() ? "pass" : "missing";
    case "offered_service":
      return policy.services.some((s) => s.id === e.value) ? "pass" : "fail";
    case "min":
      return typeof e.value === "number" && e.value >= c.value ? "pass" : "fail";
    case "max":
      return typeof e.value === "number" && e.value <= c.value ? "pass" : "fail";
  }
}

/**
 * Deterministic: any failed criterion disqualifies, otherwise any missing one means we need more
 * information. The model only supplies evidence; it never decides the outcome.
 */
export function qualify(fields: LeadFields, policy: Policy): Qualification {
  const results = policy.criteria.map((c) => ({
    id: c.id,
    text: c.text,
    field: c.field,
    outcome: check(c, fields[c.field], policy),
    evidence: fields[c.field] ?? null,
  }));
  const status: QualificationStatus = results.some((r) => r.outcome === "fail")
    ? "not_qualified"
    : results.some((r) => r.outcome === "missing")
      ? "needs_info"
      : "qualified";
  return { status, results };
}

export interface Assignment {
  rep_id: string;
  rep_name: string;
  rule_id: string;
  reason: string;
}

/** First matching routing rule wins; the policy guarantees the last rule is an unconditional default. */
export function route(fields: LeadFields, policy: Policy): Assignment {
  const service = fields.service?.value;
  const budget = typeof fields.budget_usd?.value === "number" ? fields.budget_usd.value : null;
  const rule =
    policy.routing_rules.find((r) => {
      if (r.when.services && !(typeof service === "string" && r.when.services.includes(service))) return false;
      if (r.when.min_budget_usd != null && !(budget != null && budget >= r.when.min_budget_usd)) return false;
      return true;
    }) ?? policy.routing_rules.at(-1)!;
  const rep = policy.reps.find((r) => r.id === rule.assign_to)!;
  return { rep_id: rep.id, rep_name: rep.name, rule_id: rule.id, reason: rule.reason };
}
