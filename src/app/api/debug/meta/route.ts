import { NextResponse } from "next/server";

function getAccessToken() {
  return process.env.WHATSAPP_ACCESS_TOKEN ?? "";
}

function getPhoneNumberId() {
  return process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
}

function mask(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export async function GET() {
  const accessToken = getAccessToken();
  const phoneNumberId = getPhoneNumberId();

  const summary = {
    hasAccessToken: Boolean(accessToken),
    hasPhoneNumberId: Boolean(phoneNumberId),
    phoneNumberId: phoneNumberId ? mask(phoneNumberId) : "",
  };

  if (!accessToken || !phoneNumberId) {
    return NextResponse.json({ ok: false, summary, error: "Missing env vars" }, { status: 200 });
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}

  return NextResponse.json({ ok: res.ok, summary, status: res.status, data }, { status: 200 });
}
