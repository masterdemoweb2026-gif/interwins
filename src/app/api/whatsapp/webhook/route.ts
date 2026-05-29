import crypto from "crypto";
import { NextResponse } from "next/server";

function getVerifyToken() {
  return process.env.WHATSAPP_VERIFY_TOKEN ?? "";
}

function getWebhookSecret() {
  return process.env.GOWA_WEBHOOK_SECRET ?? process.env.WHATSAPP_APP_SECRET ?? "";
}

function getAccessToken() {
  return process.env.WHATSAPP_ACCESS_TOKEN ?? "";
}

function getPhoneNumberId() {
  return process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
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
  const gowaBaseUrl = getGowaBaseUrl();
  if (gowaBaseUrl) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const auth = toBasicAuthHeader(getGowaBasicAuth());
    if (auth) headers.Authorization = auth;
    const deviceId = getGowaDeviceId();
    if (deviceId) headers["X-Device-Id"] = deviceId;

    await fetch(`${gowaBaseUrl}/send/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone: to, message: text }),
    });
    return;
  }

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
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const metaChange = body?.entry?.[0]?.changes?.[0];
  const metaValue = metaChange?.value;
  const metaMessage = metaValue?.messages?.[0];
  const metaFrom = metaMessage?.from as string | undefined;
  const metaText = metaMessage?.text?.body as string | undefined;
  const metaFromMe = metaMessage?.from_me ?? metaMessage?.fromMe ?? metaMessage?.fromMe === true;

  const gowaPayload = body?.payload ?? body;
  const gowaFrom = (gowaPayload?.from ?? gowaPayload?.sender ?? gowaPayload?.sender_id) as string | undefined;
  const gowaText = (gowaPayload?.message?.text ?? gowaPayload?.message?.conversation ?? gowaPayload?.text) as
    | string
    | undefined;
  const gowaFromMe =
    gowaPayload?.message?.from_me === true ||
    gowaPayload?.message?.fromMe === true ||
    gowaPayload?.from_me === true ||
    gowaPayload?.fromMe === true;

  const from = metaFrom ?? gowaFrom;
  const text = metaText ?? gowaText;
  const fromMe = metaFromMe === true || gowaFromMe === true;

  if (!fromMe && shouldAutoReply() && from && typeof text === "string" && text.trim().length > 0) {
    await sendTextMessage(from, "hola");
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
