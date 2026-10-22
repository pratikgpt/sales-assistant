"use client";

import { CalendarCheck, Hand } from "lucide-react";
import type { LeadSummary } from "@/lib/types";
import { ChannelBadge, QualificationPill, timeAgo } from "./ui";

export type Filter = "all" | "attention" | "qualified" | "booked";

export const needsYou = (l: LeadSummary) => Boolean(l.attention || l.has_failed_send || l.booking_status === "uncertain");

const FILTERS: [Filter, string, (l: LeadSummary) => boolean][] = [
  ["all", "All", () => true],
  ["attention", "Needs you", needsYou],
  ["qualified", "Qualified", (l) => l.status === "qualified"],
  ["booked", "Booked", (l) => l.booking_status === "confirmed"],
];

const ANONYMOUS = { whatsapp: "WhatsApp user", instagram: "Instagram user", email: "Email sender" } as const;

/** Best available name; Instagram only gives a numeric id unless the profile lookup succeeds. */
export const leadName = (l: { channel: keyof typeof ANONYMOUS; display_name: string | null; handle: string | null }) => l.display_name ?? l.handle ?? ANONYMOUS[l.channel];

export function LeadList({
  leads,
  selected,
  filter,
  onFilter,
  onSelect,
}: {
  leads: LeadSummary[] | null;
  selected: string | null;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onSelect: (id: string) => void;
}) {
  const shown = leads?.filter(FILTERS.find((f) => f[0] === filter)![2]) ?? [];
  return (
    <div className="flex flex-col lg:h-full">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 py-2" role="tablist">
        {FILTERS.map(([key, label, test]) => {
          const n = leads?.filter(test).length ?? 0;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              onClick={() => onFilter(key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-medium ${filter === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {label}
              {key !== "all" && n > 0 && (
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${filter === key ? "bg-white/20" : key === "attention" ? "bg-rose-100 text-rose-700" : "bg-slate-100"}`}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      <ul className="flex-1 lg:overflow-y-auto">
        {shown.map((l) => (
          <li key={l.id}>
            <button
              onClick={() => onSelect(l.id)}
              aria-current={selected === l.id}
              className={`w-full border-b border-slate-100 px-4 py-3 text-left transition ${selected === l.id ? "bg-teal-50/70" : "hover:bg-slate-50"}`}
            >
              <div className="flex items-center gap-2">
                <ChannelBadge channel={l.channel} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{leadName(l)}</span>
                <span className="text-xs text-slate-500 tabular-nums">{timeAgo(l.last_message_at)}</span>
              </div>
              <p className="mt-1 truncate text-[13px] text-slate-600">
                {l.last_direction === "out" && <span className="text-slate-500">Replied: </span>}
                {l.last_text}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <QualificationPill status={l.status} />
                {l.booking_status === "confirmed" && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CalendarCheck className="size-3.5" /> Booked
                  </span>
                )}
                {l.takeover && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-700">
                    <Hand className="size-3.5" /> Human
                  </span>
                )}
                {needsYou(l) && <span className="text-xs font-medium text-rose-700">Needs you</span>}
              </div>
            </button>
          </li>
        ))}
        {leads && !shown.length && (
          <li className="px-4 py-10 text-center text-sm text-slate-600">
            {leads.length ? "Nothing here." : "No enquiries yet. Messages to the connected WhatsApp number, Instagram account or inbox appear here."}
          </li>
        )}
      </ul>
    </div>
  );
}
