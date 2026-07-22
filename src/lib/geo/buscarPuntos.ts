/**
 * Búsqueda de puntos de venta por ubicación.
 *
 * Principio: si el cliente nombró un lugar de Chile, la respuesta nunca es "no
 * encontré". Aunque no haya un punto en esa comuna exacta, siempre se puede
 * ofrecer lo más cercano —misma región, misma zona— y decirlo con claridad.
 * Un "no encontré puntos de venta con ese dato" ante un "Santiago" es la peor
 * respuesta posible: hay nueve puntos en esa ciudad.
 *
 * La búsqueda va de lo específico a lo general y se detiene en el primer nivel
 * con resultados, de modo que la precisión se degrada de forma controlada en
 * vez de fallar.
 */

import { interpretarUbicacion, normalizarGeo, type ConsultaUbicacion } from "./chile";

export type PuntoVenta = {
  titulo: string;
  direccion: string;
  comuna?: string;
  region?: string;
  zona?: string;
  telefono?: string;
  /** De qué tabla salió, para saber si se puede ofrecer contacto de dealer. */
  fuente: "punto_venta" | "dealer";
};

/** Qué tan bien calza el resultado con lo que pidió el cliente. */
export type NivelCoincidencia = "comuna" | "region" | "zona" | "texto" | "ninguno";

export type ResultadoBusqueda = {
  puntos: PuntoVenta[];
  nivel: NivelCoincidencia;
  consulta: ConsultaUbicacion;
};

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
}

async function consultar(pathAndQuery: string): Promise<unknown[]> {
  const base = getSupabaseUrl();
  const key = getSupabaseKey();
  if (!base || !key) return [];
  try {
    const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function mapPuntoVenta(r: unknown): PuntoVenta {
  const o = (r ?? {}) as Record<string, unknown>;
  return {
    titulo: txt(o.titulo),
    direccion: txt(o.direccion),
    comuna: txt(o.comuna) || undefined,
    region: txt(o.region) || undefined,
    zona: txt(o.zona) || txt(o.categoria).replace(/^ZONA\s+/i, "") || undefined,
    fuente: "punto_venta",
  };
}

function mapDealer(r: unknown): PuntoVenta {
  const o = (r ?? {}) as Record<string, unknown>;
  return {
    titulo: txt(o.nombre_punto),
    direccion: txt(o.direccion),
    comuna: txt(o.comuna_norm) || txt(o.comuna) || undefined,
    region: txt(o.region_norm) || txt(o.region) || undefined,
    zona: txt(o.zona) || undefined,
    telefono: txt(o.telefono) || undefined,
    fuente: "dealer",
  };
}

const COLS_PV = "titulo,direccion,categoria,comuna,region,zona";
const COLS_DL = "nombre_punto,direccion,telefono,comuna,region,comuna_norm,region_norm,zona";

/** Consulta ambas tablas con el mismo criterio y junta los resultados. */
async function buscarEnAmbas(filtroPv: string, filtroDl: string, limite: number): Promise<PuntoVenta[]> {
  const [pv, dl] = await Promise.all([
    consultar(`punto_venta?select=${COLS_PV}&${filtroPv}&limit=${limite}`),
    consultar(`dealers?select=${COLS_DL}&${filtroDl}&limit=${limite}`),
  ]);
  return [...pv.map(mapPuntoVenta), ...dl.map(mapDealer)].filter((p) => p.titulo && (p.direccion || p.comuna));
}

/** Quita duplicados por nombre: un mismo local puede estar en las dos tablas. */
function dedupe(puntos: PuntoVenta[]) {
  const vistos = new Set<string>();
  return puntos.filter((p) => {
    const clave = normalizarGeo(p.titulo);
    if (!clave || vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

/**
 * Busca puntos de venta degradando la precisión de forma controlada:
 * comuna exacta -> misma región -> misma zona -> texto libre.
 *
 * El nivel alcanzado se devuelve para que la respuesta pueda ser honesta
 * ("no tenemos en Maipú, pero estos están en Santiago") en lugar de presentar
 * un resultado aproximado como si fuera exacto.
 */
export async function buscarPuntosDeVenta(texto: string, limite = 5): Promise<ResultadoBusqueda> {
  const consulta = interpretarUbicacion(texto);
  const vacio: ResultadoBusqueda = { puntos: [], nivel: "ninguno", consulta };
  if (!consulta.textoLibre) return vacio;

  // 1. Comuna exacta. Se omite cuando el cliente nombró la región completa
  // ("Santiago"), para no encerrar la respuesta en la comuna homónima.
  if (consulta.comuna && !consulta.preferirRegion) {
    const nombre = encodeURIComponent(`*${consulta.comuna.nombre}*`);
    const puntos = dedupe(await buscarEnAmbas(`comuna=ilike.${nombre}`, `or=(comuna_norm.ilike.${nombre},comuna.ilike.${nombre})`, limite));
    if (puntos.length) return { puntos: puntos.slice(0, limite), nivel: "comuna", consulta };
  }

  // 2. Misma región.
  if (consulta.region) {
    const region = encodeURIComponent(`*${consulta.region}*`);
    const puntos = dedupe(await buscarEnAmbas(`region=ilike.${region}`, `or=(region_norm.ilike.${region},region.ilike.${region})`, limite * 3));
    if (puntos.length) return { puntos: puntos.slice(0, limite), nivel: "region", consulta };
  }

  // 3. Misma zona comercial.
  if (consulta.zona) {
    const zona = encodeURIComponent(`*${consulta.zona}*`);
    const puntos = dedupe(await buscarEnAmbas(`or=(zona.ilike.${zona},categoria.ilike.${zona})`, `zona=ilike.${zona}`, limite * 3));
    if (puntos.length) return { puntos: puntos.slice(0, limite), nivel: "zona", consulta };
  }

  // 4. Último recurso: el texto tal cual, por si nombró el local y no el lugar.
  // Solo usa columnas que existen desde antes de la migración geográfica, para
  // que este nivel siga respondiendo aunque las columnas nuevas falten.
  const libre = encodeURIComponent(`*${consulta.textoLibre}*`);
  const puntos = dedupe(
    await buscarEnAmbas(
      `or=(titulo.ilike.${libre},direccion.ilike.${libre},categoria.ilike.${libre})`,
      `or=(nombre_punto.ilike.${libre},direccion.ilike.${libre},comuna.ilike.${libre},region.ilike.${libre})`,
      limite,
    ),
  );
  if (puntos.length) return { puntos: puntos.slice(0, limite), nivel: "texto", consulta };

  return vacio;
}

/**
 * Redacta la respuesta explicando qué tan cerca está de lo pedido.
 *
 * Cuando el resultado no es exacto se dice explícitamente, para no dar a
 * entender que hay un punto en una comuna donde no lo hay.
 */
export function redactarRespuestaPuntos(resultado: ResultadoBusqueda) {
  const { puntos, nivel, consulta } = resultado;
  if (!puntos.length) return "";

  const lugar = consulta.comuna?.nombre ?? consulta.region ?? consulta.textoLibre;
  const encabezado =
    nivel === "comuna"
      ? `Estos son los puntos de venta en ${lugar}:`
      : nivel === "region"
        ? // La disculpa solo aplica si pidió una comuna puntual que no tenemos.
          // Ante "Santiago" —que es la región entera— decir "no tenemos un
          // punto en Santiago Centro" confunde: sí hay puntos en esa ciudad.
          consulta.comuna && !consulta.preferirRegion
          ? `No tenemos un punto en ${consulta.comuna.nombre}, pero estos son los más cercanos en ${consulta.region}:`
          : `Estos son los puntos de venta en ${consulta.region}:`
        : nivel === "zona"
          ? `Estos son los puntos de venta de la Zona ${consulta.zona?.toLowerCase()}:`
          : `Encontré estos puntos de venta:`;

  const bloques = puntos.map((p) => {
    const lineas = [`📍 ${p.titulo}`];
    if (p.comuna) lineas.push(`   Comuna: ${p.comuna}`);
    else if (p.zona) lineas.push(`   Zona: ${p.zona}`);
    if (p.direccion) lineas.push(`   Dirección: ${p.direccion}`);
    if (p.telefono) lineas.push(`   Teléfono: ${p.telefono}`);
    return lineas.join("\n");
  });

  return [encabezado, "", bloques.join("\n\n")].join("\n");
}
