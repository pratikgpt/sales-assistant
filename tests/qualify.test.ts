import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, Policy } from "@/lib/policy";
import { qualify, route, type LeadFields } from "@/lib/qualify";

const ev = (value: string | number) => ({ value, quote: String(value), message_id: "m1" });
const full: LeadFields = { company: ev("Acme"), service: ev("dashboards"), budget_usd: ev(8000), timeline_months: ev(2) };

describe("qualify", () => {
  it("qualifies when every criterion passes", () => {
    const q = qualify(full, DEFAULT_POLICY);
    expect(q.status).toBe("qualified");
    expect(q.results.every((r) => r.outcome === "pass")).toBe(true);
  });

  it("needs info when something is missing and nothing failed", () => {
    const q = qualify({ ...full, budget_usd: undefined }, DEFAULT_POLICY);
    expect(q.status).toBe("needs_info");
    expect(q.results.find((r) => r.id === "Q3")?.outcome).toBe("missing");
  });

  it("disqualifies on a failed criterion even if others are missing", () => {
    const q = qualify({ service: ev("dashboards"), budget_usd: ev(1500) }, DEFAULT_POLICY);
    expect(q.status).toBe("not_qualified");
    expect(q.results.find((r) => r.id === "Q3")?.outcome).toBe("fail");
  });

  it("treats services outside the policy as a failure", () => {
    expect(qualify({ ...full, service: ev("other") }, DEFAULT_POLICY).status).toBe("not_qualified");
  });

  it("keeps the evidence quote on each result", () => {
    const q = qualify(full, DEFAULT_POLICY);
    expect(q.results.find((r) => r.id === "Q1")?.evidence?.quote).toBe("Acme");
  });
});

describe("route", () => {
  it("sends large budgets to the principal consultant", () => {
    expect(route({ ...full, budget_usd: ev(40000) }, DEFAULT_POLICY)).toMatchObject({ rep_id: "rep_2", rule_id: "RT1" });
  });
  it("routes by service", () => {
    expect(route({ ...full, service: ev("forecasting") }, DEFAULT_POLICY)).toMatchObject({ rep_id: "rep_2", rule_id: "RT2" });
  });
  it("falls back to the default rule", () => {
    expect(route(full, DEFAULT_POLICY)).toMatchObject({ rep_id: "rep_1", rule_id: "RT3", rep_name: "Asha Mehta" });
  });
});

describe("policy validation", () => {
  it("accepts the default policy", () => {
    expect(Policy.safeParse(DEFAULT_POLICY).success).toBe(true);
  });
  it("rejects routing to an unknown rep and a conditional last rule", () => {
    const bad = { ...DEFAULT_POLICY, routing_rules: [{ id: "X", when: { min_budget_usd: 1 }, assign_to: "rep_9", reason: "" }] };
    const issues = Policy.safeParse(bad).error?.issues.map((i) => i.message) ?? [];
    expect(issues).toEqual(expect.arrayContaining(["Unknown rep rep_9", "The last routing rule must have no conditions (the default)"]));
  });
  it("rejects an unknown timezone", () => {
    expect(Policy.safeParse({ ...DEFAULT_POLICY, timezone: "Mars/Olympus" }).success).toBe(false);
  });
});
