/**
 * Derivación del catálogo: convierte las filas crudas de WooCommerce
 * (`inter_products_staging`) en registros normalizados y autocontenidos.
 *
 * Por qué existe: hoy el catálogo vive en tres tablas que se unen por
 * coincidencia difusa de nombre, y el mismo texto ("DEP250") aparece tanto como
 * identidad de un producto como atributo de compatibilidad de un accesorio:
 *
 *   "EQUIPO RADIO ... MOTOROLA DEP250 - Digitales, VHF"   -> DEP250 es EL producto
 *   "Auricular con micrófono y PTT - DEP250, VHF"          -> DEP250 es COMPATIBILIDAD
 *
 * Buscar `nombre ilike '*dep*250*'` mezcla ambos y devuelve 30 filas donde
 * debería devolver una. Aquí se separan en `modelo` y `compatibleCon`, para que
 * la búsqueda por modelo sea exacta.
 *
 * Todo se resuelve una sola vez en la ingesta: herencia de imagen y descripción
 * del padre, banda, tecnología y modalidad. En tiempo de consulta no queda nada
 * que adivinar.
 */

/**
 * Fila cruda tal como viene de `inter_products_staging`.
 *
 * Trae además ocho pares "Nombre del atributo N" / "Valor(es) del atributo N"
 * con los atributos de WooCommerce, de ahí la firma de índice.
 */
export type StagingRow = {
  ID?: string;
  Tipo?: string;
  SKU?: string;
  Nombre?: string;
  "Descripción corta"?: string;
  "Descripción"?: string;
  "Precio normal"?: string;
  "Categorías"?: string;
  "Imágenes"?: string;
  Marcas?: string;
  "¿Existencias?"?: string;
  [columna: string]: string | undefined;
};

/**
 * Lee los atributos de WooCommerce de una fila.
 *
 * Son la fuente más confiable que existe en el export: vienen por fila —también
 * en las variaciones— y están estructurados. El sufijo del nombre
 * ("... - VHF, Capable") es apenas una representación de estos mismos datos, y
 * a veces WooCommerce no la genera: los R7 DISPLAY traen el nombre sin sufijo
 * pero con `Frecuencia=VHF | Consumo=5W | Versión=Capable` completo.
 *
 * Devuelve las claves normalizadas: 'tipo producto', 'tecnologia', 'frecuencia',
 * 'portabilidad', 'modalidad', 'version', 'consumo', 'canales'.
 */
export function leerAtributos(row: StagingRow): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (let i = 1; i <= 8; i += 1) {
    const nombre = txt(row[`Nombre del atributo ${i}`]);
    const valor = txt(row[`Valor(es) del atributo ${i}`]);
    if (nombre && valor) attrs[normalizar(nombre)] = valor;
  }
  return attrs;
}

/**
 * Descriptor legible de una variante, armado con sus atributos propios.
 *
 * Incluye todo lo que puede distinguir una variante de sus hermanas
 * ("Digitales · VHF · 5W · Capable"). La tecnología entra aquí aunque también
 * se guarde en su propia columna: sin ella, las dos variantes UHF del R2
 * —Análogos y Digitales, con precios distintos— se mostrarían ambas como
 * "UHF · 4W" y el cliente no podría elegir.
 */
export function describirVariante(attrs: Record<string, string>) {
  const orden = ["tecnologia", "frecuencia", "consumo", "version", "canales"];
  return orden
    .map((clave) => attrs[clave])
    .filter((v): v is string => Boolean(v && !v.includes(",")))
    .join(" · ");
}

/** Atributos curados que hoy viven en `inter_products`. */
export type InterProductRow = {
  product_id?: string;
  nombre?: string;
  tipo_producto?: string | null;
  modalidad?: string | null;
  portabilidad?: string | null;
  frecuencia?: string | null;
  tecnologia?: string | null;
};

export type Banda = "VHF" | "UHF";
export type Tecnologia = "DIGITAL" | "ANALOGO";
export type Modalidad = "VENTA" | "ARRIENDO";
export type Familia = "equipo_radio" | "accesorio" | "camara_corporal" | "desconocido";

export type CatalogProduct = {
  wooId: string;
  parentWooId?: string;
  sku?: string;
  recordType: "product" | "variation";
  /** Nombre completo tal como viene de Woo. */
  nombreCompleto: string;
  /** Nombre del producto padre, sin el sufijo de variante. */
  nombreBase: string;
  /** Sufijo de la variante, ej "Digitales, VHF". */
  variante?: string;
  /** Identidad del producto, ej "DEP250". Vacío si no se pudo determinar. */
  modelo: string;
  /** Modelos con los que es compatible. Solo para accesorios. */
  compatibleCon: string[];
  familia: Familia;
  marca?: string;
  modalidad?: Modalidad;
  banda?: Banda;
  /** Todas las bandas que cubre. Vacío cuando no aplica (LTE) o se desconoce. */
  bandas: Banda[];
  tecnologia?: Tecnologia;
  portabilidad?: string;
  tipoProducto?: string;
  categoriaPath?: string;
  imagenUrl?: string;
  descripcion?: string;
  descripcionCorta?: string;
  fichaUrl?: string;
  enStock: boolean;
};

const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function normalizar(value: string) {
  return String(value ?? "")
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

/** Clave de comparación de modelos: solo alfanuméricos, ej "DEP 250" -> "dep250". */
export function claveModelo(value: string) {
  return normalizar(value).replace(/[^a-z0-9]/g, "");
}

/**
 * Prefijos de marca que aparecen en `catalogo_productos.producto` pero no en el
 * modelo extraído de WooCommerce: allí el producto es "Motorola R5" mientras
 * que en Woo el modelo es "R5". Sin quitarlos, el join de precio falla
 * silenciosamente y el producto aparece como "precio por confirmar".
 */
const PREFIJOS_MARCA = ["motorola", "mototrbo", "vertex", "vertexstandard", "hytera", "cambium"];

/**
 * Clave para cruzar un modelo contra la tabla de precios, tolerando que cada
 * lado escriba la marca de forma distinta ("Motorola R5" vs "R5", "VX-80" vs
 * "VX80").
 */
export function clavePrecio(value: string) {
  let k = claveModelo(value);
  for (const marca of PREFIJOS_MARCA) {
    if (k.startsWith(marca) && k.length > marca.length) {
      k = k.slice(marca.length);
      break;
    }
  }
  return k;
}

/**
 * Separa "NOMBRE BASE - Variante" en sus dos partes.
 *
 * El sync arma el nombre de la variación exactamente así
 * (`sync/chile/route.ts`: `[nombre, variation].join(" - ")`), por lo que el
 * corte es determinista y no una heurística.
 */
export function separarVariante(nombreCompleto: string) {
  const raw = txt(nombreCompleto);
  const idx = raw.lastIndexOf(" - ");
  if (idx < 0) return { base: raw, variante: "" };
  return { base: raw.slice(0, idx).trim(), variante: raw.slice(idx + 3).trim() };
}

const PALABRAS_TECNOLOGIA = ["digitales", "digital", "analogos", "analogo", "analogicos", "analogico"];

/** ¿El sufijo de variante describe tecnología (radio) o un modelo (accesorio)? */
function varianteEsTecnologia(variante: string) {
  const primera = normalizar(variante).split(",")[0]?.trim() ?? "";
  return PALABRAS_TECNOLOGIA.some((p) => primera === p || primera.startsWith(p));
}

/**
 * Todas las bandas que cubre un texto de frecuencia.
 *
 * Necesario porque `banda` (singular) colapsa tres situaciones distintas en
 * null: un equipo que cubre ambas ("UHF, VHF", como el R5), uno al que no le
 * aplica la banda ("4G / LTE", como el TLK100) y uno desconocido. Al filtrar
 * por VHF el primero debe aparecer y el segundo no, así que la distinción tiene
 * que sobrevivir a la normalización.
 */
export function detectarBandas(texto: string): Banda[] {
  const t = normalizar(texto);
  const bandas: Banda[] = [];
  if (/\bvhf\b/.test(t)) bandas.push("VHF");
  if (/\buhf\b/.test(t)) bandas.push("UHF");
  return bandas;
}

export function detectarBanda(texto: string): Banda | undefined {
  const t = normalizar(texto);
  const tieneVhf = /\bvhf\b/.test(t);
  const tieneUhf = /\buhf\b/.test(t);
  if (tieneVhf && !tieneUhf) return "VHF";
  if (tieneUhf && !tieneVhf) return "UHF";
  return undefined;
}

export function detectarTecnologia(texto: string): Tecnologia | undefined {
  const t = normalizar(texto);
  const dig = t.includes("digital");
  const ana = t.includes("analogo") || t.includes("analogico");
  if (dig && !ana) return "DIGITAL";
  if (ana && !dig) return "ANALOGO";
  return undefined;
}

export function detectarModalidad(nombre: string, modalidadCurada?: string | null): Modalidad | undefined {
  const curada = normalizar(modalidadCurada ?? "");
  if (curada.includes("arriendo")) return "ARRIENDO";
  if (curada.includes("venta")) return "VENTA";
  // El prefijo del nombre es la señal más confiable cuando no hay dato curado.
  if (/^arriendo\b/.test(normalizar(nombre))) return "ARRIENDO";
  return undefined;
}

/**
 * Extrae el código de modelo de un nombre de equipo.
 *
 * Los radios se llaman "[ARRIENDO ]EQUIPO RADIO ... MOTOROLA DEP250", así que
 * el modelo es el último token con forma de código. Se exige al menos una letra
 * y un dígito para no confundir palabras sueltas ("RADIO", "PORTATIL") con un
 * modelo, y se listan las excepciones reales que no cumplen ese patrón.
 */
const MODELOS_SIN_DIGITO = new Set(["ion"]);
const RUIDO = new Set([
  "arriendo", "equipo", "equipos", "radio", "radios", "analogo", "analogos",
  "digital", "digitales", "portatil", "portatiles", "movil", "moviles",
  "repetidor", "repetidores", "base", "de", "con", "y", "para", "el", "la",
  "kit", "camara", "corporal", "vhf", "uhf", "mhz",
]);

export function extraerModelo(nombreBase: string, marca?: string): string {
  const limpio = txt(nombreBase).replace(/\(.*?\)/g, " ");
  const tokens = limpio
    .split(/[\s,/]+/)
    .map((t) => t.replace(/[^A-Za-z0-9-]/g, "").trim())
    .filter(Boolean);

  const marcaNorm = normalizar(marca ?? "");
  const candidatos: string[] = [];
  for (const token of tokens) {
    const n = normalizar(token);
    if (!n || RUIDO.has(n)) continue;
    if (marcaNorm && n === marcaNorm) continue;
    const tieneDigito = /\d/.test(n);
    const tieneLetra = /[a-z]/.test(n);
    if ((tieneDigito && tieneLetra) || MODELOS_SIN_DIGITO.has(n)) candidatos.push(token);
  }
  // El modelo va al final del nombre ("... MOTOROLA DEP250").
  return candidatos.length ? candidatos[candidatos.length - 1]!.toUpperCase() : "";
}

/** Clasifica la familia usando el dato curado y, si falta, el nombre. */
export function detectarFamilia(tipoProducto?: string | null, nombre?: string): Familia {
  const t = normalizar(tipoProducto ?? "");
  if (t.includes("camara") || t.includes("corporal")) return "camara_corporal";
  if (t.includes("accesorio")) return "accesorio";
  if (t.includes("equipo") || t.includes("radio")) return "equipo_radio";

  const n = normalizar(nombre ?? "");
  if (!n) return "desconocido";
  if (/\b(equipo|radio)\b/.test(n) && /\b(portatil|movil|repetidor|base)\b/.test(n)) return "equipo_radio";
  if (/(camara|bodycam|corporal)/.test(n)) return "camara_corporal";
  return "desconocido";
}

export function primeraImagen(imagenes?: string) {
  return txt(imagenes).split(",").map((s) => s.trim()).filter(Boolean)[0] ?? "";
}

export function extraerFichaUrl(texto: string) {
  const match = txt(texto).match(/https?:\/\/[^\s"'<>)]+\.pdf/i);
  return match ? match[0] : "";
}

/**
 * Construye el catálogo normalizado.
 *
 * Las variaciones se enlazan a su padre por prefijo de nombre y heredan de él
 * todo lo que Woo deja vacío: imagen, descripción, categoría y atributos
 * curados. Esa herencia es la que evita que una variación sin imagen termine
 * cayendo en una búsqueda por nombre que devuelve la foto de un accesorio.
 */
/**
 * Descarta las filas gemelas vacías del export de WooCommerce.
 *
 * La fuente trae el mismo producto dos veces: una con precio e imagen y otra
 * completamente vacía. Son ~111 filas, y son las que hacen que un producto
 * ofrezca opciones repetidas e indistinguibles ("UHF · 4W | UHF · 4W").
 *
 * Solo se descarta la vacía cuando existe una gemela poblada con el mismo
 * nombre y tipo: si todas las filas de un nombre están vacías, se conservan,
 * porque entonces no hay una versión mejor a la cual preferir.
 */
export function descartarDuplicadosVacios(staging: StagingRow[]): StagingRow[] {
  const tienecontenido = (row: StagingRow) =>
    Number(txt(row["Precio normal"])) > 0 || Boolean(primeraImagen(row["Imágenes"]));

  const conContenido = new Set<string>();
  for (const row of staging) {
    if (tienecontenido(row)) conContenido.add(`${txt(row.Nombre)}|${txt(row.Tipo)}`);
  }
  return staging.filter((row) => {
    if (tienecontenido(row)) return true;
    return !conContenido.has(`${txt(row.Nombre)}|${txt(row.Tipo)}`);
  });
}

export function construirCatalogo(
  stagingCrudo: StagingRow[],
  curados: InterProductRow[] = [],
): CatalogProduct[] {
  const staging = descartarDuplicadosVacios(stagingCrudo);
  const curadoPorId = new Map<string, InterProductRow>();
  for (const c of curados) {
    const id = txt(c.product_id);
    if (id) curadoPorId.set(id, c);
  }

  // Índice de padres por nombre exacto, para enlazar las variaciones.
  const padrePorNombre = new Map<string, StagingRow>();
  for (const row of staging) {
    if (normalizar(txt(row.Tipo)) === "variation") continue;
    const nombre = txt(row.Nombre);
    if (nombre && !padrePorNombre.has(nombre)) padrePorNombre.set(nombre, row);
  }

  const salida: CatalogProduct[] = [];

  for (const row of staging) {
    const wooId = txt(row.ID);
    const nombreCompleto = txt(row.Nombre);
    if (!wooId || !nombreCompleto) continue;

    const esVariacion = normalizar(txt(row.Tipo)) === "variation";
    const { base, variante } = esVariacion
      ? separarVariante(nombreCompleto)
      : { base: nombreCompleto, variante: "" };

    const padre = esVariacion ? padrePorNombre.get(base) : undefined;
    const curado = curadoPorId.get(wooId);
    const curadoPadre = padre ? curadoPorId.get(txt(padre.ID)) : undefined;

    // Herencia: el valor propio manda; si viene vacío, se toma el del padre.
    const heredar = (propio: string, delPadre: string) => propio || delPadre;

    // Los atributos de WooCommerce son la fuente primaria: vienen por fila y
    // las variaciones traen su valor específico ("Frecuencia=VHF") mientras el
    // padre trae el conjunto ("Frecuencia=UHF, VHF"). `inter_products` queda
    // como respaldo para las filas donde Woo no declaró el atributo.
    const attrs = leerAtributos(row);
    const attrsPadre = padre ? leerAtributos(padre) : {};
    const attr = (clave: string) => attrs[clave] || attrsPadre[clave] || "";

    const marca = heredar(txt(row.Marcas), txt(padre?.Marcas));
    const categoriaPath = heredar(txt(row["Categorías"]), txt(padre?.["Categorías"]));
    const tipoProducto = attr("tipo producto") || txt(curado?.tipo_producto) || txt(curadoPadre?.tipo_producto);
    const familia = detectarFamilia(tipoProducto, base);

    // Un sufijo de tecnología describe al equipo; uno con forma de modelo
    // indica con qué equipo es compatible el accesorio.
    const varianteEsTec = varianteEsTecnologia(variante);
    const modeloCompatible = variante && !varianteEsTec ? variante.split(",")[0]?.trim() ?? "" : "";

    const esAccesorio = familia === "accesorio" || (Boolean(modeloCompatible) && familia !== "equipo_radio");
    // Un accesorio no tiene modelo propio: se identifica por con qué es
    // compatible. Extraerle uno produce colisiones peligrosas — "Cable de
    // Programación Equipos R7" daría modelo R7 y competiría con el radio R7 en
    // una búsqueda de "cuánto vale el R7".
    const modelo = esAccesorio ? "" : extraerModelo(base, marca);
    const compatibleCon = modeloCompatible ? [modeloCompatible.toUpperCase()] : [];

    const descripcion = heredar(txt(row["Descripción"]), txt(padre?.["Descripción"]));
    const descripcionCorta = heredar(txt(row["Descripción corta"]), txt(padre?.["Descripción corta"]));
    const imagenUrl = heredar(primeraImagen(row["Imágenes"]), primeraImagen(padre?.["Imágenes"]));

    salida.push({
      wooId,
      parentWooId: padre ? txt(padre.ID) : undefined,
      sku: txt(row.SKU) || undefined,
      recordType: esVariacion ? "variation" : "product",
      nombreCompleto,
      nombreBase: base,
      // Cuando WooCommerce no generó el sufijo del nombre, se describe la
      // variante con sus propios atributos ("VHF · 5W · Capable"), que es lo
      // único que la distingue de sus hermanas.
      variante: variante || (esVariacion ? describirVariante(attrs) : "") || undefined,
      modelo,
      compatibleCon,
      familia: esAccesorio ? "accesorio" : familia,
      marca: marca || undefined,
      modalidad: detectarModalidad(nombreCompleto, attr("modalidad") || curado?.modalidad || curadoPadre?.modalidad),
      bandas: (() => {
        const propias = detectarBandas(attrs["frecuencia"] ?? "");
        if (propias.length) return propias;
        const delSufijo = detectarBandas(variante);
        if (delSufijo.length) return delSufijo;
        const heredadas = detectarBandas(attr("frecuencia"));
        if (heredadas.length) return heredadas;
        return detectarBandas(txt(curado?.frecuencia ?? ""));
      })(),
      banda:
        detectarBanda(attrs["frecuencia"] ?? "") ??
        detectarBanda(variante) ??
        detectarBanda(attr("frecuencia")) ??
        detectarBanda(txt(curado?.frecuencia ?? "")),
      tecnologia:
        detectarTecnologia(attrs["tecnologia"] ?? "") ??
        (varianteEsTec ? detectarTecnologia(variante) : undefined) ??
        detectarTecnologia(attr("tecnologia")) ??
        detectarTecnologia(txt(curado?.tecnologia ?? "")),
      portabilidad: attr("portabilidad") || txt(curado?.portabilidad) || txt(curadoPadre?.portabilidad) || undefined,
      tipoProducto: tipoProducto || undefined,
      categoriaPath: categoriaPath || undefined,
      imagenUrl: imagenUrl || undefined,
      descripcion: descripcion || undefined,
      descripcionCorta: descripcionCorta || undefined,
      fichaUrl: extraerFichaUrl(`${descripcion}\n${descripcionCorta}`) || undefined,
      enStock: txt(row["¿Existencias?"]) !== "0",
    });
  }

  return salida;
}
