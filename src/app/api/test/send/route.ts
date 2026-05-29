import { NextResponse } from "next/server";

function getGowaBaseUrl() {
  return (process.env.GOWA_BASE_URL ?? "").replace(/\/+$/, "");
}

function getGowaBasicAuth() {
  return process.env.GOWA_BASIC_AUTH ?? "";
}

function getGowaDeviceId() {
  return process.env.GOWA_DEVICE_ID ?? "";
}

function toBasicAuthHeader(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("basic ")) return trimmed;
  return `Basic ${Buffer.from(trimmed).toString("base64")}`;
}

async function sendViaGowa(to: string, message: string) {
  const baseUrl = getGowaBaseUrl();
  if (!baseUrl) {
    return { ok: false, status: 500, data: { error: "GOWA_BASE_URL not set" } };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = toBasicAuthHeader(getGowaBasicAuth());
  if (auth) headers.Authorization = auth;
  const deviceId = getGowaDeviceId();
  if (deviceId) headers["X-Device-Id"] = deviceId;

  const res = await fetch(`${baseUrl}/send/message`, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: to, message }),
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

  const res = await sendViaGowa(to, message);
  return NextResponse.json(res, { status: res.ok ? 200 : res.status });
}
