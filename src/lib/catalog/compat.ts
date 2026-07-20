/**
 * Puente entre el vocabulario de filtros del webhook y `catalog_products`.
 *
 * El webhook trabaja con los valores tal como venían de `inter_products`
 * ("Venta", "Digitales", "Análogos, Digitales") y con una noción de frecuencia
 * que mezcla banda y texto libre. La tabla nueva normalizó todo eso
 * ("VENTA", "DIGITAL", columna `banda`). Traducir aquí permite migrar las
 * consultas sin reescribir los ~1.200 líneas de control de flujo de
 * `handleCatalog` y `handleCatalogUY`.
 *
 * La diferencia semántica que hay que cuidar: antes un producto marcado
 * "Análogos, Digitales" matcheaba los dos filtros porque la comparación era por
 * substring. Ahora el padre queda con `tecnologia` nula y son sus variantes las
 * que llevan el valor concreto, así que el filtro se aplica por fila y el
 * producto se recupera al agrupar.
 */

import { findProducts, type FiltrosBusqueda, type GrupoProducto, type Pais } from "./query";

/** Filtros tal como los maneja hoy el webhook. */
export type FiltrosLegacy = {
  tipo_producto?: string;
  tecnologia?: string;
  modalidad?: string;
  portabilidad?: string;
  frecuencia?: string;
};

function norm(v: string) {
  return String(v ?? "")
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c < 0x300 || c > 0x36f;
    })
    .join("")
    .toLowerCase()
    .trim();
}

/**
 * Traduce un valor de tecnología del vocabulario viejo al nuevo.
 *
 * Devuelve undefined para valores ambiguos como "Análogos, Digitales": ahí el
 * usuario no eligió una tecnología concreta, así que no corresponde filtrar.
 */
export function traducirTecnologia(valor?: string): "DIGITAL" | "ANALOGO" | undefined {
  const t = norm(valor ?? "");
  if (!t) return undefined;
  const dig = t.includes("digital");
  const ana = t.includes("analogo") || t.includes("analogico");
  if (dig && ana) return undefined;
  if (dig) return "DIGITAL";
  if (ana) return "ANALOGO";
  return undefined;
}

export function traducirModalidad(valor?: string): "VENTA" | "ARRIENDO" | undefined {
  const t = norm(valor ?? "");
  if (!t) return undefined;
  if (t.includes("arriendo") || t.includes("alquiler")) return "ARRIENDO";
  if (t.includes("venta")) return "VENTA";
  return undefined;
}

/** Solo se filtra por banda cuando el usuario eligió una sola; "UHF, VHF" no acota. */
export function traducirBanda(valor?: string): "VHF" | "UHF" | undefined {
  const t = norm(valor ?? "");
  if (!t) return undefined;
  const vhf = /\bvhf\b/.test(t);
  const uhf = /\buhf\b/.test(t);
  if (vhf && uhf) return undefined;
  if (vhf) return "VHF";
  if (uhf) return "UHF";
  return undefined;
}

export function traducirFiltros(pais: Pais, filtros: FiltrosLegacy): FiltrosBusqueda {
  return {
    pais,
    // tipo_producto y portabilidad conservan los mismos valores en ambas
    // tablas porque salen del mismo atributo de WooCommerce.
    tipoProducto: filtros.tipo_producto || undefined,
    portabilidad: filtros.portabilidad || undefined,
    modalidad: traducirModalidad(filtros.modalidad),
    tecnologia: traducirTecnologia(filtros.tecnologia),
    banda: traducirBanda(filtros.frecuencia),
  } as FiltrosBusqueda;
}

/** Ancla estable de un grupo, para guardarla en el estado de la conversación. */
export function anclaDeGrupo(grupo: GrupoProducto) {
  return grupo.wooId;
}

/**
 * Equivalente de `queryProducts`: devuelve un elemento por PRODUCTO, no por
 * fila, que es lo que el menú necesita listar.
 */
export async function listarProductosCompat(pais: Pais, filtros: FiltrosLegacy, limite = 25) {
  const grupos = await findProducts({ ...traducirFiltros(pais, filtros), limite: 400 });
  return grupos.slice(0, limite).map((g) => ({ product_id: anclaDeGrupo(g), nombre: g.nombre }));
}

/**
 * Valores disponibles de un atributo, ya acotados por los filtros vigentes.
 *
 * Se devuelven en el vocabulario viejo para que los mensajes del menú y el
 * parseo de las respuestas del usuario sigan funcionando sin cambios.
 */
export async function listarValoresCompat(
  pais: Pais,
  atributo: "tipo_producto" | "tecnologia" | "modalidad" | "portabilidad" | "frecuencia",
  filtros: FiltrosLegacy,
): Promise<string[]> {
  const base = traducirFiltros(pais, filtros);
  // El atributo que se está listando no debe acotarse a sí mismo.
  const sinPropio: FiltrosBusqueda = { ...base };
  if (atributo === "tecnologia") delete sinPropio.tecnologia;
  if (atributo === "modalidad") delete sinPropio.modalidad;
  if (atributo === "portabilidad") delete sinPropio.portabilidad;
  if (atributo === "frecuencia") delete sinPropio.banda;

  const grupos = await findProducts({ ...sinPropio, limite: 1500 });
  const valores = new Set<string>();

  for (const g of grupos) {
    if (atributo === "tipo_producto") {
      if (g.tipoProducto) valores.add(g.tipoProducto);
    } else if (atributo === "modalidad") {
      for (const m of g.modalidades) valores.add(m === "ARRIENDO" ? "Arriendo" : "Venta");
    } else if (atributo === "portabilidad") {
      if (g.portabilidad) valores.add(g.portabilidad);
    } else if (atributo === "tecnologia") {
      for (const v of g.variantes) {
        if (v.tecnologia === "DIGITAL") valores.add("Digitales");
        if (v.tecnologia === "ANALOGO") valores.add("Análogos");
      }
    } else if (atributo === "frecuencia") {
      for (const v of g.variantes) if (v.banda) valores.add(v.banda);
    }
  }
  return [...valores].sort((a, b) => a.localeCompare(b, "es"));
}

/** Pares tecnología/frecuencia realmente disponibles, para el menú combinado. */
export async function listarParesTecnologiaBanda(pais: Pais, filtros: FiltrosLegacy) {
  const base = traducirFiltros(pais, filtros);
  delete base.tecnologia;
  delete base.banda;
  const grupos = await findProducts({ ...base, limite: 1500 });
  const pares = new Set<string>();
  for (const g of grupos) {
    for (const v of g.variantes) {
      if (!v.tecnologia || !v.banda) continue;
      pares.add(`${v.tecnologia === "DIGITAL" ? "Digitales" : "Análogos"}|${v.banda}`);
    }
  }
  return [...pares].map((p) => {
    const [tecnologia, frecuencia] = p.split("|");
    return { tecnologia: tecnologia!, frecuencia: frecuencia! };
  });
}
