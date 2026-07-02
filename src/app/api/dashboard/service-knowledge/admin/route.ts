import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Country = "CL" | "UY";
type JsonRecord = Record<string, unknown>;

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
}

function toText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function normalizeCountry(value: string): Country {
  return value === "UY" ? "UY" : "CL";
}

function parseKeywords(value: unknown) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => toText(item)).filter(Boolean)));
  }
  return Array.from(
    new Set(
      toText(value)
        .split(/[,\n;|]/g)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  const text = toText(value).toLowerCase();
  if (!text) return false;
  return text === "true" || text === "1" || text === "si" || text === "sí";
}

async function supabaseFetch(pathAndQuery: string, init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}) {
  const base = getSupabaseUrl();
  const key = getSupabaseKey();
  if (!base || !key) {
    return { ok: false, status: 500, data: null as unknown, error: "Missing Supabase env vars" };
  }

  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(init.headers ?? {}),
  };

  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}

  return { ok: res.ok, status: res.status, data, error: res.ok ? "" : text };
}

function pickKnowledgeRow(value: unknown, country: Country, source: "database" | "legacy") {
  const row = asRecord(value);
  const palabrasClave = parseKeywords(row.palabras_clave);
  return {
    id: toText(row.id),
    country,
    tema: toText(row.tema),
    palabrasClave,
    keywordsText: palabrasClave.join(", "),
    informacion: toText(row.informacion),
    prioridad: Number(row.prioridad ?? 100) || 100,
    activo: row.activo == null ? true : toBoolean(row.activo),
    source,
  };
}

async function loadLegacyChileKnowledge() {
  const res = await supabaseFetch("servicio_tecnico?select=tema,informacion,palabras_clave&limit=200", { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[])
    .map((row, index) => {
      const base = pickKnowledgeRow({ ...asRecord(row), id: `legacy-${index + 1}` }, "CL", "legacy");
      return { ...base, prioridad: 100 + index };
    })
    .filter((row) => row.tema && row.informacion);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const country = normalizeCountry((url.searchParams.get("country") ?? "").trim().toUpperCase());
  const query = [
    "select=id,country,tema,palabras_clave,informacion,prioridad,activo,updated_at",
    `country=eq.${country}`,
    "order=prioridad.asc,id.asc",
    "limit=500",
  ].join("&");
  const res = await supabaseFetch(`assistant_service_knowledge?${query}`, { method: "GET" });

  if (res.ok && Array.isArray(res.data)) {
    const rows = (res.data as unknown[]).map((row) => pickKnowledgeRow(row, country, "database")).filter((row) => row.tema);
    return NextResponse.json({ ok: true, rows, warning: "" }, { status: 200 });
  }

  if (country === "CL") {
    const rows = await loadLegacyChileKnowledge();
    return NextResponse.json(
      {
        ok: true,
        rows,
        warning: "Se muestra conocimiento legado de Chile. Ejecuta el SQL para habilitar edición persistente del conocimiento estructurado.",
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      rows: [],
      warning: "No pude cargar assistant_service_knowledge. Ejecuta el SQL para habilitar la gestión estructurada.",
    },
    { status: 200 },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON inválido." }, { status: 400 });
  }

  const row = asRecord(body);
  const country = normalizeCountry(toText(row.country).toUpperCase());
  const tema = toText(row.tema);
  const informacion = toText(row.informacion);
  const palabrasClave = parseKeywords(row.keywordsText ?? row.palabrasClave ?? row.palabras_clave);
  const prioridad = Number(row.prioridad ?? 100) || 100;
  const activo = row.activo == null ? true : toBoolean(row.activo);

  if (!tema || !informacion) {
    return NextResponse.json({ ok: false, error: "Necesito tema e información para crear el conocimiento técnico." }, { status: 400 });
  }

  const payload = { country, tema, palabras_clave: palabrasClave, informacion, prioridad, activo };
  const res = await supabaseFetch("assistant_service_knowledge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "No pude crear el conocimiento técnico. Ejecuta primero el SQL de soporte.",
        details: res.error,
      },
      { status: res.status || 500 },
    );
  }

  const saved = Array.isArray(res.data) ? pickKnowledgeRow(res.data[0], country, "database") : pickKnowledgeRow(payload, country, "database");
  return NextResponse.json({ ok: true, row: saved }, { status: 200 });
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON inválido." }, { status: 400 });
  }

  const row = asRecord(body);
  const id = toText(row.id);
  if (!id) {
    return NextResponse.json({ ok: false, error: "Necesito el id para actualizar el conocimiento técnico." }, { status: 400 });
  }

  const country = normalizeCountry(toText(row.country).toUpperCase());
  const tema = toText(row.tema);
  const informacion = toText(row.informacion);
  const palabrasClave = parseKeywords(row.keywordsText ?? row.palabrasClave ?? row.palabras_clave);
  const prioridad = Number(row.prioridad ?? 100) || 100;
  const activo = row.activo == null ? true : toBoolean(row.activo);

  if (!tema || !informacion) {
    return NextResponse.json({ ok: false, error: "Necesito tema e información para actualizar el conocimiento técnico." }, { status: 400 });
  }

  const payload = { country, tema, palabras_clave: palabrasClave, informacion, prioridad, activo, updated_at: new Date().toISOString() };
  const res = await supabaseFetch(`assistant_service_knowledge?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "No pude actualizar el conocimiento técnico.",
        details: res.error,
      },
      { status: res.status || 500 },
    );
  }

  const saved = Array.isArray(res.data) ? pickKnowledgeRow(res.data[0], country, "database") : pickKnowledgeRow({ id, ...payload }, country, "database");
  return NextResponse.json({ ok: true, row: saved }, { status: 200 });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "Necesito el id del conocimiento técnico a eliminar." }, { status: 400 });
  }

  const res = await supabaseFetch(`assistant_service_knowledge?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: "No pude eliminar el conocimiento técnico.", details: res.error }, { status: res.status || 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
