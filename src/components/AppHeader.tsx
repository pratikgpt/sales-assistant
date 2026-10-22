"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LogOut, MessageSquareText } from "lucide-react";
import type { IntegrationView } from "@/lib/types";
import { api, clock } from "./ui";

const LABEL: Record<IntegrationView["name"], string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  email: "Email",
  calendar: "Calendar",
  llm: "Model",
};

const STATE: Record<IntegrationView["status"], { dot: string; text: string; label: string }> = {
  ok: { dot: "bg-emerald-500", text: "text-slate-700", label: "Connected" },
  unknown: {
    dot: "bg-slate-400",
    text: "text-slate-700",
    label: "Configured, no activity yet",
  },
  error: { dot: "bg-rose-500", text: "text-rose-700", label: "Error" },
  auth_error: {
    dot: "bg-rose-500",
    text: "text-rose-700",
    label: "Connection expired",
  },
  not_configured: {
    dot: "ring-1 ring-inset ring-slate-400",
    text: "text-slate-500",
    label: "Not set up",
  },
};

/** Integration health is always visible, so an expired token or calendar failure is never silent. */
function Health() {
  const [items, setItems] = useState<IntegrationView[]>([]);
  const load = useCallback(
    () =>
      api<IntegrationView[]>("/api/status")
        .then(setItems)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const problems = items.filter((i) => i.status === "error" || i.status === "auth_error");
  const missing = items.filter((i) => i.status === "not_configured");
  return (
    <>
      <p className="text-xs md:hidden">
        {problems.length ? (
          <span className="font-medium text-rose-700">{problems.map((i) => LABEL[i.name]).join(", ")} need attention</span>
        ) : missing.length ? (
          <span className="text-slate-600">
            {missing.length} integration{missing.length === 1 ? "" : "s"} not set up
          </span>
        ) : (
          <span className="text-slate-600">All integrations connected</span>
        )}
      </p>
      <ul className="hidden flex-wrap items-center gap-x-4 gap-y-1 md:flex" aria-label="Integration status">
        {items.map((i) => {
          const s = STATE[i.status];
          const title = [s.label, i.detail, i.last_ok_at && `Last OK ${clock(i.last_ok_at)}`].filter(Boolean).join(" · ");
          return (
            <li key={i.name} title={title} className={`inline-flex items-center gap-1.5 text-xs ${s.text}`}>
              <span className={`size-2 rounded-full ${s.dot}`} />
              {LABEL[i.name]}
              {(i.status === "error" || i.status === "auth_error") && <span className="font-medium">· {s.label}</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function AppHeader() {
  const path = usePathname();
  const nav = [
    ["/", "Inbox"],
    ["/policy", "Policy"],
  ];
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-teal-700 text-white">
            <MessageSquareText className="size-4" />
          </span>
          <span className="font-semibold text-slate-900">Sales Assistant</span>
        </div>
        <nav className="flex gap-1">
          {nav.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={path === href ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${path === href ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:text-slate-900"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <Health />
          <button
            onClick={() => api("/api/logout", {}).finally(() => (window.location.href = "/login"))}
            title="Sign out"
            className="text-slate-500 hover:text-slate-900"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
