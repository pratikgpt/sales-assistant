"use client";

import { useState } from "react";
import { CalendarCheck, CalendarClock, Check, CircleAlert, CircleHelp, ExternalLink, X } from "lucide-react";
import type { LeadDetail } from "@/lib/types";
import { Button, clock, QualificationPill, SectionTitle } from "./ui";

function slotText(iso: string, tz: string) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
  return `${date}, ${time}`;
}

const OUTCOME = {
  pass: { Icon: Check, color: "text-emerald-600", label: "Met" },
  fail: { Icon: X, color: "text-rose-600", label: "Not met" },
  missing: { Icon: CircleHelp, color: "text-amber-600", label: "Not provided yet" },
};

function Meeting({ detail }: { detail: LeadDetail }) {
  const { lead, bookings, timezone: tz } = detail;
  const live = bookings.find((b) => b.status !== "failed");
  const failed = bookings.filter((b) => b.status === "failed");

  let body;
  if (live?.status === "confirmed") {
    body = (
      <div className="flex gap-2.5">
        <CalendarCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        <div>
          <div className="text-sm font-medium text-slate-900">Booked · {slotText(live.slot_start, tz)}</div>
          {live.html_link && (
            <a href={live.html_link} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-teal-700 hover:underline">
              Open in Google Calendar <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
    );
  } else if (live) {
    body = (
      <div className="flex gap-2.5">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="text-sm text-slate-900">
          <div className="font-medium">Checking with the calendar · {slotText(live.slot_start, tz)}</div>
          <p className="text-[13px] text-slate-600">Google did not confirm the write. It is not retried; check the calendar to resolve it.</p>
        </div>
      </div>
    );
  } else if (lead.stage === "confirming" && lead.pending_slot) {
    body = <p className="text-sm text-slate-900">Waiting for the customer to confirm {slotText(lead.pending_slot.start, tz)}</p>;
  } else if (lead.stage === "offering") {
    body = (
      <div className="text-sm text-slate-900">
        <p>Times offered, waiting for a choice:</p>
        <ol className="mt-1 list-inside list-decimal text-[13px] text-slate-700">
          {lead.offered_slots.map((s) => (
            <li key={s.start}>{slotText(s.start, tz)}</li>
          ))}
        </ol>
      </div>
    );
  } else if (lead.stage === "handoff") {
    body = <p className="text-sm text-slate-900">The rep will arrange a time directly.</p>;
  } else {
    body = <p className="text-sm text-slate-600">{lead.status === "not_qualified" ? "No meeting: not qualified." : "Offered once the lead is qualified."}</p>;
  }

  return (
    <div className="space-y-2">
      {body}
      {failed.map((b) => (
        <p key={b.id} className="text-xs text-slate-600">
          Earlier attempt for {slotText(b.slot_start, tz)} not booked: {b.error}
        </p>
      ))}
    </div>
  );
}

export function LeadPanel({ detail, busy, onRetry, onCheckBooking }: { detail: LeadDetail; busy: boolean; onRetry: () => void; onCheckBooking: () => void }) {
  const { lead, events, bookings } = detail;
  const [allEvents, setAllEvents] = useState(false);
  const uncertain = bookings.some((b) => b.status === "uncertain" || b.status === "pending");
  const recent = [...events].reverse().slice(0, allEvents ? undefined : 8);

  return (
    <div className="space-y-6 p-4">
      {lead.attention && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <div className="flex gap-2 text-sm text-rose-900">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-700" />
            <span>{lead.attention}</span>
          </div>
          <div className="mt-2 flex gap-2 pl-6">
            {uncertain ? (
              <Button size="sm" onClick={onCheckBooking} disabled={busy}>
                Check calendar
              </Button>
            ) : (
              <Button size="sm" onClick={onRetry} disabled={busy || lead.takeover}>
                Retry assistant
              </Button>
            )}
          </div>
        </div>
      )}

      <section className="space-y-3">
        <SectionTitle action={<QualificationPill status={lead.status} />}>Qualification</SectionTitle>
        <ul className="space-y-3">
          {(lead.qualification?.results ?? []).map((r) => {
            const o = OUTCOME[r.outcome];
            return (
              <li key={r.id} className="flex gap-2.5">
                <o.Icon className={`mt-0.5 size-4 shrink-0 ${o.color}`} aria-label={o.label} />
                <div className="min-w-0 text-sm">
                  <div className="text-slate-900">{r.text}</div>
                  {r.evidence ? (
                    <div className="text-[13px] text-slate-600">
                      {typeof r.evidence.value === "number" && r.field === "budget_usd"
                        ? `$${r.evidence.value.toLocaleString()}`
                        : r.field === "service"
                          ? (detail.services.find((s) => s.id === r.evidence!.value)?.name ?? "Not a service we offer")
                          : String(r.evidence.value)}
                      {r.field === "timeline_months" && typeof r.evidence.value === "number" ? " months" : ""} · <q className="italic">{r.evidence.quote}</q>
                    </div>
                  ) : (
                    <div className="text-[13px] text-slate-500">Not provided yet</div>
                  )}
                </div>
              </li>
            );
          })}
          {!lead.qualification && <li className="text-sm text-slate-600">Assessed after the first reply.</li>}
        </ul>
        {lead.policy_version && <p className="text-xs text-slate-500">Rules from policy v{lead.policy_version}. Evidence is quoted from the customer&apos;s messages.</p>}
      </section>

      <section className="space-y-2">
        <SectionTitle>Assigned to</SectionTitle>
        {lead.assignment ? (
          <div className="text-sm">
            <div className="font-medium text-slate-900">{lead.assignment.rep_name}</div>
            <div className="text-[13px] text-slate-600">
              Rule {lead.assignment.rule_id}: {lead.assignment.reason}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Assigned by the routing rules once qualified.</p>
        )}
      </section>

      <section className="space-y-2">
        <SectionTitle>Meeting</SectionTitle>
        <Meeting detail={detail} />
      </section>

      <section className="space-y-2">
        <SectionTitle
          action={
            events.length > 8 && (
              <button onClick={() => setAllEvents(!allEvents)} className="text-xs font-medium text-teal-700 hover:underline">
                {allEvents ? "Show recent" : `Show all ${events.length}`}
              </button>
            )
          }
        >
          Activity
        </SectionTitle>
        <ol className="space-y-1.5">
          {recent.map((e) => (
            <li key={e.id} className="flex gap-3 text-[13px]">
              <span className="w-16 shrink-0 text-xs leading-5 text-slate-500 tabular-nums">{clock(e.created_at)}</span>
              <span className={e.level === "error" ? "text-rose-700" : e.level === "warn" ? "text-amber-800" : "text-slate-700"}>{e.text}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
