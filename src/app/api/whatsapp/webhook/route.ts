import crypto from "crypto";
import { NextResponse } from "next/server";
import { inboxAdd } from "@/lib/debugInbox";

function getVerifyToken() {
  return process.env.WHATSAPP_VERIFY_TOKEN ?? "";
}

function getWebhookSecret() {
  return process.env.GOWA_WEBHOOK_SECRET ?? "";
}

function getGowaBaseUrl() {
  return (process.env.GOWA_BASE_URL ?? "").replace(/\/+$/, "");
}

function getGowaBasicAuth() {
  return process.env.GOWA_BASIC_AUTH ?? "";
}

function getGowaDeviceId() {
  return process.env.GOWA_DEVICE_ID ?? "";
}

function shouldAutoReply() {
  return (process.env.WHATSAPP_AUTO_REPLY ?? "true").toLowerCase() === "true";
}

function toBasicAuthHeader(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("basic ")) return trimmed;
  return `Basic ${Buffer.from(trimmed).toString("base64")}`;
}

function verifySignature(rawBody: string, signatureHeader: string | null) {
  const secret = getWebhookSecret();
  if (!secret) return true;
  if (!signatureHeader) return false;

  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

async function sendTextMessage(to: string, text: string) {
  const baseUrl = getGowaBaseUrl();
  if (!baseUrl) return;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = toBasicAuthHeader(getGowaBasicAuth());
  if (auth) headers.Authorization = auth;
  const deviceId = getGowaDeviceId();
  if (deviceId) headers["X-Device-Id"] = deviceId;

  await fetch(`${baseUrl}/send/message`, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: to, message: text }),
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === getVerifyToken() && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ ok: false }, { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const signatureValid = signature ? verifySignature(rawBody, signature) : null;
  if (signatureValid === false) {
    inboxAdd({ source: "gowa", signatureValid: false, body: safeJson(rawBody) });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    inboxAdd({ source: "gowa", signatureValid, body: rawBody });
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const payload = body?.payload ?? body;
  const message = payload?.message ?? payload?.messages?.[0] ?? payload?.data?.message;

  const fromRaw =
    (payload?.from ?? payload?.sender ?? payload?.sender_id ?? message?.from ?? message?.remoteJid) as string | undefined;
  const from = typeof fromRaw === "string" ? fromRaw.trim() : undefined;

  const text =
    (message?.text ??
      message?.conversation ??
      message?.body ??
      payload?.text ??
      payload?.message?.text) as string | undefined;

  const fromMe =
    payload?.from_me === true ||
    payload?.fromMe === true ||
    message?.from_me === true ||
    message?.fromMe === true ||
    payload?.is_from_me === true;

  const isInboundText = typeof text === "string" && text.trim().length > 0;

  inboxAdd({ source: "gowa", signatureValid, from, text, body: shouldStoreBody() ? body : undefined });

  if (!fromMe && shouldAutoReply() && from && isInboundText) {
    await sendTextMessage(from, "hola");
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function shouldStoreBody() {
  return (process.env.DEBUG_STORE_WEBHOOK_BODY ?? "").toLowerCase() === "true";
}
