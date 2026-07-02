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

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function sanitizeHeading(line: string) {
  return line
    .replace(/^[\-\*\u2022\d\.\)\(]+\s*/g, "")
    .replace(/^[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function buildKeywordsFromText(text: string) {
  return Array.from(
    new Set(
      normalizeText(text)
        .split(/\s+/g)
        .filter((token) => token.length >= 4)
        .slice(0, 12),
    ),
  );
}

function parseKnowledgeBlocks(raw: string) {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];

  return normalized
    .split(/\n\s*\n+/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const firstLine = sanitizeHeading(lines[0] ?? "");
      const restLines = lines.slice(1);
      const inferredTema =
        firstLine && firstLine.length <= 90
          ? firstLine
          : sanitizeHeading(firstLine.slice(0, 90)) || `Conocimiento ${index + 1}`;
      const informationLines = firstLine && firstLine.length <= 90 ? restLines : lines;
      const informacion = informationLines.join("\n").trim() || block;
      const palabrasClave = buildKeywordsFromText(`${inferredTema} ${informacion}`);
      return {
        tema: inferredTema,
        informacion,
        palabras_clave: palabrasClave,
      };
    })
    .filter((row) => row.tema && row.informacion);
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

async function loadExistingStructuredKnowledge(country: Country) {
  const query = [
    "select=id,tema,informacion,palabras_clave",
    `country=eq.${country}`,
    "limit=1000",
  ].join("&");
  const res = await supabaseFetch(`assistant_service_knowledge?${query}`, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[]).map((row) => ({
    tema: toText(asRecord(row).tema),
    informacion: toText(asRecord(row).informacion),
  }));
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
  const action = toText(row.action);
  if (action === "import_from_text") {
    const country = normalizeCountry(toText(row.country).toUpperCase());
    const rawText = toText(row.rawText ?? row.knowledgeText ?? row.text);
    if (!rawText) {
      return NextResponse.json({ ok: false, error: "Necesito el texto libre para importar conocimiento técnico." }, { status: 400 });
    }

    const parsedRows = parseKnowledgeBlocks(rawText);
    if (!parsedRows.length) {
      return NextResponse.json({ ok: false, error: "No pude identificar bloques válidos para importar." }, { status: 400 });
    }

    const existingRows = await loadExistingStructuredKnowledge(country);
    const existingKeys = new Set(existingRows.map((item) => `${normalizeText(item.tema)}::${normalizeText(item.informacion)}`));
    const rowsToInsert = parsedRows
      .filter((item) => {
        const key = `${normalizeText(item.tema)}::${normalizeText(item.informacion)}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      })
      .map((item, index) => ({
        country,
        tema: item.tema,
        palabras_clave: item.palabras_clave,
        informacion: item.informacion,
        prioridad: 300 + index,
        activo: true,
      }));

    if (!rowsToInsert.length) {
      return NextResponse.json(
        {
          ok: true,
          importedCount: 0,
          skippedCount: parsedRows.length,
          rows: [],
          warning: "No se importó nada porque todos los bloques ya existían como conocimiento estructurado.",
        },
        { status: 200 },
      );
    }

    const importRes = await supabaseFetch("assistant_service_knowledge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(rowsToInsert),
    });

    if (!importRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "No pude importar el conocimiento técnico. Ejecuta primero el SQL de soporte.",
          details: importRes.error,
        },
        { status: importRes.status || 500 },
      );
    }

    const savedRows = Array.isArray(importRes.data)
      ? importRes.data.map((item) => pickKnowledgeRow(item, country, "database"))
      : [];
    return NextResponse.json(
      {
        ok: true,
        rows: savedRows,
        importedCount: savedRows.length,
        skippedCount: parsedRows.length - savedRows.length,
        warning: "",
      },
      { status: 200 },
    );
  }

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
