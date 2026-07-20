/**
 * Materialización de `catalog_products`.
 *
 * Toma las tablas fuente y produce las filas del catálogo derivado. Es lógica
 * pura: recibe los datos ya leídos y devuelve filas listas para el upsert, sin
 * tocar la red. Así se puede validar contra los datos reales sin escribir nada.
 *
 * Chile y Uruguay entran por adaptadores distintos porque sus fuentes tienen
 * forma distinta —CL viene de un export de WooCommerce con padres y variaciones,
 * UY es una tabla plana de 22 filas— pero salen al mismo esquema, de modo que el
 * bot consulta un solo lugar y no vuelve a bifurcarse por país.
 */

import {
  construirCatalogo,
  claveModelo,
  clavePrecio,
  detectarBanda,
  detectarFamilia,
  detectarTecnologia,
  extraerFichaUrl,
  extraerModelo,
  normalizar,
  type InterProductRow,
  type StagingRow,
} from "./derive";
import { construirRango, PRECIO_MINIMO_PLAUSIBLE } from "./routing";

/** Fila tal como se inserta en `catalog_products`. */
export type CatalogRow = {
  pais: "CL" | "UY";
  woo_id: string;
  parent_woo_id: string | null;
  sku: string | null;
  record_type: "product" | "variation";
  nombre_completo: string;
  nombre_base: string;
  variante: string | null;
  modelo: string | null;
  modelo_key: string | null;
  compatible_con: string[];
  familia: string;
  marca: string | null;
  modalidad: string | null;
  banda: string | null;
  tecnologia: string | null;
  portabilidad: string | null;
  tipo_producto: string | null;
  categoria_path: string | null;
  imagen_url: string | null;
  descripcion: string | null;
  descripcion_corta: string | null;
  ficha_url: string | null;
  precio_min: number | null;
  precio_max: number | null;
  moneda: string;
  tiene_precio: boolean;
  en_stock: boolean;
  activo: boolean;
};

/** Fila de `catalogo_productos` (precios CL, cargados a mano). */
export type PrecioRow = {
  producto?: string | null;
  record_type?: string | null;
  precio_lista_clp?: number | string | null;
};

/** Fila de `inter_products_uy` (catálogo plano de Uruguay). */
export type UyRow = {
  product_id?: string | null;
  nombre?: string | null;
  tipo_producto?: string | null;
  tecnologia?: string | null;
  modalidad?: string | null;
  portabilidad?: string | null;
  frecuencia?: string | null;
  descripcion_corta?: string | null;
  descripcion?: string | null;
  image_url?: string | null;
  precio?: number | string | null;
};

const s = (v: unknown) => {
  const t = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return t || null;
};

/**
 * Indexa los precios por modelo.
 *
 * Solo cuentan las filas `variant`: el registro padre en `catalogo_productos`
 * trae `precio_lista_clp` nulo y son sus variantes las que llevan el precio, de
 * ahí que un producto se exprese como rango.
 */
export function indexarPrecios(filas: PrecioRow[]) {
  const porModelo = new Map<string, number[]>();
  for (const fila of filas) {
    if (normalizar(String(fila.record_type ?? "")) !== "variant") continue;
    const producto = s(fila.producto);
    if (!producto) continue;
    const monto = Number(fila.precio_lista_clp);
    if (!Number.isFinite(monto) || monto < PRECIO_MINIMO_PLAUSIBLE) continue;
    const clave = clavePrecio(producto);
    if (!clave) continue;
    const actual = porModelo.get(clave);
    if (actual) actual.push(monto);
    else porModelo.set(clave, [monto]);
  }
  return porModelo;
}

/**
 * Aplica el rango de precio respetando la restricción de coherencia del esquema.
 *
 * `catalogo_productos.precio_lista_clp` es un precio de LISTA DE VENTA. El
 * arriendo no tiene precios en ninguna tabla, así que una fila de arriendo
 * nunca hereda precio: hacerlo llevaría a cotizar un arriendo al valor de
 * compra. Afecta a los modelos que existen en ambas modalidades —DEM500,
 * DGM8500E, R2 y R7—, donde el mismo modelo tiene filas de venta y de arriendo.
 */
function aplicarPrecio(
  modelo: string | null,
  modalidad: string | undefined,
  precios: Map<string, number[]>,
) {
  const sinPrecio = { precio_min: null, precio_max: null, tiene_precio: false };
  if (!modelo || modalidad === "ARRIENDO") return sinPrecio;
  const rango = construirRango(precios.get(clavePrecio(modelo)) ?? []);
  if (!rango) return sinPrecio;
  return { precio_min: rango.min, precio_max: rango.max, tiene_precio: true };
}

/** Chile: export de WooCommerce (padres + variaciones) + atributos curados + precios. */
export function construirFilasCL(
  staging: StagingRow[],
  curados: InterProductRow[],
  precios: PrecioRow[],
): CatalogRow[] {
  const indice = indexarPrecios(precios);
  return construirCatalogo(staging, curados).map((p) => {
    const modelo = p.modelo || null;
    return {
      pais: "CL" as const,
      woo_id: p.wooId,
      parent_woo_id: p.parentWooId ?? null,
      sku: p.sku ?? null,
      record_type: p.recordType,
      nombre_completo: p.nombreCompleto,
      nombre_base: p.nombreBase,
      variante: p.variante ?? null,
      modelo,
      modelo_key: modelo ? claveModelo(modelo) : null,
      compatible_con: p.compatibleCon,
      familia: p.familia,
      marca: p.marca ?? null,
      modalidad: p.modalidad ?? null,
      banda: p.banda ?? null,
      tecnologia: p.tecnologia ?? null,
      portabilidad: p.portabilidad ?? null,
      tipo_producto: p.tipoProducto ?? null,
      categoria_path: p.categoriaPath ?? null,
      imagen_url: p.imagenUrl ?? null,
      descripcion: p.descripcion ?? null,
      descripcion_corta: p.descripcionCorta ?? null,
      ficha_url: p.fichaUrl ?? null,
      moneda: "CLP",
      ...aplicarPrecio(modelo, p.modalidad, indice),
      en_stock: p.enStock,
      activo: true,
    };
  });
}

/**
 * Uruguay: tabla plana, sin variaciones ni tabla de precios.
 *
 * Los `precio = 1` que trae la fuente son placeholders de WooCommerce, no
 * precios, y quedan descartados por el piso de plausibilidad. En la práctica
 * todo el catálogo uruguayo sale sin precio, que es lo esperado: la regla de
 * ruta lo deriva al formulario de cotización para que lo resuelva un ejecutivo.
 */
export function construirFilasUY(filas: UyRow[]): CatalogRow[] {
  const salida: CatalogRow[] = [];
  for (const fila of filas) {
    const id = s(fila.product_id);
    const nombre = s(fila.nombre);
    if (!id || !nombre) continue;

    const tipoProducto = s(fila.tipo_producto);
    const familia = detectarFamilia(tipoProducto, nombre);
    const esAccesorio = familia === "accesorio";
    const modelo = esAccesorio ? null : extraerModelo(nombre, "Motorola") || null;

    const descripcion = s(fila.descripcion);
    const descripcionCorta = s(fila.descripcion_corta);
    const monto = Number(fila.precio);
    const tienePrecio = Number.isFinite(monto) && monto >= PRECIO_MINIMO_PLAUSIBLE;

    salida.push({
      pais: "UY",
      woo_id: id,
      parent_woo_id: null,
      sku: id,
      record_type: "product",
      nombre_completo: nombre,
      nombre_base: nombre,
      variante: null,
      modelo,
      modelo_key: modelo ? claveModelo(modelo) : null,
      // La fuente uruguaya no declara compatibilidad en un campo aparte.
      compatible_con: [],
      familia,
      marca: null,
      modalidad: normalizar(s(fila.modalidad) ?? "").includes("arriendo") ? "ARRIENDO" : "VENTA",
      banda: detectarBanda(s(fila.frecuencia) ?? "") ?? null,
      tecnologia: detectarTecnologia(s(fila.tecnologia) ?? "") ?? null,
      portabilidad: s(fila.portabilidad),
      tipo_producto: tipoProducto,
      categoria_path: null,
      imagen_url: s(fila.image_url),
      descripcion,
      descripcion_corta: descripcionCorta,
      ficha_url: extraerFichaUrl(`${descripcion ?? ""}\n${descripcionCorta ?? ""}`) || null,
      precio_min: tienePrecio ? Math.round(monto) : null,
      precio_max: tienePrecio ? Math.round(monto) : null,
      moneda: "UYU",
      tiene_precio: tienePrecio,
      en_stock: true,
      activo: true,
    });
  }
  return salida;
}

/** Resumen de una corrida, para revisar qué cambió sin leer la tabla entera. */
export function resumirFilas(filas: CatalogRow[]) {
  const porFamilia: Record<string, number> = {};
  const porModalidad: Record<string, number> = {};
  for (const f of filas) {
    porFamilia[f.familia] = (porFamilia[f.familia] ?? 0) + 1;
    const m = f.modalidad ?? "sin_modalidad";
    porModalidad[m] = (porModalidad[m] ?? 0) + 1;
  }
  const modelos = new Set(filas.filter((f) => f.modelo_key).map((f) => f.modelo_key!));
  return {
    total: filas.length,
    conModelo: filas.filter((f) => f.modelo_key).length,
    modelosDistintos: modelos.size,
    conPrecio: filas.filter((f) => f.tiene_precio).length,
    conImagen: filas.filter((f) => f.imagen_url).length,
    conDescripcion: filas.filter((f) => f.descripcion).length,
    porFamilia,
    porModalidad,
  };
}
