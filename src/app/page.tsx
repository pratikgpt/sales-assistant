"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox as InboxIcon, X } from "lucide-react";
import type { LeadDetail, LeadSummary } from "@/lib/types";
import { AppHeader } from "@/components/AppHeader";
import { Conversation } from "@/components/Conversation";
import { LeadList, type Filter } from "@/components/LeadList";
import { LeadPanel } from "@/components/LeadPanel";
import { api } from "@/components/ui";

export default function Inbox() {
  const [leads, setLeads] = useState<LeadSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLeads = useCallback(() => api<LeadSummary[]>("/api/leads").then(setLeads), []);
  const loadDetail = useCallback((id: string) => api<LeadDetail>(`/api/leads/${id}`).then(setDetail), []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lead");
    loadLeads().catch((e) => setError(e.message));
    if (id) setSelected(id);
  }, [loadLeads]);

  // Keep the selected lead in the URL so a refresh returns to the same conversation.
  useEffect(() => {
    window.history.replaceState(null, "", selected ? `?lead=${selected}` : "/");
    if (!selected) return setDetail(null);
    loadDetail(selected).catch((e) => setError(e.message));
  }, [selected, loadDetail]);

  // Live updates: inbox and open conversation refresh every few seconds; the inbox is polled
  // for new email every 30 seconds while the dashboard is open (a cron covers it otherwise).
  useEffect(() => {
    const t = setInterval(() => {
      loadLeads().catch(() => {});
      if (selected) loadDetail(selected).catch(() => {});
    }, 4000);
    const poll = () => api("/api/email/poll", {}).catch(() => {}); // failures show in the header status
    poll();
    const e = setInterval(poll, 30_000);
    return () => {
      clearInterval(t);
      clearInterval(e);
    };
  }, [selected, loadLeads, loadDetail]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (selected) await loadDetail(selected);
      await loadLeads();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[340px_minmax(0,1fr)_360px] lg:overflow-hidden">
        <aside className={`border-slate-200 bg-white lg:min-h-0 lg:border-r ${selected ? "hidden lg:block" : ""}`}>
          <LeadList leads={leads} selected={selected} filter={filter} onFilter={setFilter} onSelect={setSelected} />
        </aside>

        {detail && selected ? (
          <>
            <section className="min-h-0 lg:border-r lg:border-slate-200">
              <Conversation
                detail={detail}
                busy={busy}
                onBack={() => setSelected(null)}
                onTakeover={(on) => act(() => api(`/api/leads/${selected}/takeover`, { on }))}
                onReply={(text) => act(() => api(`/api/leads/${selected}/reply`, { text }))}
                onResend={(message_id) => act(() => api(`/api/leads/${selected}/resend`, { message_id }))}
              />
            </section>
            <section className="border-t border-slate-200 bg-white lg:min-h-0 lg:overflow-y-auto lg:border-t-0">
              <LeadPanel
                detail={detail}
                busy={busy}
                onRetry={() => act(() => api(`/api/leads/${selected}/retry`, {}))}
                onCheckBooking={() => act(() => api(`/api/leads/${selected}/check-booking`, {}))}
              />
            </section>
          </>
        ) : (
          <section className="hidden place-items-center text-center lg:col-span-2 lg:grid">
            <div className="max-w-sm">
              <InboxIcon className="mx-auto size-8 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-900">Select a conversation</p>
              <p className="mt-1 text-sm text-slate-600">
                Enquiries from WhatsApp, Instagram and email land here. The assistant qualifies them, assigns a rep and books an intro call; you can take over at any time.
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
