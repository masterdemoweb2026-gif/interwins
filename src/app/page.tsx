"use client";

import { useEffect, useMemo, useState } from "react";

export default function Home() {
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("test");
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<string>("");
  const [metaStatus, setMetaStatus] = useState<string>("");
  const [inbox, setInbox] = useState<string>("");

  const webhookUrl = useMemo(() => {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    if (!base) return "/api/whatsapp/webhook";
    return `${base}/api/whatsapp/webhook`;
  }, []);

  async function refreshMetaStatus() {
    try {
      const res = await fetch("/api/debug/meta", { cache: "no-store" });
      const data = (await res.json()) as unknown;
      setMetaStatus(JSON.stringify(data, null, 2));
    } catch (err) {
      setMetaStatus(String(err));
    }
  }

  async function refreshInbox() {
    try {
      const res = await fetch("/api/debug/inbox", { cache: "no-store" });
      const data = (await res.json()) as unknown;
      setInbox(JSON.stringify(data, null, 2));
    } catch (err) {
      setInbox(String(err));
    }
  }

  useEffect(() => {
    refreshMetaStatus();
    refreshInbox();
    const id = window.setInterval(() => {
      refreshInbox();
    }, 3000);
    return () => window.clearInterval(id);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSending(true);
    setResult("");
    try {
      const res = await fetch("/api/test/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, message }),
      });

      const data = (await res.json()) as unknown;
      setResult(JSON.stringify({ ok: res.ok, status: res.status, data }, null, 2));
    } catch (err) {
      setResult(String(err));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="min-h-dvh bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">InterWins Beta</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Webhook: <span className="font-mono">{webhookUrl}</span>
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Si envías un mensaje al número de WhatsApp Business (Cloud API), el bot responde:{" "}
            <span className="font-mono">hola</span>
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm font-medium">Conectividad (Meta)</div>
            <button
              type="button"
              onClick={refreshMetaStatus}
              className="h-9 rounded-lg border border-black/10 px-3 text-sm dark:border-white/10"
            >
              Refrescar
            </button>
          </div>
          {metaStatus ? (
            <pre className="overflow-auto rounded-lg border border-black/10 bg-white p-3 text-xs text-zinc-800 dark:border-white/10 dark:bg-black/20 dark:text-zinc-200">
              {metaStatus}
            </pre>
          ) : null}
        </div>

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950"
        >
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Número destino</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="569XXXXXXXX (formato internacional, sin +)"
              className="h-11 rounded-lg border border-black/10 bg-transparent px-3 outline-none ring-0 focus:border-black/30 dark:border-white/10 dark:focus:border-white/30"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Mensaje</label>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="h-11 rounded-lg border border-black/10 bg-transparent px-3 outline-none ring-0 focus:border-black/30 dark:border-white/10 dark:focus:border-white/30"
            />
          </div>

          <button
            type="submit"
            disabled={isSending}
            className="h-11 rounded-lg bg-zinc-900 text-white transition-opacity disabled:opacity-60 dark:bg-zinc-100 dark:text-black"
          >
            {isSending ? "Enviando..." : "Enviar"}
          </button>
        </form>

        {result ? (
          <pre className="overflow-auto rounded-xl border border-black/10 bg-white p-4 text-xs text-zinc-800 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-200">
            {result}
          </pre>
        ) : null}

        <div className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm font-medium">Mensajes entrantes (debug)</div>
            <button
              type="button"
              onClick={refreshInbox}
              className="h-9 rounded-lg border border-black/10 px-3 text-sm dark:border-white/10"
            >
              Refrescar
            </button>
          </div>
          {inbox ? (
            <pre className="overflow-auto rounded-lg border border-black/10 bg-white p-3 text-xs text-zinc-800 dark:border-white/10 dark:bg-black/20 dark:text-zinc-200">
              {inbox}
            </pre>
          ) : null}
        </div>
      </main>
    </div>
  );
}
