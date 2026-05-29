import crypto from "crypto";

export type InboxEvent = {
  id: string;
  ts: number;
  source: "meta";
  signatureValid: boolean | null;
  from?: string;
  text?: string;
  body?: unknown;
};

type Store = {
  events: InboxEvent[];
};

function getStore(): Store {
  const g = globalThis as unknown as { __interwinsInbox?: Store };
  if (!g.__interwinsInbox) {
    g.__interwinsInbox = { events: [] };
  }
  return g.__interwinsInbox;
}

export function inboxAdd(event: Omit<InboxEvent, "id" | "ts"> & { ts?: number }) {
  const store = getStore();
  const item: InboxEvent = {
    id: crypto.randomUUID(),
    ts: event.ts ?? Date.now(),
    source: event.source,
    signatureValid: event.signatureValid,
    from: event.from,
    text: event.text,
    body: event.body,
  };
  store.events.unshift(item);
  store.events = store.events.slice(0, 50);
  return item;
}

export function inboxList() {
  return getStore().events;
}
