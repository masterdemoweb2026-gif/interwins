/**
 * Llena las columnas geográficas de `punto_venta` y `dealers`.
 *
 * Extrae la comuna del texto de la dirección y deriva región y zona a partir de
 * ella (`src/lib/geo/chile.ts`). Se corre a mano cuando se agregan puntos; no
 * necesita cron porque la tabla cambia muy poco.
 *
 *   GET  /api/catalog/geo-sync             -> dry run: informa sin escribir
 *   GET  /api/catalog/geo-sync?mode=sync   -> escribe
 */

import { NextResponse } from "next/server";
import { extraerComunaDeDireccion, buscarComuna, normalizarGeo, type Comuna } from "@/lib/geo/chile";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
}

function isAuthorized(request: Request) {
  const cronSecret = (process.env.CRON_SECRET ?? "").trim();
  const syncSecret = (process.env.CATALOG_SYNC_SECRET ?? "").trim();
  if (!cronSecret && !syncSecret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : request.headers.get("x-sync-secret")?.trim() ?? "";
  return Boolean(token) && (token === cronSecret || token === syncSecret);
}

async function sb(pathAndQuery: string, init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}) {
  const base = getSupabaseUrl();
  const key = getSupabaseKey();
  if (!base || !key) return { ok: false, status: 500, data: null as unknown, error: "Faltan variables de Supabase" };
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

const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Clave de búsqueda: todo lo consultable junto, sin tildes. */
function construirClave(partes: Array<string | undefined>) {
  return normalizarGeo(partes.filter(Boolean).join(" "));
}

async function procesarPuntoVenta(dryRun: boolean) {
  const res = await sb("punto_venta?select=id,titulo,direccion,categoria&limit=500");
  if (!res.ok || !Array.isArray(res.data)) throw new Error(`No fue posible leer punto_venta: ${res.error}`);

  const filas = res.data as Array<Record<string, unknown>>;
  const resueltas: Array<{ id: unknown; comuna: Comuna; clave: string }> = [];
  const sinComuna: string[] = [];

  for (const f of filas) {
    const direccion = txt(f.direccion);
    const comuna = extraerComunaDeDireccion(direccion) ?? extraerComunaDeDireccion(txt(f.titulo));
    if (!comuna) {
      sinComuna.push(direccion || txt(f.titulo));
      continue;
    }
    resueltas.push({
      id: f.id,
      comuna,
      clave: construirClave([comuna.nombre, comuna.region, comuna.zona, direccion, txt(f.categoria)]),
    });
  }

  if (!dryRun) {
    for (const r of resueltas) {
      const upd = await sb(`punto_venta?id=eq.${encodeURIComponent(String(r.id))}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          comuna: r.comuna.nombre,
          region: r.comuna.region,
          zona: r.comuna.zona,
          busqueda_key: r.clave,
        }),
      });
      if (!upd.ok) throw new Error(`Falló el update de punto_venta ${String(r.id)}: ${upd.error}`);
    }
  }

  return { total: filas.length, resueltas: resueltas.length, sinComuna };
}

async function procesarDealers(dryRun: boolean) {
  const res = await sb("dealers?select=id,nombre_punto,region,comuna,direccion&limit=500");
  if (!res.ok || !Array.isArray(res.data)) throw new Error(`No fue posible leer dealers: ${res.error}`);

  const filas = res.data as Array<Record<string, unknown>>;
  const resueltas: Array<{ id: unknown; comuna: Comuna; clave: string }> = [];
  const sinComuna: string[] = [];

  for (const f of filas) {
    const comunaTxt = txt(f.comuna);
    const direccion = txt(f.direccion);
    // La comuna declarada manda; si no resuelve, se intenta con la dirección y
    // por último con el campo región, que en algunas filas trae una comuna.
    const comuna =
      buscarComuna(comunaTxt) ??
      extraerComunaDeDireccion(comunaTxt) ??
      extraerComunaDeDireccion(direccion) ??
      extraerComunaDeDireccion(txt(f.region));
    if (!comuna) {
      sinComuna.push(`${txt(f.nombre_punto)} (comuna="${comunaTxt}" region="${txt(f.region)}")`);
      continue;
    }
    resueltas.push({
      id: f.id,
      comuna,
      clave: construirClave([comuna.nombre, comuna.region, comuna.zona, direccion, txt(f.nombre_punto)]),
    });
  }

  if (!dryRun) {
    for (const r of resueltas) {
      const upd = await sb(`dealers?id=eq.${encodeURIComponent(String(r.id))}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          comuna_norm: r.comuna.nombre,
          region_norm: r.comuna.region,
          zona: r.comuna.zona,
          busqueda_key: r.clave,
        }),
      });
      if (!upd.ok) throw new Error(`Falló el update de dealers ${String(r.id)}: ${upd.error}`);
    }
  }

  return { total: filas.length, resueltas: resueltas.length, sinComuna };
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const dryRun = (new URL(request.url).searchParams.get("mode") ?? "").toLowerCase() !== "sync";
  try {
    const [puntoVenta, dealers] = await Promise.all([procesarPuntoVenta(dryRun), procesarDealers(dryRun)]);
    return NextResponse.json({ ok: true, dryRun, puntoVenta, dealers });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Error desconocido en geo-sync" },
      { status: 500 },
    );
  }
}
