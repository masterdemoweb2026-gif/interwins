/**
 * Materializa `catalog_products` desde las tablas fuente.
 *
 * Corre después del sync de WooCommerce (que refresca `inter_products_staging`),
 * de modo que el catálogo derivado nunca quede más viejo que su fuente.
 *
 *   GET  /api/catalog/materialize             -> dry run: informa sin escribir
 *   GET  /api/catalog/materialize?mode=sync   -> escribe
 *   POST /api/catalog/materialize  {"dryRun": false}
 *
 * Autorización igual que el sync: `CRON_SECRET` o `CATALOG_SYNC_SECRET`, por
 * header `Authorization: Bearer ...` o `x-sync-secret`.
 */

import { NextResponse } from "next/server";
import {
  construirFilasCL,
  construirFilasUY,
  resumirFilas,
  type CatalogRow,
  type PrecioRow,
  type UyRow,
} from "@/lib/catalog/materialize";
import type { InterProductRow, StagingRow } from "@/lib/catalog/derive";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
}

function getUyProductsTable() {
  return (process.env.UY_PRODUCTS_TABLE ?? "inter_products_uy").trim() || "inter_products_uy";
}

function getHeaderToken(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-sync-secret")?.trim() ?? "";
}

function isAuthorized(request: Request) {
  const cronSecret = (process.env.CRON_SECRET ?? "").trim();
  const syncSecret = (process.env.CATALOG_SYNC_SECRET ?? "").trim();
  if (!cronSecret && !syncSecret) return process.env.NODE_ENV !== "production";
  const token = getHeaderToken(request);
  return Boolean(token) && (token === cronSecret || token === syncSecret);
}

async function supabaseFetch(
  pathAndQuery: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
) {
  const base = getSupabaseUrl();
  const key = getSupabaseKey();
  if (!base || !key) {
    return { ok: false, status: 500, data: null as unknown, error: "Faltan variables de entorno de Supabase" };
  }
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, data, error: res.ok ? "" : text };
}

/** Lee una tabla completa paginando, porque PostgREST tope a 1000 filas por request. */
async function leerTabla<T>(tabla: string, select = "*"): Promise<T[]> {
  const filas: T[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const res = await supabaseFetch(`${tabla}?select=${select}&limit=${pageSize}&offset=${offset}`);
    if (!res.ok) throw new Error(`No fue posible leer ${tabla}: ${res.status} ${res.error}`);
    const lote = Array.isArray(res.data) ? (res.data as T[]) : [];
    if (!lote.length) break;
    filas.push(...lote);
    if (lote.length < pageSize) break;
  }
  return filas;
}

/**
 * Escribe en lotes. El upsert va por `(pais, woo_id)`, así que reprocesar el
 * catálogo entero es idempotente: correrlo dos veces deja el mismo resultado.
 */
async function upsertFilas(filas: CatalogRow[], batchSize = 500) {
  let escritas = 0;
  for (let i = 0; i < filas.length; i += batchSize) {
    const lote = filas.slice(i, i + batchSize).map((f) => ({ ...f, synced_at: new Date().toISOString() }));
    const res = await supabaseFetch("catalog_products?on_conflict=pais,woo_id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(lote),
    });
    if (!res.ok) throw new Error(`Falló el upsert (lote ${i / batchSize + 1}): ${res.status} ${res.error}`);
    escritas += lote.length;
  }
  return escritas;
}

/**
 * Marca inactivo lo que ya no vino en esta corrida, en vez de borrarlo: si un
 * cliente está conversando sobre un producto justo cuando corre el job, no se
 * le rompe la conversación.
 */
async function desactivarAusentes(pais: "CL" | "UY", presentes: Set<string>) {
  const actuales = await leerTabla<{ woo_id: string; activo: boolean }>(
    `catalog_products?pais=eq.${pais}&activo=is.true`,
    "woo_id,activo",
  );
  const ausentes = actuales.map((r) => r.woo_id).filter((id) => !presentes.has(id));
  if (!ausentes.length) return 0;

  for (let i = 0; i < ausentes.length; i += 200) {
    const lote = ausentes.slice(i, i + 200);
    const lista = lote.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",");
    const res = await supabaseFetch(`catalog_products?pais=eq.${pais}&woo_id=in.(${encodeURIComponent(lista)})`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ activo: false }),
    });
    if (!res.ok) throw new Error(`No fue posible desactivar ausentes: ${res.status} ${res.error}`);
  }
  return ausentes.length;
}

async function ejecutar(dryRun: boolean) {
  const inicio = Date.now();

  const [staging, curados, precios, uy] = await Promise.all([
    leerTabla<StagingRow>("inter_products_staging"),
    leerTabla<InterProductRow>("inter_products", "product_id,nombre,tipo_producto,modalidad,portabilidad,frecuencia,tecnologia"),
    leerTabla<PrecioRow>("catalogo_productos", "producto,record_type,precio_lista_clp"),
    leerTabla<UyRow>(getUyProductsTable()),
  ]);

  const filasCL = construirFilasCL(staging, curados, precios);
  const filasUY = construirFilasUY(uy);
  const filas = [...filasCL, ...filasUY];

  const reporte = {
    dryRun,
    fuentes: { staging: staging.length, curados: curados.length, precios: precios.length, uruguay: uy.length },
    CL: resumirFilas(filasCL),
    UY: resumirFilas(filasUY),
    escritas: 0,
    desactivadas: 0,
    elapsedMs: 0,
  };

  if (!dryRun) {
    reporte.escritas = await upsertFilas(filas);
    reporte.desactivadas =
      (await desactivarAusentes("CL", new Set(filasCL.map((f) => f.woo_id)))) +
      (await desactivarAusentes("UY", new Set(filasUY.map((f) => f.woo_id))));
  }

  reporte.elapsedMs = Date.now() - inicio;
  return reporte;
}

function esDryRun(request: Request, body?: { dryRun?: boolean }) {
  const url = new URL(request.url);
  const param = url.searchParams.get("dryRun");
  if (param != null) return !["0", "false", "no"].includes(param.toLowerCase());
  if (typeof body?.dryRun === "boolean") return body.dryRun;
  // Por defecto no escribe: hay que pedirlo con ?mode=sync o {"dryRun": false}.
  return (url.searchParams.get("mode") ?? "").trim().toLowerCase() !== "sync";
}

async function manejar(request: Request, body?: { dryRun?: boolean }) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await ejecutar(esDryRun(request, body))) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Error desconocido al materializar el catálogo" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return manejar(request);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
  return manejar(request, body);
}
