import crypto from "crypto";
import { NextResponse } from "next/server";
import { inboxAdd } from "@/lib/debugInbox";

function getVerifyToken() {
  return process.env.WHATSAPP_VERIFY_TOKEN ?? "";
}

function getAppSecret() {
  return process.env.WHATSAPP_APP_SECRET ?? "";
}

function getAccessToken() {
  return process.env.WHATSAPP_ACCESS_TOKEN ?? "";
}

function getPhoneNumberId() {
  return process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
}

function shouldAutoReply() {
  return (process.env.WHATSAPP_AUTO_REPLY ?? "true").toLowerCase() === "true";
}

function verifySignature(rawBody: string, signatureHeader: string | null) {
  const appSecret = getAppSecret();
  if (!appSecret) return true;
  if (!signatureHeader) return false;

  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

async function sendTextMessage(to: string, text: string) {
  const accessToken = getAccessToken();
  const phoneNumberId = getPhoneNumberId();
  if (!accessToken || !phoneNumberId) return;

  await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
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
    inboxAdd({ source: "meta", signatureValid: false, body: safeJson(rawBody) });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    inboxAdd({ source: "meta", signatureValid, body: rawBody });
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const change = body?.entry?.[0]?.changes?.[0];
  const value = change?.value;

  const message = value?.messages?.[0];
  const from = message?.from as string | undefined;
  const text = message?.text?.body as string | undefined;
  const isInboundText = typeof text === "string" && text.trim().length > 0;

  inboxAdd({ source: "meta", signatureValid, from, text, body: shouldStoreBody() ? body : undefined });

  if (shouldAutoReply() && from && isInboundText) {
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
