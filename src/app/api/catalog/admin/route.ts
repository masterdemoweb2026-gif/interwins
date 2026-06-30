import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type CatalogProductRow = {
  id: string;
  producto: string;
  nombre_modelo_especial: string;
  precio_lista_clp: string;
  precio_lista_raw: string;
  modelo: string;
  record_type: string;
  tier: string;
  descripcion: string;
  caracteristicas: string;
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
    id: toText(row.id).trim() || toText(row.idx).trim(),
    producto: toText(row.producto).trim(),
    nombre_modelo_especial: toText(row.nombre_modelo_especial).trim(),
    precio_lista_clp: toText(row.precio_lista_clp).trim(),
    precio_lista_raw: toText(row.precio_lista_raw).trim(),
    modelo: toText(row.modelo).trim(),
    record_type: toText(row.record_type).trim(),
    tier: toText(row.tier).trim(),
    descripcion: toText(row.descripcion).trim(),
    caracteristicas: toText(row.caracteristicas).trim(),
    recomendados: Array.isArray(row.recomendados) ? row.recomendados.join(",") : toText(row.recomendados).trim(),
  };
}

function escapeCsv(value: string) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: CatalogProductRow[]) {
  const header = ["id", "producto", "nombre_modelo_especial", "precio_lista_clp", "precio_lista_raw", "modelo", "record_type", "tier", "descripcion", "caracteristicas", "recomendados"].join(
    ",",
  );
  const lines = rows.map((r) =>
    [
      r.id,
      r.producto,
      r.nombre_modelo_especial,
      r.precio_lista_clp,
      r.precio_lista_raw,
      r.modelo,
      r.record_type,
      r.tier,
      r.descripcion,
      r.caracteristicas,
      r.recomendados,
    ]
      .map(escapeCsv)
      .join(","),
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
      `select=id,producto,nombre_modelo_especial,precio_lista_clp,precio_lista_raw,modelo,record_type,tier,descripcion,caracteristicas,recomendados`,
      `order=id.desc`,
      `limit=${pageSize}`,
      `offset=${offset}`,
    ];
    if (search) {
      const like = encodeURIComponent(`*${search}*`);
      params.push(`or=(producto.ilike.${like},nombre_modelo_especial.ilike.${like},modelo.ilike.${like})`);
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
    ...(row.id ? { id: Number(row.id) } : {}),
    producto: row.producto || null,
    nombre_modelo_especial: row.nombre_modelo_especial || null,
    precio_lista_clp: row.precio_lista_clp ? Number(String(row.precio_lista_clp).replace(/[^\d]/g, "")) : null,
    precio_lista_raw: row.precio_lista_raw || null,
    modelo: row.modelo || null,
    record_type: row.record_type || null,
    tier: row.tier || null,
    descripcion: row.descripcion || null,
    caracteristicas: row.caracteristicas || null,
    recomendados: row.recomendados || null,
  }));

  const hasIds = rows.every((r) => Boolean(r.id));
  const path = hasIds ? `catalogo_productos?on_conflict=id` : `catalogo_productos`;
  const res = await supabaseFetch(path, {
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
    `select=id,producto,nombre_modelo_especial,precio_lista_clp,precio_lista_raw,modelo,record_type,tier,descripcion,caracteristicas,recomendados`,
    `order=id.desc`,
    `limit=${limit}`,
    `offset=${offset}`,
  ];
  if (search) {
    const like = encodeURIComponent(`*${search}*`);
    params.push(`or=(producto.ilike.${like},nombre_modelo_especial.ilike.${like},modelo.ilike.${like})`);
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

export async function PATCH(request: Request) {
  let raw: unknown = null;
  try {
    raw = (await request.json()) as unknown;
  } catch {}

  const body = asRecord(raw);
  const id = toText(body.id).trim();
  if (!id) return NextResponse.json({ ok: false, error: "Falta 'id'." }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (body.precio_lista_clp != null && toText(body.precio_lista_clp).trim() !== "") {
    update.precio_lista_clp = Number(toText(body.precio_lista_clp).replace(/[^\d]/g, ""));
  }
  if (body.precio_lista_raw != null && toText(body.precio_lista_raw).trim() !== "") {
    update.precio_lista_raw = toText(body.precio_lista_raw).trim();
  }
  if (!Object.keys(update).length) {
    return NextResponse.json({ ok: false, error: "No hay campos para actualizar." }, { status: 400 });
  }

  const res = await supabaseFetch(`catalogo_productos?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(update),
  });

  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
  const row = Array.isArray(res.data) ? res.data.map(pickRow)[0] : null;
  return NextResponse.json({ ok: true, row }, { status: 200 });
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
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "Falta 'id'." }, { status: 400 });

  const res = await supabaseFetch(`catalogo_productos?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true }, { status: 200 });
}
