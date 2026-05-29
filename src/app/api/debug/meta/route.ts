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

function mask(value: string) {
  if (!value) return "";
  if (value.length <= 10) return "*".repeat(value.length);
  return `${value.slice(0, 10)}...`;
}

function toBasicAuthHeader(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("basic ")) return trimmed;
  return `Basic ${Buffer.from(trimmed).toString("base64")}`;
}

async function safeFetchJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers, cache: "no-store" });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, data };
}

export async function GET() {
  const baseUrl = getGowaBaseUrl();
  const basicAuth = getGowaBasicAuth();
  const deviceId = getGowaDeviceId();

  const summary = {
    hasBaseUrl: Boolean(baseUrl),
    baseUrl: baseUrl ? mask(baseUrl) : "",
    hasBasicAuth: Boolean(basicAuth),
    hasDeviceId: Boolean(deviceId),
    deviceId: deviceId ? mask(deviceId) : "",
  };

  if (!baseUrl) {
    return NextResponse.json({ ok: false, summary, error: "Missing env vars" }, { status: 200 });
  }

  const headers: Record<string, string> = {};
  const auth = toBasicAuthHeader(basicAuth);
  if (auth) headers.Authorization = auth;
  if (deviceId) headers["X-Device-Id"] = deviceId;

  const status = await safeFetchJson(`${baseUrl}/app/status`, headers);
  return NextResponse.json({ ok: status.ok, summary, status }, { status: 200 });
}
