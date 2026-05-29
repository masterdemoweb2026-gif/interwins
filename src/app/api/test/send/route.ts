import { NextResponse } from "next/server";

function getGowaBaseUrl() {
  const v = (process.env.GOWA_BASE_URL ?? "").trim();
  const m = v.match(/^([`'"])([\s\S]*)\1$/);
  return (m ? m[2] : v).trim().replace(/\/+$/, "");
}

function getGowaBasicAuth() {
  const v = (process.env.GOWA_BASIC_AUTH ?? "").trim();
  const m = v.match(/^([`'"])([\s\S]*)\1$/);
  return (m ? m[2] : v).trim();
}

function getGowaDeviceId() {
  const v = (process.env.GOWA_DEVICE_ID ?? "").trim();
  const m = v.match(/^([`'"])([\s\S]*)\1$/);
  return (m ? m[2] : v).trim();
}

function toBasicAuthHeader(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("basic ")) return trimmed;
  if (trimmed.includes(":")) return `Basic ${Buffer.from(trimmed).toString("base64")}`;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length >= 16) return `Basic ${trimmed}`;
  return `Basic ${Buffer.from(trimmed).toString("base64")}`;
}

async function sendViaGowa(to: string, message: string) {
  const baseUrl = getGowaBaseUrl();
  if (!baseUrl) {
    return { ok: false, status: 500, data: { error: "GOWA_BASE_URL not set" } };
  }

  const normalizedTo = to.includes("@") ? to.split("@")[0] || to : to;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = toBasicAuthHeader(getGowaBasicAuth());
  if (auth) headers.Authorization = auth;
  const deviceId = getGowaDeviceId();
  if (deviceId) headers["X-Device-Id"] = deviceId;

  const res = await fetch(`${baseUrl}/send/message`, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: normalizedTo, message }),
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}

  return { ok: res.ok, status: res.status, data };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const to = typeof record.to === "string" ? record.to.trim() : "";
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (!to || !message) {
    return NextResponse.json({ ok: false, error: "Missing to/message" }, { status: 400 });
  }

  const res = await sendViaGowa(to, message);
  return NextResponse.json(res, { status: res.ok ? 200 : res.status });
}
