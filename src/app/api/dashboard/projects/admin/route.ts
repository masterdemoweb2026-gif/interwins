import fs from "node:fs";
import path from "node:path";

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

function normalizeCountry(value: string): Country {
  return value === "UY" ? "UY" : "CL";
}

function readLocalTextFile(relPath: string) {
  try {
    return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
  } catch {
    return "";
  }
}

function parseUyProjectsFallback() {
  const raw = readLocalTextFile(path.join("instructivo", "uruguay", "proyectos.txt"));
  const lines = (raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const bankStart = lines.findIndex((line) => line.toLowerCase().includes("banco informativo"));
  const bodyLines = bankStart >= 0 ? lines.slice(0, bankStart) : lines;
  const rows: Array<{ id: string; titulo: string; contenido: string; country: Country; source: "file" | "database" }> = [];
  let current: { id: string; titulo: string; contenido: string } | null = null;

  for (const rawLine of bodyLines) {
    const line = String(rawLine ?? "").trimEnd();
    const match = line.match(/^\s*(\d+)\s*-\s*(.+)\s*$/);
    if (match) {
      if (current) rows.push({ ...current, country: "UY", source: "file" });
      current = { id: String(match[1]).trim(), titulo: String(match[2]).trim(), contenido: "" };
      continue;
    }
    if (!current) continue;
    const cleaned = line.replace(/^\s*contrenido\s*:\s*/i, "").replace(/^\s*contenido\s*:\s*/i, "").trim();
    if (!cleaned) continue;
    current.contenido = current.contenido ? `${current.contenido}\n${cleaned}` : cleaned;
  }

  if (current) rows.push({ ...current, country: "UY", source: "file" });
  return rows;
}

function pickProjectRow(value: unknown, country: Country, source: "file" | "database") {
  const row = asRecord(value);
  return {
    id: toText(row.id),
    titulo: toText(row.titulo),
    contenido: toText(row.contenido),
    country,
    source,
  };
}

async function fetchProjects(country: Country) {
  const query = `proyectos?select=id,titulo,contenido,country&order=id.asc&country=eq.${country}`;
  const res = await supabaseFetch(query, { method: "GET" });
  if (res.ok && Array.isArray(res.data)) {
    return {
      rows: res.data.map((row) => pickProjectRow(row, country, "database")).filter((row) => row.titulo),
      warning: "",
    };
  }

  if (country === "CL") {
    const fallback = await supabaseFetch("proyectos?select=id,titulo,contenido&order=id.asc", { method: "GET" });
    if (fallback.ok && Array.isArray(fallback.data)) {
      return {
        rows: fallback.data.map((row) => pickProjectRow(row, "CL", "database")).filter((row) => row.titulo),
        warning: "La tabla proyectos aún no tiene segmentación por país. Se muestra el esquema actual de Chile.",
      };
    }
  }

  if (country === "UY") {
    return {
      rows: parseUyProjectsFallback(),
      warning: "Se muestran proyectos de Uruguay desde archivo local. Ejecuta el SQL para poder editarlos en base de datos.",
    };
  }

  return {
    rows: [] as Array<{ id: string; titulo: string; contenido: string; country: Country; source: "file" | "database" }>,
    warning: "No pude cargar proyectos desde la base de datos.",
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const country = normalizeCountry((url.searchParams.get("country") ?? "").trim().toUpperCase());
  const data = await fetchProjects(country);
  return NextResponse.json({ ok: true, rows: data.rows, warning: data.warning }, { status: 200 });
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
  const titulo = toText(row.titulo);
  const contenido = toText(row.contenido);
  if (!titulo || !contenido) {
    return NextResponse.json({ ok: false, error: "Necesito título y contenido para crear el proyecto." }, { status: 400 });
  }

  const primaryPayload = { titulo, contenido, country };
  const primary = await supabaseFetch("proyectos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(primaryPayload),
  });

  if (primary.ok) {
    const saved = Array.isArray(primary.data) ? primary.data.map((item) => pickProjectRow(item, country, "database")) : [];
    return NextResponse.json({ ok: true, row: saved[0] ?? pickProjectRow(primaryPayload, country, "database") }, { status: 200 });
  }

  if (country === "CL") {
    const fallback = await supabaseFetch("proyectos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ titulo, contenido }),
    });
    if (fallback.ok) {
      const saved = Array.isArray(fallback.data) ? fallback.data.map((item) => pickProjectRow(item, "CL", "database")) : [];
      return NextResponse.json(
        {
          ok: true,
          row: saved[0] ?? { id: "", titulo, contenido, country: "CL", source: "database" },
          warning: "Proyecto guardado usando el esquema actual. Ejecuta el SQL para habilitar segmentación por país.",
        },
        { status: 200 },
      );
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: "No pude crear el proyecto. Ejecuta primero el SQL de soporte del dashboard.",
      details: primary.error,
    },
    { status: primary.status || 500 },
  );
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
  const country = normalizeCountry(toText(row.country).toUpperCase());
  const titulo = toText(row.titulo);
  const contenido = toText(row.contenido);
  if (!id || !titulo || !contenido) {
    return NextResponse.json({ ok: false, error: "Necesito id, título y contenido para actualizar el proyecto." }, { status: 400 });
  }

  const primary = await supabaseFetch(`proyectos?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ titulo, contenido, country }),
  });

  if (primary.ok) {
    const saved = Array.isArray(primary.data) ? primary.data.map((item) => pickProjectRow(item, country, "database")) : [];
    return NextResponse.json({ ok: true, row: saved[0] ?? { id, titulo, contenido, country, source: "database" } }, { status: 200 });
  }

  if (country === "CL") {
    const fallback = await supabaseFetch(`proyectos?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ titulo, contenido }),
    });
    if (fallback.ok) {
      const saved = Array.isArray(fallback.data) ? fallback.data.map((item) => pickProjectRow(item, "CL", "database")) : [];
      return NextResponse.json(
        {
          ok: true,
          row: saved[0] ?? { id, titulo, contenido, country: "CL", source: "database" },
          warning: "Proyecto actualizado usando el esquema actual. Ejecuta el SQL para habilitar segmentación por país.",
        },
        { status: 200 },
      );
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: "No pude actualizar el proyecto. Ejecuta primero el SQL de soporte del dashboard.",
      details: primary.error,
    },
    { status: primary.status || 500 },
  );
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "Necesito el id del proyecto a eliminar." }, { status: 400 });
  }

  const res = await supabaseFetch(`proyectos?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "No pude eliminar el proyecto.",
        details: res.error,
      },
      { status: res.status || 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
