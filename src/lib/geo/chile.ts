/**
 * Referencia geográfica de Chile para resolver consultas de ubicación.
 *
 * Por qué existe: un cliente escribe "Santiago", "RM", "la metropolitana" o
 * "stgo", y en la base la dirección dice "MIGUEL CLARO #575 PROVIDENCIA". Sin
 * saber que Providencia pertenece a Santiago, ninguna búsqueda por texto puede
 * conectar las dos cosas, y el bot responde "no encontré puntos de venta" aun
 * teniendo nueve en esa ciudad.
 *
 * Este módulo aporta el conocimiento que falta: qué comuna pertenece a qué
 * región y a qué zona comercial, y con qué nombres la puede llamar la gente.
 */

export type Zona = "NORTE" | "CENTRO" | "SUR";

export type Comuna = {
  /** Nombre canónico, tal como se muestra al cliente. */
  nombre: string;
  region: string;
  zona: Zona;
  /** Otras formas de escribirlo: abreviaturas, errores comunes, nombre de ciudad. */
  alias?: string[];
};

/** Quita tildes y pasa a minúsculas: "Ñuñoa" y "nunoa" deben ser lo mismo. */
export function normalizarGeo(valor: string) {
  return String(valor ?? "")
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c < 0x300 || c > 0x36f;
    })
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const RM = "Región Metropolitana";

/**
 * Comunas cubiertas: todas las que aparecen en `punto_venta` y `dealers`, más
 * las capitales regionales y las comunas grandes de Santiago, que son las que
 * un cliente puede nombrar aunque todavía no haya un punto de venta ahí.
 */
export const COMUNAS: Comuna[] = [
  // --- Región Metropolitana ---
  { nombre: "Santiago Centro", region: RM, zona: "CENTRO", alias: ["santiago centro", "centro", "santiago"] },
  { nombre: "Providencia", region: RM, zona: "CENTRO" },
  { nombre: "Las Condes", region: RM, zona: "CENTRO" },
  { nombre: "Ñuñoa", region: RM, zona: "CENTRO", alias: ["nunoa"] },
  { nombre: "Vitacura", region: RM, zona: "CENTRO" },
  { nombre: "Lo Barnechea", region: RM, zona: "CENTRO" },
  { nombre: "La Reina", region: RM, zona: "CENTRO" },
  { nombre: "Macul", region: RM, zona: "CENTRO" },
  { nombre: "Peñalolén", region: RM, zona: "CENTRO", alias: ["penalolen"] },
  { nombre: "San Miguel", region: RM, zona: "CENTRO" },
  { nombre: "La Florida", region: RM, zona: "CENTRO" },
  { nombre: "Puente Alto", region: RM, zona: "CENTRO" },
  { nombre: "Maipú", region: RM, zona: "CENTRO", alias: ["maipu"] },
  { nombre: "Quilicura", region: RM, zona: "CENTRO" },
  { nombre: "Huechuraba", region: RM, zona: "CENTRO" },
  { nombre: "Recoleta", region: RM, zona: "CENTRO" },
  { nombre: "Independencia", region: RM, zona: "CENTRO" },
  { nombre: "Estación Central", region: RM, zona: "CENTRO", alias: ["estacion central"] },
  { nombre: "San Bernardo", region: RM, zona: "CENTRO" },
  { nombre: "Colina", region: RM, zona: "CENTRO" },
  { nombre: "Pudahuel", region: RM, zona: "CENTRO" },

  // --- Norte ---
  { nombre: "Arica", region: "Región de Arica y Parinacota", zona: "NORTE" },
  { nombre: "Iquique", region: "Región de Tarapacá", zona: "NORTE" },
  { nombre: "Alto Hospicio", region: "Región de Tarapacá", zona: "NORTE" },
  { nombre: "Antofagasta", region: "Región de Antofagasta", zona: "NORTE" },
  { nombre: "Calama", region: "Región de Antofagasta", zona: "NORTE" },
  { nombre: "Copiapó", region: "Región de Atacama", zona: "NORTE", alias: ["copiapo"] },
  { nombre: "Vallenar", region: "Región de Atacama", zona: "NORTE" },
  { nombre: "La Serena", region: "Región de Coquimbo", zona: "NORTE" },
  { nombre: "Coquimbo", region: "Región de Coquimbo", zona: "NORTE" },
  { nombre: "Ovalle", region: "Región de Coquimbo", zona: "NORTE" },

  // --- Centro / Sur (la zona comercial la define InterWins, no la geografía) ---
  { nombre: "Valparaíso", region: "Región de Valparaíso", zona: "SUR", alias: ["valparaiso", "valpo"] },
  { nombre: "Viña del Mar", region: "Región de Valparaíso", zona: "SUR", alias: ["vina del mar", "vina"] },
  { nombre: "Quilpué", region: "Región de Valparaíso", zona: "SUR", alias: ["quilpue"] },
  { nombre: "Villa Alemana", region: "Región de Valparaíso", zona: "SUR" },
  { nombre: "San Antonio", region: "Región de Valparaíso", zona: "SUR" },
  { nombre: "Los Andes", region: "Región de Valparaíso", zona: "SUR" },
  { nombre: "Placilla de Curauma", region: "Región de Valparaíso", zona: "SUR", alias: ["placilla", "curauma"] },
  { nombre: "Rancagua", region: "Región de O'Higgins", zona: "SUR" },
  { nombre: "San Fernando", region: "Región de O'Higgins", zona: "SUR" },
  { nombre: "Curicó", region: "Región del Maule", zona: "SUR", alias: ["curico"] },
  { nombre: "Talca", region: "Región del Maule", zona: "SUR" },
  { nombre: "Linares", region: "Región del Maule", zona: "SUR" },
  { nombre: "Chillán", region: "Región de Ñuble", zona: "SUR", alias: ["chillan"] },
  { nombre: "Concepción", region: "Región del Biobío", zona: "SUR", alias: ["concepcion", "conce"] },
  { nombre: "Talcahuano", region: "Región del Biobío", zona: "SUR" },
  { nombre: "Coronel", region: "Región del Biobío", zona: "SUR" },
  { nombre: "Los Ángeles", region: "Región del Biobío", zona: "SUR", alias: ["los angeles"] },
  { nombre: "Temuco", region: "Región de La Araucanía", zona: "SUR" },
  { nombre: "Villarrica", region: "Región de La Araucanía", zona: "SUR" },
  { nombre: "Valdivia", region: "Región de Los Ríos", zona: "SUR" },
  { nombre: "La Unión", region: "Región de Los Ríos", zona: "SUR", alias: ["la union"] },
  { nombre: "Osorno", region: "Región de Los Lagos", zona: "SUR" },
  { nombre: "Puerto Montt", region: "Región de Los Lagos", zona: "SUR" },
  { nombre: "Castro", region: "Región de Los Lagos", zona: "SUR" },
  { nombre: "Coyhaique", region: "Región de Aysén", zona: "SUR", alias: ["coihaique"] },
  { nombre: "Punta Arenas", region: "Región de Magallanes", zona: "SUR" },
];

/**
 * Formas en que la gente nombra una región. Incluye los numerales romanos que
 * usa la tabla `dealers` ("V Región de Valparaíso") y el lenguaje corriente.
 */
const ALIAS_REGION: Array<{ region: string; alias: string[] }> = [
  { region: RM, alias: ["region metropolitana", "metropolitana", "rm", "santiago", "stgo", "sgo", "capital", "xiii region", "region 13"] },
  { region: "Región de Arica y Parinacota", alias: ["arica y parinacota", "xv region", "region 15"] },
  { region: "Región de Tarapacá", alias: ["tarapaca", "i region", "region 1"] },
  { region: "Región de Antofagasta", alias: ["antofagasta", "ii region", "region 2"] },
  { region: "Región de Atacama", alias: ["atacama", "iii region", "region 3"] },
  { region: "Región de Coquimbo", alias: ["coquimbo", "iv region", "region 4"] },
  { region: "Región de Valparaíso", alias: ["valparaiso", "v region", "region 5"] },
  { region: "Región de O'Higgins", alias: ["ohiggins", "o higgins", "libertador", "vi region", "region 6"] },
  { region: "Región del Maule", alias: ["maule", "vii region", "region 7"] },
  { region: "Región de Ñuble", alias: ["nuble", "xvi region", "region 16"] },
  { region: "Región del Biobío", alias: ["biobio", "bio bio", "viii region", "region 8"] },
  { region: "Región de La Araucanía", alias: ["araucania", "ix region", "region 9"] },
  { region: "Región de Los Ríos", alias: ["los rios", "xiv region", "region 14"] },
  { region: "Región de Los Lagos", alias: ["los lagos", "x region", "region 10"] },
  { region: "Región de Aysén", alias: ["aysen", "aisen", "xi region", "region 11"] },
  { region: "Región de Magallanes", alias: ["magallanes", "antartica", "xii region", "region 12"] },
];

const ALIAS_ZONA: Array<{ zona: Zona; alias: string[] }> = [
  { zona: "NORTE", alias: ["zona norte", "norte", "el norte"] },
  { zona: "CENTRO", alias: ["zona centro", "centro", "zona central", "el centro"] },
  { zona: "SUR", alias: ["zona sur", "sur", "el sur"] },
];

/** Todas las formas de nombrar una comuna, normalizadas. */
function clavesDeComuna(c: Comuna) {
  return [normalizarGeo(c.nombre), ...(c.alias ?? []).map(normalizarGeo)].filter(Boolean);
}

const INDICE_COMUNAS = (() => {
  const idx = new Map<string, Comuna>();
  for (const c of COMUNAS) {
    for (const clave of clavesDeComuna(c)) {
      // La primera definición gana: "santiago" como alias de Santiago Centro no
      // debe ser pisado por una comuna posterior.
      if (!idx.has(clave)) idx.set(clave, c);
    }
  }
  return idx;
})();

export function buscarComuna(texto: string): Comuna | null {
  return INDICE_COMUNAS.get(normalizarGeo(texto)) ?? null;
}

/**
 * Extrae la comuna de una dirección.
 *
 * Las direcciones de InterWins la ponen al final ("MIGUEL CLARO #575
 * PROVIDENCIA", "Manuel Rodríguez Puerto Montt"), así que se busca el nombre de
 * comuna más largo que calce con el final del texto. El más largo primero,
 * porque "Puerto Montt" contiene "Montt" y "Los Ángeles" contiene "Ángeles".
 */
export function extraerComunaDeDireccion(direccion: string): Comuna | null {
  const t = normalizarGeo(direccion);
  if (!t) return null;

  let mejor: { comuna: Comuna; largo: number } | null = null;
  for (const c of COMUNAS) {
    for (const clave of clavesDeComuna(c)) {
      if (!clave) continue;
      const calzaAlFinal = t === clave || t.endsWith(` ${clave}`);
      const contiene = t.includes(` ${clave} `) || t.startsWith(`${clave} `);
      if (!calzaAlFinal && !contiene) continue;
      // Se prefiere el nombre más largo, y entre iguales el que va al final.
      const peso = clave.length + (calzaAlFinal ? 100 : 0);
      if (!mejor || peso > mejor.largo) mejor = { comuna: c, largo: peso };
    }
  }
  return mejor?.comuna ?? null;
}

export type ConsultaUbicacion = {
  comuna?: Comuna;
  region?: string;
  zona?: Zona;
  /**
   * El cliente nombró la región, no una comuna puntual ("Santiago", "RM").
   * La búsqueda debe abrirse a toda la región: quien pregunta por Santiago
   * espera los puntos de Providencia y Las Condes, no solo los del centro.
   */
  preferirRegion?: boolean;
  /** Texto libre que no se pudo resolver, para intentar match por nombre. */
  textoLibre: string;
};

/**
 * Interpreta lo que escribió el cliente.
 *
 * Resuelve en orden de especificidad: comuna, región, zona. "Santiago" y "RM"
 * se resuelven como región, de modo que devuelvan TODAS las comunas de la
 * Metropolitana y no solo la que se llame igual.
 */
export function interpretarUbicacion(texto: string): ConsultaUbicacion {
  const t = normalizarGeo(texto);
  if (!t) return { textoLibre: "" };

  const salida: ConsultaUbicacion = { textoLibre: texto.trim() };

  // Decir "zona centro" es pedir la zona completa, no la comuna de Santiago
  // Centro. Se detecta primero y se corta, porque el alias "centro" de esa
  // comuna calzaría dentro del texto y acotaría de más.
  const pideZona = /\bzona\b/.test(t);
  if (pideZona) {
    for (const { zona, alias } of ALIAS_ZONA) {
      if (alias.some((a) => t === a || t.includes(a))) {
        salida.zona = zona;
        return salida;
      }
    }
  }

  // Región antes que comuna: "Santiago" debe traer toda la RM, no solo la
  // comuna homónima.
  for (const { region, alias } of ALIAS_REGION) {
    const calce = alias.find((a) => t === a || t.includes(a));
    if (calce) {
      salida.region = region;
      // Si el texto ES el nombre de la región (no la contiene junto a otra
      // cosa), se buscará a nivel regional aunque exista una comuna homónima.
      if (t === calce) salida.preferirRegion = true;
      break;
    }
  }

  const comuna = buscarComuna(t) ?? extraerComunaDeDireccion(t);
  if (comuna) {
    salida.comuna = comuna;
    if (!salida.region) salida.region = comuna.region;
    salida.zona = comuna.zona;
  }

  if (!salida.zona) {
    for (const { zona, alias } of ALIAS_ZONA) {
      if (alias.some((a) => t === a || t.includes(a))) {
        salida.zona = zona;
        break;
      }
    }
  }

  return salida;
}

/** Comunas de una región, para ofrecer alternativas cercanas. */
export function comunasDeRegion(region: string) {
  return COMUNAS.filter((c) => c.region === region);
}
