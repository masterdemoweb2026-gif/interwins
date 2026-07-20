/**
 * Capa única de consulta del catálogo.
 *
 * Reemplaza las ~15 funciones de consulta repartidas en el webhook
 * (`queryProducts`, `queryProductsByName`, `queryDirectCatalogCandidatesBroad`,
 * `loadProductDetail`, `loadCatalogProductCommercialData`, sus gemelas `*UY`…),
 * que consultaban tres tablas distintas y por eso daban resultados distintos
 * según se llegara por el menú o escribiendo libre.
 *
 * Aquí hay una sola fuente —`catalog_products`— y por lo tanto un solo
 * resultado: que la ruta guiada y la libre coincidan deja de ser algo que hay
 * que afinar y pasa a ser estructural.
 *
 * Concepto central: el usuario no conversa sobre filas, conversa sobre
 * PRODUCTOS. "El DEP250" son 5 filas en la base (un padre y cuatro variantes),
 * pero una sola cosa en la conversación. `GrupoProducto` es esa unidad.
 */

import { claveModelo } from "./derive";
import { construirRango, decidirRuta, type IntencionCompra, type RangoPrecio, type Ruta } from "./routing";

export type Pais = "CL" | "UY";

/** Una fila de `catalog_products`. */
export type ProductoFila = {
  pais: Pais;
  woo_id: string;
  parent_woo_id: string | null;
  record_type: "product" | "variation";
  nombre_completo: string;
  nombre_base: string;
  variante: string | null;
  modelo: string | null;
  modelo_key: string | null;
  compatible_con: string[];
  familia: string;
  modalidad: string | null;
  banda: string | null;
  bandas: string[] | null;
  tecnologia: string | null;
  portabilidad: string | null;
  tipo_producto: string | null;
  imagen_url: string | null;
  descripcion: string | null;
  descripcion_corta: string | null;
  ficha_url: string | null;
  precio_min: number | null;
  precio_max: number | null;
  moneda: string;
  tiene_precio: boolean;
  en_stock: boolean;
};

/** Una variante concreta: lo que el usuario termina eligiendo. */
export type Variante = {
  wooId: string;
  banda: string | null;
  tecnologia: string | null;
  modalidad: string | null;
  etiqueta: string;
};

/** Un producto tal como se habla de él en la conversación. */
export type GrupoProducto = {
  /** woo_id de la fila ancla (el padre). Identifica el grupo de forma estable. */
  wooId: string;
  modelo: string;
  modeloKey: string;
  nombre: string;
  familia: string;
  tipoProducto?: string;
  portabilidad?: string;
  modalidades: string[];
  imagenUrl?: string;
  descripcion?: string;
  descripcionCorta?: string;
  fichaUrl?: string;
  precio: RangoPrecio | null;
  tienePrecio: boolean;
  moneda: string;
  variantes: Variante[];
};

export type FiltrosBusqueda = {
  pais: Pais;
  modelo?: string;
  texto?: string;
  familia?: string;
  tipoProducto?: string;
  modalidad?: "VENTA" | "ARRIENDO";
  banda?: "VHF" | "UHF";
  tecnologia?: "DIGITAL" | "ANALOGO";
  portabilidad?: string;
  limite?: number;
};

const COLUMNAS =
  "pais,woo_id,parent_woo_id,record_type,nombre_completo,nombre_base,variante,modelo,modelo_key," +
  "compatible_con,familia,modalidad,banda,bandas,tecnologia,portabilidad,tipo_producto,imagen_url," +
  "descripcion,descripcion_corta,ficha_url,precio_min,precio_max,moneda,tiene_precio,en_stock";

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
}

async function consultar(queryString: string): Promise<ProductoFila[]> {
  const base = getSupabaseUrl();
  const key = getSupabaseKey();
  if (!base || !key) return [];
  try {
    const res = await fetch(`${base}/rest/v1/catalog_products?${queryString}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as ProductoFila[]) : [];
  } catch {
    return [];
  }
}

function condicionesBase(f: FiltrosBusqueda) {
  const partes = [`select=${COLUMNAS}`, `pais=eq.${f.pais}`, `activo=is.true`];
  if (f.familia) partes.push(`familia=eq.${encodeURIComponent(f.familia)}`);
  if (f.tipoProducto) partes.push(`tipo_producto=eq.${encodeURIComponent(f.tipoProducto)}`);
  if (f.modalidad) partes.push(`modalidad=eq.${f.modalidad}`);
  // Se filtra por el array: un equipo que cubre ambas bandas debe aparecer en
  // las dos búsquedas, y uno sin banda aplicable (LTE) en ninguna.
  if (f.banda) partes.push(`bandas=cs.{${f.banda}}`);
  if (f.tecnologia) partes.push(`tecnologia=eq.${f.tecnologia}`);
  if (f.portabilidad) partes.push(`portabilidad=eq.${encodeURIComponent(f.portabilidad)}`);
  return partes;
}

/**
 * Etiqueta legible de una variante, ej "Digital VHF".
 *
 * Cuando la fuente no expresa tecnología se usa el sufijo crudo tal cual: los
 * R7 se diferencian por "UHF, Enabled" y "UHF, Capable" (nivel de funciones de
 * Motorola, no tecnología), y quedarse solo con la banda mostraría dos opciones
 * llamadas "UHF" que el cliente no podría distinguir.
 */
function etiquetaVariante(fila: ProductoFila) {
  // El descriptor propio manda porque es el único que distingue variantes que
  // comparten banda y tecnología: dos R7 "Digital UHF" que en realidad son
  // "UHF · 4W · Capable" y "UHF · 4W · Enabled".
  const crudo = (fila.variante ?? "").trim();
  if (crudo) {
    return crudo
      .replace(/\bDigitales\b/gi, "Digital")
      .replace(/\bAnálogos\b/gi, "Análogo")
      .replace(/\s*,\s*/g, " · ");
  }
  const tec = fila.tecnologia === "DIGITAL" ? "Digital" : fila.tecnologia === "ANALOGO" ? "Análogo" : "";
  return [tec, fila.banda ?? ""].filter(Boolean).join(" ") || "Estándar";
}

/**
 * Colapsa variantes que se ven idénticas para el cliente.
 *
 * Quedan algunos casos donde la fuente tiene dos variantes con los mismos
 * atributos y distinto precio en WooCommerce —DEP550e tiene dos "VHF"— sin
 * ningún dato que las separe. Ofrecer "1) VHF 2) VHF" no es una elección: es
 * ruido. Se conserva la primera y se descarta la repetida.
 */
function dedupePorEtiqueta(variantes: Variante[]) {
  const vistas = new Set<string>();
  return variantes.filter((v) => {
    if (vistas.has(v.etiqueta)) return false;
    vistas.add(v.etiqueta);
    return true;
  });
}

/**
 * Agrupa filas en productos conversables.
 *
 * Un grupo hereda la imagen y la descripción de la fila que las tenga —el padre
 * suele traerlas y la variante no— y su precio es el rango de todas sus filas
 * con precio.
 */
export function agrupar(filas: ProductoFila[]): GrupoProducto[] {
  const grupos = new Map<string, ProductoFila[]>();
  for (const fila of filas) {
    // Se agrupa por producto padre, no por modelo: un mismo modelo puede
    // corresponder a productos distintos —"R7 DISPLAY" y "R7 NON-DISPLAY",
    // "R5 ANÁLOGO" y "R5 DIGITAL"— y fundirlos haría que el bot muestre uno y
    // esconda el otro. El modelo sigue siendo la clave de BÚSQUEDA; el nombre
    // base es la unidad de la que se conversa.
    const clave = fila.nombre_base ? `${fila.modalidad ?? "-"}|${fila.nombre_base}` : `id|${fila.woo_id}`;
    const actual = grupos.get(clave);
    if (actual) actual.push(fila);
    else grupos.set(clave, [fila]);
  }

  const salida: GrupoProducto[] = [];
  for (const [, integrantes] of grupos) {
    const padre = integrantes.find((f) => f.record_type === "product") ?? integrantes[0]!;
    const precios = integrantes.flatMap((f) => [f.precio_min, f.precio_max]).filter((n): n is number => typeof n === "number");
    const rango = construirRango(precios);

    salida.push({
      wooId: padre.woo_id,
      modelo: padre.modelo ?? "",
      modeloKey: padre.modelo_key ?? "",
      nombre: padre.nombre_base || padre.nombre_completo,
      familia: padre.familia,
      tipoProducto: integrantes.find((f) => f.tipo_producto)?.tipo_producto ?? undefined,
      portabilidad: integrantes.find((f) => f.portabilidad)?.portabilidad ?? undefined,
      modalidades: [...new Set(integrantes.map((f) => f.modalidad).filter((m): m is string => Boolean(m)))],
      imagenUrl: integrantes.find((f) => f.imagen_url)?.imagen_url ?? undefined,
      descripcion: integrantes.find((f) => f.descripcion)?.descripcion ?? undefined,
      descripcionCorta: integrantes.find((f) => f.descripcion_corta)?.descripcion_corta ?? undefined,
      fichaUrl: integrantes.find((f) => f.ficha_url)?.ficha_url ?? undefined,
      precio: rango,
      tienePrecio: Boolean(rango),
      moneda: padre.moneda,
      variantes: dedupePorEtiqueta(
        integrantes
          .filter((f) => f.record_type === "variation")
          .map((f) => ({
            wooId: f.woo_id,
            banda: f.banda,
            tecnologia: f.tecnologia,
            modalidad: f.modalidad,
            etiqueta: etiquetaVariante(f),
          })),
      ),
    });
  }
  return salida;
}

/**
 * Busca productos.
 *
 * Cuando hay `modelo`, la búsqueda es un match exacto sobre `modelo_key` — lo
 * que antes era `nombre ilike '*dep*250*'` y devolvía 30 filas mezclando el
 * radio con los audífonos compatibles.
 */
export async function findProducts(filtros: FiltrosBusqueda): Promise<GrupoProducto[]> {
  const limite = filtros.limite ?? 60;
  const partes = condicionesBase(filtros);

  if (filtros.modelo) {
    const clave = claveModelo(filtros.modelo);
    if (!clave) return [];
    partes.push(`modelo_key=eq.${encodeURIComponent(clave)}`);
  } else if (filtros.texto) {
    const patron = filtros.texto.trim().replace(/[%,()]/g, " ").trim();
    if (!patron) return [];
    partes.push(`nombre_completo=ilike.*${encodeURIComponent(patron)}*`);
  }

  partes.push(`limit=${limite}`, `order=record_type.asc,nombre_completo.asc`);
  return agrupar(await consultar(partes.join("&")));
}

/** Accesorios declarados compatibles con un modelo. */
export async function findAccesoriosCompatibles(pais: Pais, modelo: string, limite = 20) {
  const clave = String(modelo ?? "").trim().toUpperCase();
  if (!clave) return [];
  const partes = [
    `select=${COLUMNAS}`,
    `pais=eq.${pais}`,
    `activo=is.true`,
    `compatible_con=cs.{"${encodeURIComponent(clave)}"}`,
    `limit=${limite}`,
    `order=nombre_completo.asc`,
  ];
  return agrupar(await consultar(partes.join("&")));
}

/**
 * Ficha del producto al que pertenece una fila.
 *
 * Se resuelve en dos pasos a propósito: primero la fila pedida, después todas
 * las de su mismo producto. Traer solo la fila dejaría la ficha sin sus
 * variantes, y el cliente que llega por el menú vería el equipo sin poder
 * elegir versión, mientras que el que llega escribiendo el modelo sí puede.
 */
export async function findFicha(pais: Pais, wooId: string): Promise<GrupoProducto | null> {
  const filas = await consultar(`select=${COLUMNAS}&pais=eq.${pais}&woo_id=eq.${encodeURIComponent(wooId)}&limit=1`);
  const fila = filas[0];
  if (!fila) return null;

  const hermanas = await consultar(
    `select=${COLUMNAS}&pais=eq.${pais}&activo=is.true` +
      `&nombre_base=eq.${encodeURIComponent(fila.nombre_base)}` +
      (fila.modalidad ? `&modalidad=eq.${fila.modalidad}` : "") +
      `&limit=60`,
  );
  return agrupar(hermanas.length ? hermanas : filas)[0] ?? null;
}

/**
 * Valores disponibles para construir los menús, calculados sobre lo que
 * realmente existe con los filtros ya aplicados. Evita ofrecer una opción que
 * después no devuelve nada.
 */
export async function findFacetas(filtros: FiltrosBusqueda) {
  const partes = condicionesBase(filtros);
  partes.push("limit=1500");
  const filas = await consultar(partes.join("&"));

  const contar = (clave: keyof ProductoFila) => {
    const cuenta = new Map<string, number>();
    for (const fila of filas) {
      const valor = fila[clave];
      if (typeof valor !== "string" || !valor) continue;
      cuenta.set(valor, (cuenta.get(valor) ?? 0) + 1);
    }
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([valor, total]) => ({ valor, total }));
  };

  return {
    familias: contar("familia"),
    modalidades: contar("modalidad"),
    bandas: contar("banda"),
    tecnologias: contar("tecnologia"),
    portabilidades: contar("portabilidad"),
    total: filas.length,
  };
}

/**
 * Resuelve un modelo y decide qué hacer con él en un solo paso.
 *
 * Es el punto de entrada que usa el webhook: dado lo que el usuario pidió,
 * devuelve el producto y la ruta (mostrar precio, derivar a arriendo o derivar
 * a cotización) ya decidida según las reglas de negocio.
 */
export async function resolverModelo(args: {
  pais: Pais;
  modelo: string;
  intencion: IntencionCompra;
}): Promise<{ grupo: GrupoProducto; ruta: Ruta; alternativas: GrupoProducto[] } | null> {
  const grupos = await findProducts({ pais: args.pais, modelo: args.modelo });
  if (!grupos.length) return null;

  // Si el cliente pidió arriendo y existe esa modalidad, se prefiere; si pidió
  // comprar, se prefiere la de venta. Cuando solo existe una, esa se usa.
  const preferida = args.intencion === "arriendo" ? "ARRIENDO" : "VENTA";
  const grupo =
    grupos.find((g) => g.modalidades.includes(preferida)) ??
    grupos.find((g) => g.tienePrecio) ??
    grupos[0]!;

  const disponibilidad = {
    venta: grupos.some((g) => g.modalidades.includes("VENTA")),
    arriendo: grupos.some((g) => g.modalidades.includes("ARRIENDO")),
  };

  return {
    grupo,
    ruta: decidirRuta({
      nombreProducto: grupo.modelo || grupo.nombre,
      precio: grupo.precio,
      disponibilidad,
      intencion: args.intencion,
    }),
    alternativas: grupos.filter((g) => g !== grupo),
  };
}
