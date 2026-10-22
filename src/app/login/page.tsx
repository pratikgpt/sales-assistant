"use client";

import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import { api, Button } from "@/components/ui";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/login", { password });
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6">
        <span className="grid size-9 place-items-center rounded-lg bg-teal-700 text-white">
          <MessageSquareText className="size-5" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Sales Assistant</h1>
        <p className="mt-1 text-sm text-slate-600">This dashboard shows real customer conversations. Enter the demo password to continue.</p>
        <label className="mt-5 block text-[13px] font-medium text-slate-700">
          Password
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
          />
        </label>
        {error && <p className="mt-2 text-[13px] text-rose-700">{error}</p>}
        <div className="mt-5">
          <Button type="submit" variant="primary" disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </form>
    </main>
  );
}
