import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type CatalogProductRow = {
  producto: string;
  precio: string;
  descripcion_corta: string;
  descripcion: string;
  image_url: string;
  recomendados: string;
};

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : {};
}

function toText(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function pickRow(value: unknown): CatalogProductRow {
  const row = asRecord(value);
  return {
    producto: toText(row.producto).trim(),
    precio: toText(row.precio).trim(),
    descripcion_corta: toText(row.descripcion_corta).trim(),
    descripcion: toText(row.descripcion).trim(),
    image_url: toText(row.image_url).trim(),
    recomendados: Array.isArray(row.recomendados) ? row.recomendados.join(",") : toText(row.recomendados).trim(),
  };
}

function escapeCsv(value: string) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: CatalogProductRow[]) {
  const header = ["producto", "precio", "descripcion_corta", "descripcion", "image_url", "recomendados"].join(",");
  const lines = rows.map((r) =>
    [r.producto, r.precio, r.descripcion_corta, r.descripcion, r.image_url, r.recomendados].map(escapeCsv).join(","),
  );
  return [header, ...lines].join("\n");
}

async function supabaseFetch(pathAndQuery: string, init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}) {
  const base = getSupabaseUrl();
  const key = getSupabaseKey();
  if (!base || !key) {
    return { ok: false, status: 500, data: null as unknown, error: "Missing Supabase env vars", headers: new Headers() };
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

  return { ok: res.ok, status: res.status, data, error: res.ok ? "" : text, headers: res.headers };
}

async function fetchAllCatalogRows(search: string) {
  const out: CatalogProductRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; offset < 20000; offset += pageSize) {
    const params: string[] = [
      `select=producto,precio,descripcion_corta,descripcion,image_url,recomendados`,
      `order=producto.asc`,
      `limit=${pageSize}`,
      `offset=${offset}`,
    ];
    if (search) {
      const like = encodeURIComponent(`*${search}*`);
      params.push(`or=(producto.ilike.${like},descripcion_corta.ilike.${like})`);
    }
    const res = await supabaseFetch(`catalogo_productos?${params.join("&")}`, { method: "GET" });
    if (!res.ok) throw new Error(`No fue posible leer catalogo_productos (${res.status})`);
    const batch = Array.isArray(res.data) ? res.data : [];
    if (!batch.length) break;
    out.push(...batch.map(pickRow).filter((r) => r.producto));
    if (batch.length < pageSize) break;
  }

  return out;
}

async function upsertCatalogRows(rows: CatalogProductRow[]) {
  const payload = rows.map((row) => ({
    producto: row.producto,
    precio: row.precio || null,
    descripcion_corta: row.descripcion_corta || null,
    descripcion: row.descripcion || null,
    image_url: row.image_url || null,
    recomendados: row.recomendados || null,
  }));

  const res = await supabaseFetch(`catalogo_productos?on_conflict=producto`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`No fue posible guardar catalogo_productos (${res.status})`);
  return Array.isArray(res.data) ? res.data.map(pickRow) : [];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "").toLowerCase();
  const search = (url.searchParams.get("search") ?? "").trim();
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? "50") || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);

  if (format === "csv") {
    try {
      const rows = await fetchAllCatalogRows(search);
      const csv = toCsv(rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="interwins-catalogo.csv"`,
        },
      });
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err ?? "Error") }, { status: 500 });
    }
  }

  const params: string[] = [
    `select=producto,precio,descripcion_corta,descripcion,image_url,recomendados`,
    `order=producto.asc`,
    `limit=${limit}`,
    `offset=${offset}`,
  ];
  if (search) {
    const like = encodeURIComponent(`*${search}*`);
    params.push(`or=(producto.ilike.${like},descripcion_corta.ilike.${like})`);
  }

  const res = await supabaseFetch(`catalogo_productos?${params.join("&")}`, { method: "GET" });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });

  const rows = Array.isArray(res.data) ? res.data.map(pickRow).filter((r) => r.producto) : [];
  return NextResponse.json({ ok: true, rows, limit, offset, search }, { status: 200 });
}

export async function POST(request: Request) {
  let raw: unknown = null;
  try {
    raw = (await request.json()) as unknown;
  } catch {}

  const row = pickRow(raw);
  if (!row.producto) return NextResponse.json({ ok: false, error: "Falta 'producto'." }, { status: 400 });

  try {
    const saved = await upsertCatalogRows([row]);
    return NextResponse.json({ ok: true, row: saved[0] ?? row }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err ?? "Error") }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let raw: unknown = null;
  try {
    raw = (await request.json()) as unknown;
  } catch {}

  const body = asRecord(raw);
  const rowsRaw = body.rows;
  const rows = Array.isArray(rowsRaw) ? rowsRaw.map(pickRow).filter((r) => r.producto) : [];
  if (!rows.length) return NextResponse.json({ ok: false, error: "No hay filas para importar." }, { status: 400 });

  try {
    const saved = await upsertCatalogRows(rows);
    return NextResponse.json({ ok: true, savedCount: saved.length }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err ?? "Error") }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const producto = (url.searchParams.get("producto") ?? "").trim();
  if (!producto) return NextResponse.json({ ok: false, error: "Falta 'producto'." }, { status: 400 });

  const res = await supabaseFetch(`catalogo_productos?producto=eq.${encodeURIComponent(producto)}`, { method: "DELETE" });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true }, { status: 200 });
}

