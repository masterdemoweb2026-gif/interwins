/**
 * Capa NLU (comprensión de intención) para el asistente de InterWins.
 *
 * Objetivo: entender lo que el usuario quiere aunque NO siga el menú, y extraer
 * de una sola pasada los datos que el flujo normalmente pregunta uno por uno
 * (modelo, frecuencia, tecnología, cantidad, ciudad...). Así el bot puede
 * saltarse las preguntas cuya respuesta ya tiene.
 *
 * Reglas de diseño:
 *  - Esta capa SOLO clasifica y extrae. Nunca redacta precios ni inventa
 *    productos: los datos comerciales siempre salen de Supabase.
 *  - Si la API falla, tarda demasiado o devuelve algo inválido, retorna null y
 *    el webhook sigue con la heurística de regex de siempre.
 *  - Los mensajes triviales (números de menú, "menu", "si") nunca llegan al LLM.
 */

export type NluBranch = "catalogo" | "servicio_tecnico" | "proyectos" | "puntos_venta" | "cambium" | "menu";

export type NluResult = {
  branch: NluBranch | null;
  requestKind?: "cotizacion" | "arriendo";
  productModel?: string;
  categoryKey?: "equipos_radio" | "accesorio_radio" | "camara_corporal";
  portabilidad?: "portatil" | "movil" | "repetidor";
  frequencyBand?: "VHF" | "UHF";
  technology?: "DIGITAL" | "ANALOGO";
  brand?: string;
  quantity?: number;
  location?: string;
  asksPrice?: boolean;
  asksStock?: boolean;
  wantsCompare?: boolean;
  wantsMenu?: boolean;
  wantsHuman?: boolean;
  /**
   * Solo cuando el contexto trae una pregunta de formulario pendiente:
   * true = el mensaje la responde; false = es una consulta distinta.
   * Permite que el bot no trague "¿Qué productos venden en Uruguay?" como si
   * fuera el nombre de una empresa.
   */
  answersPendingQuestion?: boolean;
  /** 0..1 — el router solo actúa sin preguntar por sobre NLU_MIN_CONFIDENCE. */
  confidence: number;
};

export type NluContext = {
  /** País del usuario: cambia qué ramas existen. */
  country: "CL" | "UY";
  /** Rama activa actual, para desambiguar mensajes de continuación ("¿y en VHF?"). */
  activeBranch?: string;
  requestKind?: "cotizacion" | "arriendo";
  /** Filtros ya aplicados en el catálogo. */
  filters?: Record<string, string | undefined>;
  /** Nombre del producto que se está viendo, si hay uno. */
  selectedProductName?: string;
  /** Nombres de la última lista mostrada, para resolver "el 2" o "el primero". */
  lastListNames?: string[];
  /**
   * Pregunta de formulario que el bot acaba de hacer y espera respuesta
   * (ej: "¿Para qué empresa es la solicitud?"). Activa el juicio
   * answersPendingQuestion en la respuesta.
   */
  pendingFormQuestion?: string;
};

/** Confianza mínima para que el router actúe directamente sin volver al menú. */
export const NLU_MIN_CONFIDENCE = 0.6;

function getAiApiKey() {
  return process.env.AI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? process.env.MINIMAX_API_KEY ?? "";
}

function getAiBaseUrl() {
  return (
    process.env.AI_BASE_URL ??
    process.env.DEEPSEEK_BASE_URL ??
    process.env.MINIMAX_BASE_URL ??
    "https://opencode.ai/zen/go/v1/chat/completions"
  );
}

function getAiChatCompletionsUrl() {
  const base = getAiBaseUrl().trim().replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  return `${base}/chat/completions`;
}

/**
 * Modelo para clasificación. Se separa de AI_MODEL a propósito: la redacción
 * puede querer un modelo más grande, pero el enrutado necesita latencia baja.
 */
function getNluModel() {
  return process.env.NLU_MODEL ?? process.env.AI_MODEL ?? process.env.DEEPSEEK_MODEL ?? "DeepSeek V4 Flash";
}

function getNluTimeoutMs() {
  const raw = Number(process.env.NLU_TIMEOUT_MS ?? "3500");
  return Number.isFinite(raw) && raw >= 500 ? raw : 3500;
}

export function isNluEnabled() {
  if (String(process.env.NLU_ENABLED ?? "true").toLowerCase() === "false") return false;
  return Boolean(getAiApiKey());
}

/** Rango Unicode de marcas diacríticas combinantes que produce NFD. */
const COMBINING_MARK_START = 0x300;
const COMBINING_MARK_END = 0x36f;

function normalize(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < COMBINING_MARK_START || code > COMBINING_MARK_END;
    })
    .join("")
    .toLowerCase()
    .trim();
}

/**
 * Mensajes que la máquina de estados ya resuelve perfecto y que no justifican
 * el costo ni la latencia de una llamada al LLM.
 */
export function shouldSkipNlu(text: string) {
  const t = normalize(text);
  if (!t) return true;
  // Selecciones de menú: "1", "2.", "opcion 3"
  if (/^(opcion\s*)?\d{1,2}[.)]?$/.test(t)) return true;
  // Comandos y respuestas cortas de control
  const control = new Set([
    "menu",
    "menu principal",
    "volver",
    "volver al menu",
    "salir",
    "cancelar",
    "terminar",
    "finalizar",
    "si",
    "no",
    "ok",
    "dale",
    "listo",
    "gracias",
    "hola",
    "buenas",
    "buenos dias",
    "buenas tardes",
    "buenas noches",
  ]);
  if (control.has(t)) return true;
  // Un solo token muy corto sin dígitos: no hay nada que extraer.
  if (t.length <= 2) return true;
  return false;
}

const BRANCHES_CL: NluBranch[] = ["catalogo", "servicio_tecnico", "proyectos", "puntos_venta", "menu"];
const BRANCHES_UY: NluBranch[] = ["catalogo", "servicio_tecnico", "proyectos", "cambium", "menu"];

function buildSystemPrompt(country: "CL" | "UY") {
  const branches = country === "UY" ? BRANCHES_UY : BRANCHES_CL;
  return [
    "Eres el clasificador de intenciones de InterWins, empresa de radiocomunicación (radios Motorola, accesorios, cámaras corporales, repetidores).",
    "Tu ÚNICA tarea es leer el mensaje del cliente y devolver un objeto JSON. No redactas respuestas al cliente.",
    "",
    "Devuelve SOLO JSON válido, sin markdown, sin ```json, sin explicaciones, sin etiquetas <think>.",
    "",
    "Esquema (omite las claves que no apliquen):",
    "{",
    `  "branch": ${branches.map((b) => `"${b}"`).join(" | ")} | null,`,
    '  "requestKind": "cotizacion" | "arriendo",',
    '  "productModel": string,',
    '  "categoryKey": "equipos_radio" | "accesorio_radio" | "camara_corporal",',
    '  "portabilidad": "portatil" | "movil" | "repetidor",',
    '  "frequencyBand": "VHF" | "UHF",',
    '  "technology": "DIGITAL" | "ANALOGO",',
    '  "brand": string,',
    '  "quantity": number,',
    '  "location": string,',
    '  "asksPrice": boolean,',
    '  "asksStock": boolean,',
    '  "wantsCompare": boolean,',
    '  "wantsMenu": boolean,',
    '  "wantsHuman": boolean,',
    '  "confidence": number entre 0 y 1',
    "}",
    "",
    "Significado de cada rama:",
    "- catalogo: quiere comprar, cotizar, arrendar, saber precio, stock, ficha o características de un equipo o accesorio.",
    "- servicio_tecnico: equipo con falla, reparación, mantención, algo que no funciona.",
    "- proyectos: quiere diseñar/implementar/mejorar un SISTEMA de comunicación completo, asesoría o consultoría.",
    country === "UY"
      ? "- cambium: conectividad, radioenlaces, cnMaestro, ePMP."
      : "- puntos_venta: dónde comprar presencialmente, direcciones, sucursales, distribuidores por zona.",
    "- menu: pide explícitamente ver el menú u opciones.",
    "- null: no logras determinarlo. Usa null en vez de adivinar.",
    "",
    "REGLAS CRÍTICAS:",
    "1. Mencionar la palabra 'proyecto' NO significa la rama proyectos. 'Necesito 10 radios para mi proyecto minero' es catalogo (quiere comprar equipos), no proyectos.",
    "   Usa proyectos solo si pide asesoría/diseño/implementación de un sistema, no si pide equipos puntuales.",
    "2. Preguntar precio, valor o '¿cuánto cuesta?' de un equipo SIEMPRE es catalogo con asksPrice=true.",
    "3. requestKind: 'arriendo' si dice arrendar/arriendo/alquilar/rentar/por evento/por mes. 'cotizacion' si dice comprar/cotizar/adquirir/precio de venta. Omítelo si no está claro.",
    "4. productModel: copia el código del modelo tal como lo escribió, sin la banda ni la tecnología. 'dm400 vhf' -> productModel:'DM400', frequencyBand:'VHF'. Si no menciona modelo, omite la clave.",
    "5. Si el cliente pide comparar o recomendar entre modelos, wantsCompare=true.",
    "6. wantsHuman=true si pide hablar con una persona, ejecutivo, vendedor o asesor humano.",
    "7. confidence alta (>=0.8) solo si el mensaje es inequívoco. Si dudas entre dos ramas, baja la confianza.",
    "8. Nunca inventes modelos, precios ni disponibilidad. Solo extraes lo que el cliente escribió.",
    "9. Si el CONTEXTO incluye 'Pregunta pendiente del formulario', agrega la clave \"answersPendingQuestion\":",
    "   true si el mensaje responde esa pregunta (aunque sea breve, como un nombre o 'Particular'),",
    "   false si el mensaje es una consulta o petición distinta que ignora la pregunta.",
    "   Ejemplo: pregunta pendiente '¿Para qué empresa es la solicitud?' + mensaje 'Entregame información de la empresa Interwins' -> false.",
    "   En caso de duda usa true, para no interrumpir al cliente que sí está respondiendo.",
  ].join("\n");
}

/** Ejemplos que fijan los casos que el sistema de regex resolvía mal. */
const FEW_SHOTS: Array<{ user: string; assistant: string }> = [
  {
    user: "Tienes el dm400 vhf y cual es su precio",
    assistant: JSON.stringify({
      branch: "catalogo",
      requestKind: "cotizacion",
      productModel: "DM400",
      frequencyBand: "VHF",
      categoryKey: "equipos_radio",
      asksPrice: true,
      asksStock: true,
      confidence: 0.95,
    }),
  },
  {
    user: "Necesito arrendar el tlk100",
    assistant: JSON.stringify({
      branch: "catalogo",
      requestKind: "arriendo",
      productModel: "TLK100",
      categoryKey: "equipos_radio",
      confidence: 0.95,
    }),
  },
  {
    user: "Necesito 10 radios para mi proyecto minero en Antofagasta",
    assistant: JSON.stringify({
      branch: "catalogo",
      requestKind: "cotizacion",
      categoryKey: "equipos_radio",
      quantity: 10,
      location: "Antofagasta",
      confidence: 0.85,
    }),
  },
  {
    user: "Quiero mejorar el sistema de comunicaciones de toda mi planta, necesito asesoría",
    assistant: JSON.stringify({ branch: "proyectos", confidence: 0.9 }),
  },
  {
    user: "Se me cayó la radio y no enciende",
    assistant: JSON.stringify({ branch: "servicio_tecnico", confidence: 0.9 }),
  },
  {
    user: "entre el dm4400e y el dm4601e cual me conviene?",
    assistant: JSON.stringify({
      branch: "catalogo",
      productModel: "DM4400e",
      categoryKey: "equipos_radio",
      wantsCompare: true,
      confidence: 0.9,
    }),
  },
];

function buildContextBlock(ctx: NluContext) {
  const lines: string[] = [];
  if (ctx.activeBranch && ctx.activeBranch !== "menu") lines.push(`Rama activa: ${ctx.activeBranch}`);
  if (ctx.requestKind) lines.push(`Tipo de solicitud en curso: ${ctx.requestKind}`);
  if (ctx.selectedProductName) lines.push(`Producto que está viendo: ${ctx.selectedProductName}`);
  const filters = Object.entries(ctx.filters ?? {})
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => `${k}=${v}`);
  if (filters.length) lines.push(`Filtros ya aplicados: ${filters.join(", ")}`);
  if (ctx.lastListNames?.length) {
    lines.push(`Última lista mostrada: ${ctx.lastListNames.slice(0, 8).map((n, i) => `${i + 1}) ${n}`).join(" | ")}`);
  }
  if (ctx.pendingFormQuestion) {
    lines.push(`Pregunta pendiente del formulario: ${ctx.pendingFormQuestion}`);
  }
  if (!lines.length) return "";
  return ["CONTEXTO DE LA CONVERSACIÓN (úsalo para resolver mensajes de continuación como '¿y en VHF?'):", ...lines].join("\n");
}

/** Extrae el primer objeto JSON del texto, tolerando ``` y etiquetas <think>. */
function extractJsonObject(raw: string) {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "");
  const start = withoutThink.indexOf("{");
  const end = withoutThink.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(withoutThink.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === v);
}

function pickString(value: unknown, maxLen = 60) {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v || v.length > maxLen) return undefined;
  return v;
}

function pickBool(value: unknown) {
  return value === true ? true : undefined;
}

/**
 * Valida la respuesta del LLM contra listas blancas. Nada que venga del modelo
 * llega al estado sin pasar por aquí.
 */
function parseNluResult(payload: unknown, country: "CL" | "UY"): NluResult | null {
  if (!isRecord(payload)) return null;

  const allowedBranches = country === "UY" ? BRANCHES_UY : BRANCHES_CL;
  const branch = pickEnum(payload.branch, allowedBranches) ?? null;

  const rawConfidence = Number(payload.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0;

  const rawQuantity = Number(payload.quantity);
  const quantity = Number.isFinite(rawQuantity) && rawQuantity > 0 && rawQuantity <= 10000 ? Math.floor(rawQuantity) : undefined;

  const result: NluResult = {
    branch,
    requestKind: pickEnum(payload.requestKind, ["cotizacion", "arriendo"] as const),
    productModel: pickString(payload.productModel, 40),
    categoryKey: pickEnum(payload.categoryKey, ["equipos_radio", "accesorio_radio", "camara_corporal"] as const),
    portabilidad: pickEnum(payload.portabilidad, ["portatil", "movil", "repetidor"] as const),
    frequencyBand: pickEnum(payload.frequencyBand, ["VHF", "UHF"] as const),
    technology: pickEnum(payload.technology, ["DIGITAL", "ANALOGO"] as const),
    brand: pickString(payload.brand, 30),
    quantity,
    location: pickString(payload.location, 60),
    asksPrice: pickBool(payload.asksPrice),
    asksStock: pickBool(payload.asksStock),
    wantsCompare: pickBool(payload.wantsCompare),
    wantsMenu: pickBool(payload.wantsMenu),
    wantsHuman: pickBool(payload.wantsHuman),
    // Tri-estado a propósito: undefined cuando el modelo no lo evaluó. Solo un
    // false explícito debe interrumpir un formulario.
    answersPendingQuestion: typeof payload.answersPendingQuestion === "boolean" ? payload.answersPendingQuestion : undefined,
    confidence,
  };

  // Sin rama y sin ningún dato aprovechable no aporta nada al router.
  const hasSignal =
    result.branch ||
    result.productModel ||
    result.categoryKey ||
    result.requestKind ||
    result.wantsMenu ||
    result.wantsHuman ||
    // El juicio sobre la pregunta pendiente es señal por sí solo: un mensaje
    // que solo responde "Particular" no trae rama ni entidades.
    result.answersPendingQuestion !== undefined;
  return hasSignal ? result : null;
}

/**
 * Clasifica el mensaje del cliente. Devuelve null si el NLU está desactivado,
 * el mensaje es trivial, o la llamada falla — en todos esos casos el webhook
 * debe continuar con su heurística de regex.
 */
export async function classifyIntent(text: string, ctx: NluContext): Promise<NluResult | null> {
  const input = String(text ?? "").trim();
  if (!input || !isNluEnabled() || shouldSkipNlu(input)) return null;

  const key = getAiApiKey();
  const contextBlock = buildContextBlock(ctx);

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: buildSystemPrompt(ctx.country) },
  ];
  for (const shot of FEW_SHOTS) {
    messages.push({ role: "user", content: shot.user });
    messages.push({ role: "assistant", content: shot.assistant });
  }
  messages.push({
    role: "user",
    content: contextBlock ? `${contextBlock}\n\nMENSAJE DEL CLIENTE:\n${input}` : input,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getNluTimeoutMs());

  try {
    const res = await fetch(getAiChatCompletionsUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getNluModel(),
        messages,
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as unknown;
    const choices = isRecord(data) ? data.choices : undefined;
    const first = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
    const message = isRecord(first) ? first.message : undefined;
    const content = isRecord(message) ? message.content : undefined;
    if (typeof content !== "string" || !content.trim()) return null;

    const payload = extractJsonObject(content);
    return payload ? parseNluResult(payload, ctx.country) : null;
  } catch {
    // Timeout, red caída o JSON corrupto: el router sigue con los regex.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
