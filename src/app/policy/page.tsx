"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Policy } from "@/lib/policy";
import { AppHeader } from "@/components/AppHeader";
import { api, Button } from "@/components/ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const ZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "UTC"];

const input = "h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20";

function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-[13px] font-medium text-slate-700 ${className}`}>
      {label}
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span>}
    </label>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-slate-200 py-8 md:grid-cols-[240px_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-[13px] text-slate-600">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

const CRITERION_RULE: Record<string, string> = {
  present: "must be stated",
  offered_service: "must be a service we offer",
  budget_usd_min: "budget at least",
  budget_usd_max: "budget at most",
  timeline_months_min: "start no sooner than",
  timeline_months_max: "start within",
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "service";

export default function PolicyPage() {
  const [saved, setSaved] = useState<{ version: number; data: Policy } | null>(null);
  const [p, setP] = useState<Policy | null>(null);
  const [status, setStatus] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ version: number; data: Policy }>("/api/policy").then((r) => {
      setSaved(r);
      setP(r.data);
    });
  }, []);

  if (!p || !saved) return <AppHeader />;
  const dirty = JSON.stringify(p) !== JSON.stringify(saved.data);
  const set = (patch: Partial<Policy>) => {
    setP({ ...p, ...patch });
    setStatus(null);
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ version: number; data: Policy }>("/api/policy", p);
      setSaved(r);
      setP(r.data);
      setStatus({ kind: "ok", text: `Saved as version ${r.version}. New messages use it immediately.` });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const rules = p.routing_rules;
  const fallback = rules.at(-1)!;

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 pb-28">
        <div className="pt-8">
          <h1 className="text-xl font-semibold text-slate-900">Business policy</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            The assistant applies these rules in code: who qualifies, which rep gets the lead and when meetings can be booked. The model only words the
            messages, so it cannot change them and customers cannot talk it out of them. Version {saved.version}.
          </p>
        </div>

        <Section title="Company" description="How the assistant introduces the business.">
          <Field label="Company name">
            <input className={input} value={p.company} onChange={(e) => set({ company: e.target.value })} />
          </Field>
          <Field label="About" hint="One or two sentences the assistant may use when describing what you do.">
            <textarea className={`${input} h-auto py-2`} rows={2} value={p.about} onChange={(e) => set({ about: e.target.value })} />
          </Field>
        </Section>

        <Section title="Hours and meetings" description="Slots are offered only inside working hours, in this timezone, from each rep's free time.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Timezone">
              <input className={input} list="zones" value={p.timezone} onChange={(e) => set({ timezone: e.target.value })} />
              <datalist id="zones">
                {ZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </Field>
            <Field label="Day starts">
              <input type="time" className={input} value={p.working_hours.start} onChange={(e) => set({ working_hours: { ...p.working_hours, start: e.target.value } })} />
            </Field>
            <Field label="Day ends">
              <input type="time" className={input} value={p.working_hours.end} onChange={(e) => set({ working_hours: { ...p.working_hours, end: e.target.value } })} />
            </Field>
          </div>
          <fieldset>
            <legend className="text-[13px] font-medium text-slate-700">Working days</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {DAYS.map((d) => {
                const on = p.working_hours.days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ working_hours: { ...p.working_hours, days: on ? p.working_hours.days.filter((x) => x !== d) : DAYS.filter((x) => x === d || p.working_hours.days.includes(x)) } })}
                    className={`h-8 w-12 rounded-lg text-[13px] font-medium ${on ? "bg-teal-700 text-white" : "bg-white text-slate-700 ring-1 ring-inset ring-slate-300"}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-4">
            {(
              [
                ["duration_minutes", "Meeting length", "minutes"],
                ["slots_to_offer", "Times to offer", "per message"],
                ["min_notice_hours", "Minimum notice", "hours"],
                ["horizon_days", "Book up to", "days ahead"],
              ] as const
            ).map(([k, label, hint]) => (
              <Field key={k} label={label} hint={hint}>
                <input type="number" className={input} value={p.meeting[k]} onChange={(e) => set({ meeting: { ...p.meeting, [k]: Number(e.target.value) } })} />
              </Field>
            ))}
          </div>
        </Section>

        <Section title="Services" description="What you sell. Enquiries for anything else are not qualified.">
          {p.services.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] sm:items-end">
              <Field label="Name" hint={`id: ${s.id}`}>
                <input className={input} value={s.name} onChange={(e) => set({ services: p.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              </Field>
              <Field label="Description">
                <input className={input} value={s.description} onChange={(e) => set({ services: p.services.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
              </Field>
              <Button variant="danger" title="Remove service" disabled={p.services.length === 1} onClick={() => set({ services: p.services.filter((_, j) => j !== i) })}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const name = "New service";
              let id = slug(name);
              for (let n = 2; p.services.some((s) => s.id === id); n++) id = `${slug(name)}_${n}`;
              set({ services: [...p.services, { id, name, description: "" }] });
            }}
          >
            <Plus className="size-4" /> Add service
          </Button>
        </Section>

        <Section title="Qualifying criteria" description="All must be met to qualify. One failed criterion disqualifies; missing ones trigger a follow-up question.">
          {p.criteria.map((c, i) => (
            <div key={c.id} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-end">
              <Field label={`${c.id} · ${CRITERION_RULE[c.rule === "min" || c.rule === "max" ? `${c.field}_${c.rule}` : c.rule] ?? c.rule}`}>
                <input className={input} value={c.text} onChange={(e) => set({ criteria: p.criteria.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              </Field>
              {(c.rule === "min" || c.rule === "max") && (
                <Field label={c.field === "budget_usd" ? "USD" : "Months"}>
                  <input
                    type="number"
                    className={input}
                    value={c.value}
                    onChange={(e) => set({ criteria: p.criteria.map((x, j) => (j === i ? ({ ...x, value: Number(e.target.value) } as typeof x) : x)) })}
                  />
                </Field>
              )}
            </div>
          ))}
        </Section>

        <Section title="Sales reps" description="The two people leads are routed to. Each has a test Google Calendar the assistant books into.">
          {p.reps.map((r, i) => (
            <div key={r.id} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-3">
              {(["name", "title", "focus"] as const).map((k) => (
                <Field key={k} label={k === "name" ? `Name (${r.id.replace("_", " ")})` : k[0].toUpperCase() + k.slice(1)}>
                  <input className={input} value={r[k]} onChange={(e) => set({ reps: p.reps.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
                </Field>
              ))}
            </div>
          ))}
        </Section>

        <Section title="Routing rules" description="Checked top to bottom for qualified leads; the first match assigns the rep. The last rule is the default.">
          {rules.slice(0, -1).map((r, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-slate-500">{r.id}</span>
                <Button size="sm" variant="danger" title="Remove rule" onClick={() => set({ routing_rules: rules.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_160px]">
                <fieldset>
                  <legend className="text-[13px] font-medium text-slate-700">If the service is any of</legend>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.services.map((s) => {
                      const on = r.when.services?.includes(s.id) ?? false;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            const next = on ? (r.when.services ?? []).filter((x) => x !== s.id) : [...(r.when.services ?? []), s.id];
                            set({ routing_rules: rules.map((x, j) => (j === i ? { ...x, when: { ...x.when, services: next.length ? next : undefined } } : x)) });
                          }}
                          className={`rounded-lg px-2.5 py-1 text-[13px] ${on ? "bg-teal-700 text-white" : "bg-white text-slate-700 ring-1 ring-inset ring-slate-300"}`}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                  <span className="mt-1 block text-xs text-slate-500">None selected: any service.</span>
                </fieldset>
                <Field label="and budget at least (USD)" hint="Empty: any budget.">
                  <input
                    type="number"
                    className={input}
                    value={r.when.min_budget_usd ?? ""}
                    onChange={(e) => set({ routing_rules: rules.map((x, j) => (j === i ? { ...x, when: { ...x.when, min_budget_usd: e.target.value === "" ? undefined : Number(e.target.value) } } : x)) })}
                  />
                </Field>
              </div>
              <RuleTarget policy={p} rule={r} onChange={(nr) => set({ routing_rules: rules.map((x, j) => (j === i ? nr : x)) })} />
            </div>
          ))}
          <div className="space-y-3 rounded-lg border border-dashed border-slate-300 p-3">
            <span className="text-[13px] font-medium text-slate-700">Otherwise ({fallback.id})</span>
            <RuleTarget policy={p} rule={fallback} onChange={(nr) => set({ routing_rules: [...rules.slice(0, -1), nr] })} />
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              let n = rules.length + 1;
              while (rules.some((r) => r.id === `RT${n}`)) n++;
              set({ routing_rules: [...rules.slice(0, -1), { id: `RT${n}`, when: { min_budget_usd: 10000 }, assign_to: "rep_1", reason: "" }, fallback] });
            }}
          >
            <Plus className="size-4" /> Add rule
          </Button>
        </Section>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className={`text-[13px] ${status?.kind === "error" ? "text-rose-700" : status ? "text-emerald-700" : "text-slate-600"}`}>
            {status?.text ?? (dirty ? "You have unsaved changes." : `Version ${saved.version} is live.`)}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={!dirty || busy} onClick={() => set(saved.data)}>
              Discard
            </Button>
            <Button variant="primary" disabled={!dirty || busy} onClick={save}>
              {busy ? "Saving…" : "Save policy"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleTarget({ policy, rule, onChange }: { policy: Policy; rule: Policy["routing_rules"][number]; onChange: (r: Policy["routing_rules"][number]) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
      <Field label="Assign to">
        <select className={input} value={rule.assign_to} onChange={(e) => onChange({ ...rule, assign_to: e.target.value })}>
          {policy.reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reason shown to the team">
        <input className={input} value={rule.reason} onChange={(e) => onChange({ ...rule, reason: e.target.value })} />
      </Field>
    </div>
  );
}
