import { NextResponse } from "next/server";

function getMetaAccessToken() {
  return process.env.WHATSAPP_ACCESS_TOKEN ?? "";
}

function getMetaPhoneNumberId() {
  return process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
}

async function sendViaMeta(to: string, message: string) {
  const accessToken = getMetaAccessToken();
  const phoneNumberId = getMetaPhoneNumberId();
  if (!accessToken || !phoneNumberId) {
    return {
      ok: false,
      status: 500,
      data: { error: "WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set" },
    };
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message },
    }),
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}

  return { ok: res.ok, status: res.status, data };
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const to = String(body?.to ?? "").trim();
  const message = String(body?.message ?? "").trim();
  if (!to || !message) {
    return NextResponse.json({ ok: false, error: "Missing to/message" }, { status: 400 });
  }

  const res = await sendViaMeta(to, message);
  return NextResponse.json(res, { status: res.ok ? 200 : res.status });
}
