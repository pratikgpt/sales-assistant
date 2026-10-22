"use client";

import type { ReactNode } from "react";
import { Instagram, Mail, MessageCircle } from "lucide-react";

// Tokens: one accent (teal) for actions and the assistant, semantic colours for state only,
// secondary text no lighter than slate-500 (>= 4.5:1 on white).

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  size = "md",
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  type?: "button" | "submit";
  title?: string;
}) {
  const styles = {
    primary: "bg-teal-700 text-white hover:bg-teal-800",
    secondary: "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
    ghost: "text-slate-700 hover:bg-slate-100",
    danger: "text-rose-700 hover:bg-rose-50",
  }[variant];
  const sizes = size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm";
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-40 ${sizes} ${styles}`}
    >
      {children}
    </button>
  );
}

export const CHANNELS = {
  whatsapp: { label: "WhatsApp", Icon: MessageCircle, color: "text-emerald-700", bg: "bg-emerald-50" },
  instagram: { label: "Instagram", Icon: Instagram, color: "text-fuchsia-700", bg: "bg-fuchsia-50" },
  email: { label: "Email", Icon: Mail, color: "text-sky-700", bg: "bg-sky-50" },
} as const;
export type ChannelKey = keyof typeof CHANNELS;

export function ChannelBadge({ channel, withLabel = false }: { channel: ChannelKey; withLabel?: boolean }) {
  const c = CHANNELS[channel];
  return (
    <span title={c.label} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${c.bg} ${c.color}`}>
      <c.Icon className="size-3.5" aria-hidden />
      {withLabel && c.label}
    </span>
  );
}

export const QUALIFICATION = {
  qualified: { label: "Qualified", text: "text-emerald-700", bg: "bg-emerald-50", dot: "bg-emerald-500" },
  needs_info: { label: "Needs info", text: "text-amber-800", bg: "bg-amber-50", dot: "bg-amber-500" },
  not_qualified: { label: "Not qualified", text: "text-slate-700", bg: "bg-slate-100", dot: "bg-slate-400" },
} as const;

export function QualificationPill({ status }: { status: keyof typeof QUALIFICATION }) {
  const q = QUALIFICATION[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${q.bg} ${q.text}`}>
      <span className={`size-1.5 rounded-full ${q.dot}`} />
      {q.label}
    </span>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{children}</h3>
      {action}
    </div>
  );
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.includes("/login")) window.location.href = "/login";
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}
