"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, Check, CheckCheck, Hand, RotateCcw, Send, UserRound } from "lucide-react";
import type { LeadDetail, MessageView } from "@/lib/types";
import { leadName } from "./LeadList";
import { Button, ChannelBadge, clock } from "./ui";

function Delivery({ m, onResend }: { m: MessageView; onResend: () => void }) {
  if (m.status === "failed")
    return (
      <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-xs text-rose-700">
        <span>Not sent: {m.error}</span>
        <button onClick={onResend} className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
          <RotateCcw className="size-3" /> Resend
        </button>
      </div>
    );
  const label = { sending: "Sending…", sent: "Sent", delivered: "Delivered", read: "Read", failed_resent: "Not sent · resent below" }[m.status] ?? m.status;
  const Icon = m.status === "delivered" || m.status === "read" ? CheckCheck : Check;
  return (
    <div className={`mt-1 flex items-center justify-end gap-1 text-xs ${m.status === "read" ? "text-teal-700" : "text-slate-500"}`}>
      {m.status !== "sending" && m.status !== "failed_resent" && <Icon className="size-3.5" />}
      {label} · {clock(m.created_at)}
    </div>
  );
}

function Bubble({ m, onResend }: { m: MessageView; onResend: () => void }) {
  if (m.direction === "in") {
    return (
      <li className="flex flex-col items-start">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200">{m.text}</div>
        <span className="mt-1 text-xs text-slate-500">{clock(m.created_at)}</span>
      </li>
    );
  }
  const human = m.author === "human";
  return (
    <li className="flex flex-col items-end">
      <span className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-slate-600">
        {human ? <UserRound className="size-3.5" /> : <Bot className="size-3.5" />}
        {human ? "You" : "Assistant"}
      </span>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm ${m.status === "failed" ? "bg-rose-50 text-rose-950 ring-1 ring-rose-200" : human ? "bg-slate-800 text-white" : "bg-teal-700 text-white"}`}
      >
        {m.text}
      </div>
      <Delivery m={m} onResend={onResend} />
    </li>
  );
}

export function Conversation({
  detail,
  busy,
  onBack,
  onTakeover,
  onReply,
  onResend,
}: {
  detail: LeadDetail;
  busy: boolean;
  onBack: () => void;
  onTakeover: (on: boolean) => void;
  onReply: (text: string) => Promise<boolean>;
  onResend: (messageId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const { contact, lead, messages } = detail;
  const count = messages.length;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count, lead.id]);

  const send = async () => {
    if (!draft.trim()) return;
    if (await onReply(draft.trim())) setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-col lg:h-full">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <button onClick={onBack} className="text-slate-600 lg:hidden" aria-label="Back to inbox">
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-900">{leadName({ ...contact })}</div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <ChannelBadge channel={contact.channel} withLabel />
            <span className="truncate">{contact.handle ?? contact.external_id}</span>
          </div>
        </div>
      </div>

      <ol className="flex-1 space-y-4 bg-slate-50 px-4 py-5 lg:overflow-y-auto">
        {messages.map((m) => (
          <Bubble key={m.id} m={m} onResend={() => onResend(m.id)} />
        ))}
        <div ref={end} />
      </ol>

      <div className="border-t border-slate-200 bg-white p-3">
        {lead.takeover ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              <span className="inline-flex items-center gap-1.5">
                <Hand className="size-4" /> You&apos;re handling this conversation. The assistant is paused.
              </span>
              <Button size="sm" variant="ghost" onClick={() => onTakeover(false)} disabled={busy}>
                Hand back to assistant
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder={`Reply on ${contact.channel === "email" ? "email" : contact.channel === "whatsapp" ? "WhatsApp" : "Instagram"}…`}
                className="min-h-10 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
              <Button variant="primary" onClick={send} disabled={busy || !draft.trim()}>
                <Send className="size-4" /> Send
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-600">
              <Bot className="size-4 text-teal-700" /> The assistant replies automatically.
            </span>
            <Button onClick={() => onTakeover(true)} disabled={busy}>
              <Hand className="size-4" /> Take over
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
