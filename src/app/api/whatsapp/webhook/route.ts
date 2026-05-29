import crypto from "crypto";
import fs from "node:fs";
import { NextResponse } from "next/server";
import { inboxAdd } from "@/lib/debugInbox";

export const runtime = "nodejs";

function getVerifyToken() {
  return process.env.WHATSAPP_VERIFY_TOKEN ?? "";
}

function getWebhookSecret() {
  return process.env.GOWA_WEBHOOK_SECRET ?? "";
}

function getGowaBaseUrl() {
  return (process.env.GOWA_BASE_URL ?? "").replace(/\/+$/, "");
}

function getGowaBasicAuth() {
  return process.env.GOWA_BASIC_AUTH ?? "";
}

function getGowaDeviceId() {
  return process.env.GOWA_DEVICE_ID ?? "";
}

function shouldAutoReply() {
  const raw = String(process.env.WHATSAPP_AUTO_REPLY ?? "").trim().toLowerCase();
  if (!raw) return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

function toBasicAuthHeader(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("basic ")) return trimmed;
  return `Basic ${Buffer.from(trimmed).toString("base64")}`;
}

function verifySignature(rawBody: string, signatureHeader: string | null) {
  const secret = getWebhookSecret();
  if (!secret) return true;
  if (!signatureHeader) return false;

  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

async function sendTextMessage(to: string, text: string) {
  const baseUrl = getGowaBaseUrl();
  if (!baseUrl) {
    inboxAdd({ source: "gowa", signatureValid: null, from: to, text: "[DEBUG] OUT: missing GOWA_BASE_URL" });
    return;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = toBasicAuthHeader(getGowaBasicAuth());
  if (auth) headers.Authorization = auth;
  const deviceId = getGowaDeviceId();
  if (deviceId) headers["X-Device-Id"] = deviceId;

  // #region debug-point C:send-message
  (() => {
    try {
      const p = ".dbg/whatsapp-no-reply.env";
      let u = process.env.DEBUG_SERVER_URL || "http://127.0.0.1:7777/event";
      let s = process.env.DEBUG_SESSION_ID || "whatsapp-no-reply";
      try {
        const e = fs.readFileSync(p, "utf8");
        u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u;
        s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s;
      } catch {}
      fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: s,
          runId: "post-fix",
          hypothesisId: "C",
          location: "webhook/route.ts:sendTextMessage",
          msg: "[DEBUG] sending gowa message",
          data: {
            to,
            messageLen: text.length,
            hasAuth: Boolean(auth),
            hasDeviceId: Boolean(deviceId),
            baseUrlPresent: Boolean(baseUrl),
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
    } catch {}
  })();
  // #endregion

  try {
    const res = await fetch(`${baseUrl}/send/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone: to, message: text }),
    });

    // #region debug-point C:send-result
    (() => {
      try {
        const p = ".dbg/whatsapp-no-reply.env";
        let u = process.env.DEBUG_SERVER_URL || "http://127.0.0.1:7777/event";
        let s = process.env.DEBUG_SESSION_ID || "whatsapp-no-reply";
        try {
          const e = fs.readFileSync(p, "utf8");
          u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u;
          s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s;
        } catch {}
        fetch(u, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: s,
            runId: "post-fix",
            hypothesisId: "C",
            location: "webhook/route.ts:sendTextMessage",
            msg: "[DEBUG] gowa send response received",
            data: { status: res.status, ok: res.ok },
            ts: Date.now(),
          }),
        }).catch(() => {});
      } catch {}
    })();
    // #endregion

    inboxAdd({
      source: "gowa",
      signatureValid: null,
      from: to,
      text: `[DEBUG] OUT: send/message status=${res.status} ok=${res.ok}`,
    });
  } catch (err) {
    // #region debug-point C:send-error
    (() => {
      try {
        const p = ".dbg/whatsapp-no-reply.env";
        let u = process.env.DEBUG_SERVER_URL || "http://127.0.0.1:7777/event";
        let s = process.env.DEBUG_SESSION_ID || "whatsapp-no-reply";
        try {
          const e = fs.readFileSync(p, "utf8");
          u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u;
          s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s;
        } catch {}
        fetch(u, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: s,
            runId: "post-fix",
            hypothesisId: "C",
            location: "webhook/route.ts:sendTextMessage",
            msg: "[DEBUG] gowa send threw error",
            data: { err: String(err) },
            ts: Date.now(),
          }),
        }).catch(() => {});
      } catch {}
    })();
    // #endregion
    inboxAdd({ source: "gowa", signatureValid: null, from: to, text: `[DEBUG] OUT: send/message error=${String(err)}` });
    throw err;
  }
}

type Branch = "menu" | "catalogo" | "servicio_tecnico" | "proyectos" | "puntos_venta";

type CatalogFilters = {
  tipo_producto?: string;
  tecnologia?: string;
  modalidad?: string;
  portabilidad?: string;
  frecuencia?: string;
};

type CatalogPendingOptions = {
  attr: keyof CatalogFilters;
  options: string[];
};

type CatalogQuoteStep = "nombre" | "telefono" | "email" | "empresa" | "direccion" | "ciudad" | "region" | "final";

type CatalogQuote = {
  step: CatalogQuoteStep;
  data: Partial<{
    nombre: string;
    telefono: string;
    email: string;
    empresa: string;
    direccion: string;
    ciudad: string;
    region: string;
  }>;
};

type CatalogState = {
  filters: CatalogFilters;
  pending?: CatalogPendingOptions;
  lastList?: Array<{ product_id: string; nombre: string }>;
  selectedProductId?: string;
  quote?: CatalogQuote;
  status?: "idle" | "wait_finish_cotizacion";
  recommended?: {
    mode?: "offer" | "list" | "detail";
    remainingIds: string[];
    includedIds: string[];
    rejectedIds: string[];
    currentId?: string;
  };
};

type ProjectsState = {
  offset: number;
  lastList?: Array<{ id: number; titulo: string }>;
  reading?: {
    id: number;
    offset: number;
  };
};

type PointsState = {
  lastQuery?: string;
};

type UserState = {
  v: 1;
  greeted: boolean;
  activeBranch: Branch;
  userName?: string;
  recentInboundIds?: string[];
  catalog: CatalogState;
  projects: ProjectsState;
  points: PointsState;
};

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
}

function getMinimaxApiKey() {
  return process.env.MINIMAX_API_KEY ?? "";
}

function getMinimaxBaseUrl() {
  return (process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1").replace(/\/+$/, "");
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extractLocationQuery(text: string) {
  const raw = text.trim();
  if (!raw) return "";
  const rawLower = raw.toLowerCase();
  const lastEn = rawLower.lastIndexOf(" en ");
  if (lastEn !== -1) {
    const tail = raw.slice(lastEn + 4).trim();
    if (tail) return tail;
  }
  return raw;
}

function tokenizeLocationQuery(text: string) {
  const stop = new Set([
    "estoy",
    "toy",
    "ando",
    "vivo",
    "viviendo",
    "me",
    "encuentro",
    "en",
    "la",
    "el",
    "los",
    "las",
    "un",
    "una",
    "de",
    "del",
    "al",
    "por",
    "para",
    "cerca",
    "aca",
    "aqui",
    "acá",
    "aquí",
    "mi",
    "mis",
    "con",
    "soy",
    "s",
    "stoy",
  ]);

  return normalizeText(text)
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 3)
    .filter((t) => !stop.has(t));
}

function scoreTokenMatch(tokens: string[], hay: string) {
  if (!tokens.length) return 0;
  let matches = 0;
  for (const t of tokens) {
    if (hay.includes(t)) matches += 1;
  }
  return matches;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getRecordValue(record: unknown, key: string): unknown {
  if (!isRecord(record)) return undefined;
  return record[key];
}

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isMenuCommand(text: string) {
  const t = normalizeText(text);
  return (
    t === "menu" ||
    t === "menú" ||
    t.includes("menu principal") ||
    t.includes("menú principal") ||
    t === "inicio" ||
    t === "volver al menu" ||
    t === "volver al menú" ||
    t === "volver al menu principal" ||
    t === "volver al menú principal"
  );
}

function detectBranchIntent(text: string): { branch: Branch | null; wantsMenu: boolean } {
  const t = normalizeText(text);
  if (!t) return { branch: null, wantsMenu: false };

  const wantsMenu =
    t.includes("volver al menu") ||
    t.includes("volver al menú") ||
    t.includes("ir al menu") ||
    t.includes("ir al menú") ||
    t.includes("regresar al menu") ||
    t.includes("regresar al menú") ||
    t.includes("menu principal") ||
    t.includes("menú principal") ||
    t === "menu" ||
    t === "menú";

  const mentionsCatalog = t.includes("catalogo") || t.includes("catálogo");
  const mentionsServicio = t.includes("servicio tecnico") || t.includes("servicio técnico") || t.includes("soporte tecnico") || t.includes("soporte técnico");
  const mentionsProjects = t.includes("proyecto") || t.includes("proyectos");
  const mentionsPoints = t.includes("punto de venta") || t.includes("puntos de venta") || t.includes("dealer") || t.includes("dealers");

  if (mentionsCatalog) return { branch: "catalogo", wantsMenu };
  if (mentionsServicio) return { branch: "servicio_tecnico", wantsMenu };
  if (mentionsProjects) return { branch: "proyectos", wantsMenu };
  if (mentionsPoints) return { branch: "puntos_venta", wantsMenu };
  return { branch: null, wantsMenu };
}

function detectQuoteIntent(text: string) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    t.includes("cotiz") ||
    t.includes("cotizacion") ||
    t.includes("cotización") ||
    t.includes("presupuest") ||
    t.includes("precio") ||
    t.includes("valor") ||
    t.includes("cuanto cuesta") ||
    t.includes("cuánto cuesta")
  );
}

async function startCotizarFlow(state: UserState, userKey: string) {
  const previous = state.activeBranch;
  state.activeBranch = "catalogo";
  resetBranchState(state, previous);
  resetBranchState(state, "catalogo");

  if (state.catalog.selectedProductId) {
    return await handleCatalog(state, "cotizar", userKey);
  }

  if (!state.catalog.filters.tipo_producto && !state.catalog.pending) {
    const tipos = await listDistinctTipoProducto();
    const wanted = [
      { label: "Equipos de radio", keywords: ["equipos", "equipo", "radio", "radios", "handy", "portatil", "portátil", "movil", "móvil"] },
      { label: "Accesorios de radio", keywords: ["accesorios", "accesorio", "bateria", "batería", "antena", "cargador", "auricular", "mic", "microfono", "micrófono"] },
      { label: "Cámaras corporales", keywords: ["camara", "cámara", "camaras", "cámaras", "corporal", "bodycam", "body"] },
    ];

    const suggested: Array<{ label: string; tipo: string }> = [];
    for (const w of wanted) {
      const scored = tipos
        .map((tp) => {
          const hay = normalizeText(tp);
          const score = scoreTokenMatch(w.keywords.map((k) => normalizeText(k)), hay);
          return { tp, score };
        })
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (best && best.score >= 1) {
        suggested.push({ label: w.label, tipo: best.tp });
      }
    }

    const uniqueTipos: string[] = [];
    const lines: string[] = [];
    for (const s of suggested) {
      if (uniqueTipos.includes(s.tipo)) continue;
      uniqueTipos.push(s.tipo);
      lines.push(`${uniqueTipos.length}) ${s.label}`);
    }

    if (uniqueTipos.length >= 2) {
      state.catalog.pending = { attr: "tipo_producto", options: uniqueTipos.slice(0, 5) };
      return [
        "Perfecto. Para cotizar, ¿qué tipo de producto te interesa?",
        "",
        ...lines,
        "",
        "También puedes escribir el nombre del equipo (ej: DP50).",
      ].join("\n");
    }
  }

  return "Perfecto. Para cotizar, ¿qué producto buscas? Puedes decir el nombre (ej: DP50) o elegir un tipo: Equipos de radio, Accesorios de radio o Cámaras corporales.";
}

function buildMainMenuText() {
  const suffixes = [
    "Escríbeme 1, 2, 3 o 4, o escribe la opción (por ejemplo: Catálogo) y te ayudo al tiro.",
    "Puedes responder con 1, 2, 3 o 4, o escribir la opción (por ejemplo: Proyectos) y te guío.",
    "Respóndeme con 1–4, o escribe la opción con tus palabras y te oriento.",
  ];
  const suffix = suffixes[crypto.randomInt(0, suffixes.length)];
  return [
    "1. 📦 Catálogo de productos",
    "2. 🔧 Servicio Técnico",
    "3. 🏗️ Proyectos",
    "4. 📍 Puntos de Venta",
    "",
    suffix,
  ].join("\n");
}

function withMainMenu(message: string) {
  const m = message.trim();
  return m ? `${m}\n\n${buildMainMenuText()}` : buildMainMenuText();
}

function parseMenuChoice(text: string): Branch | null {
  const t = normalizeText(text);
  if (t === "1" || t.includes("catalogo") || t.includes("catálogo")) return "catalogo";
  if (t === "2" || t.includes("servicio") || t.includes("tecnico") || t.includes("técnico")) return "servicio_tecnico";
  if (t === "3" || t.includes("proyecto") || t.includes("proyectos")) return "proyectos";
  if (t === "4" || t.includes("punto de venta") || t.includes("puntos de venta") || t.includes("dealer"))
    return "puntos_venta";
  return null;
}

function classifyFreeText(text: string): Branch | null {
  const t = normalizeText(text);
  const catalogHints = ["cotizar", "cotizacion", "precio", "radio", "repetidor", "camara", "cámara", "accesorio", "equipo"];
  const techHints = ["falla", "problema", "repar", "garantia", "garantía", "program", "configur", "servicio tecnico"];
  const projectHints = ["proyecto", "implementacion", "implementación", "caso de exito", "caso de éxito"];
  const pointsHints = ["donde comprar", "dónde comprar", "sucursal", "tienda", "punto de venta", "puntos de venta", "dealer"];

  if (pointsHints.some((h) => t.includes(normalizeText(h)))) return "puntos_venta";
  if (projectHints.some((h) => t.includes(normalizeText(h)))) return "proyectos";
  if (techHints.some((h) => t.includes(normalizeText(h)))) return "servicio_tecnico";
  if (catalogHints.some((h) => t.includes(normalizeText(h)))) return "catalogo";
  return null;
}

function cleanProductName(rawName: string) {
  let name = rawName.trim().replace(/\s+/g, " ");
  const normalized = () => normalizeText(name);
  const prefixes = [
    "equipos de radio",
    "equipo de radio",
    "equipo radio",
    "equipos radio",
    "equipo",
    "equipos",
    "radio",
    "repetidor",
    "camara",
    "cámara",
    "accesorio",
    "accesorios",
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of prefixes) {
      const pn = normalizeText(p);
      if (normalized().startsWith(pn + " ")) {
        name = name.slice(name.toLowerCase().indexOf(" ") + 1).trim();
        changed = true;
        break;
      }
    }
  }
  return name;
}

function stripNectarShortcodes(text: string) {
  return text.replace(/\[nectar_btn[^\]]*\]/gi, "").replace(/\s+/g, " ").trim();
}

function extractFichaTecnicaUrl(text: string) {
  const m1 = text.match(/url="([^"]+)"/i);
  if (m1?.[1]) return m1[1];
  const m2 = text.match(/url='([^']+)'/i);
  if (m2?.[1]) return m2[1];
  const m3 = text.match(/https?:\/\/[^\s"')\]]+\.pdf/i);
  if (m3?.[0]) return m3[0];
  return "";
}

async function supabaseFetch(pathAndQuery: string, init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}) {
  const base = getSupabaseUrl();
  const key = getSupabaseKey();
  if (!base || !key) {
    return { ok: false, status: 500, data: null as unknown, error: "Missing Supabase env vars" };
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
  return { ok: res.ok, status: res.status, data, error: res.ok ? "" : text };
}

async function loadUserState(userPhoneKey: string): Promise<UserState | null> {
  const q = `message_buffer?select=full_message&user_phone=eq.${encodeURIComponent(userPhoneKey)}&limit=1`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok) return null;
  const rows = Array.isArray(res.data) ? (res.data as unknown[]) : [];
  const value = getRecordValue(rows[0], "full_message");
  if (!value) return null;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as UserState;
      if (!parsed || parsed.v !== 1) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  if (isRecord(value)) {
    const v = Number(getRecordValue(value, "v"));
    if (v !== 1) return null;
    return value as unknown as UserState;
  }
  return null;
}

async function ensureMessageBufferRow(userPhoneKey: string) {
  const q = `message_buffer?on_conflict=user_phone`;
  await supabaseFetch(q, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_phone: userPhoneKey, is_processed: false, procesando: false }),
  });
}

async function tryAcquireProcessingLock(userPhoneKey: string) {
  const q = `message_buffer?user_phone=eq.${encodeURIComponent(userPhoneKey)}&or=(procesando.is.null,procesando.eq.false)`;
  const res = await supabaseFetch(q, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ procesando: true, last_updated_at: new Date().toISOString() }),
  });
  return res.ok && Array.isArray(res.data) && (res.data as unknown[]).length > 0;
}

async function releaseProcessingLock(userPhoneKey: string) {
  const q = `message_buffer?user_phone=eq.${encodeURIComponent(userPhoneKey)}`;
  await supabaseFetch(q, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ procesando: false, last_updated_at: new Date().toISOString() }),
  });
}

async function saveUserState(userPhoneKey: string, state: UserState) {
  const q = `message_buffer?on_conflict=user_phone`;
  const basePayload = {
    user_phone: userPhoneKey,
    last_updated_at: new Date().toISOString(),
    is_processed: false,
  };

  const firstTry = await supabaseFetch(q, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ ...basePayload, full_message: state }),
  });

  if (!firstTry.ok) {
    await supabaseFetch(q, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ ...basePayload, full_message: JSON.stringify(state) }),
    });
  }
}

async function markMessageRead(messageId: string, phone: string) {
  const baseUrl = getGowaBaseUrl();
  if (!baseUrl) return;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = toBasicAuthHeader(getGowaBasicAuth());
  if (auth) headers.Authorization = auth;
  const deviceId = getGowaDeviceId();
  if (deviceId) headers["X-Device-Id"] = deviceId;

  try {
    await fetch(`${baseUrl}/message/${encodeURIComponent(messageId)}/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone }),
    });
  } catch {}
}

async function sendChatPresence(phone: string, action: "start" | "stop") {
  const baseUrl = getGowaBaseUrl();
  if (!baseUrl) return;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = toBasicAuthHeader(getGowaBasicAuth());
  if (auth) headers.Authorization = auth;
  const deviceId = getGowaDeviceId();
  if (deviceId) headers["X-Device-Id"] = deviceId;

  try {
    const res = await fetch(`${baseUrl}/send/chat-presence`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, action }),
    });
    if (!res.ok) {
      await fetch(`${baseUrl}/send/chat-presence`, {
        method: "POST",
        headers,
        body: JSON.stringify({ phone, state: action === "start" ? "composing" : "paused" }),
      }).catch(() => {});
    }
  } catch {}
}

async function minimaxRewrite(args: { kind: "saludo" | "fuera_menu" | "cierre" | "empatia"; input?: string; facts: string[] }) {
  const key = getMinimaxApiKey();
  if (!key) {
    return args.facts.filter(Boolean).join("\n");
  }

  const baseUrl = getMinimaxBaseUrl();
  const system = [
    "Eres un asesor humano de ventas y soporte para una empresa chilena de telecomunicaciones y radiocomunicación.",
    "Hablas en español chileno, tono cordial, profesional y cercano.",
    "Sé breve, claro y sin redundancias.",
    "Nunca menciones que eres una IA.",
    "Nunca uses etiquetas como <think> ni expliques tu razonamiento.",
    "Entrega solo el mensaje final para WhatsApp, sin encabezados ni meta-explicaciones.",
    "No inventes datos: si algo no está en los hechos, no lo agregues.",
    "No repitas el menú ni enumeres opciones 1-4. Si corresponde menú, el sistema lo agregará.",
    "No incluyas la frase '¿En qué te puedo ayudar hoy?' porque se agrega en el menú.",
  ].join(" ");

  const userParts = [
    `Tipo de mensaje: ${args.kind}.`,
    args.input ? `Mensaje del cliente: ${args.input}` : "",
    "Hechos a comunicar:",
    args.facts.map((f) => `- ${f}`).join("\n"),
    "",
    "Redacta un único mensaje final listo para enviar por WhatsApp.",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "MiniMax-M2.7",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userParts },
      ],
      temperature: 0.7,
      max_tokens: 300,
    }),
  });
  if (!res.ok) {
    return args.facts.filter(Boolean).join("\n");
  }
  const data = (await res.json()) as unknown;
  const choices = isRecord(data) ? getRecordValue(data, "choices") : undefined;
  const first = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
  const message = isRecord(first) ? getRecordValue(first, "message") : undefined;
  const content = isRecord(message) ? getRecordValue(message, "content") : undefined;
  if (typeof content === "string" && content.trim()) {
    const cleaned = sanitizeMinimaxOutput(content);
    if (cleaned) return cleaned;
  }
  return args.facts.filter(Boolean).join("\n");
}

function sanitizeMinimaxOutput(raw: string) {
  const withoutThink = raw
    .replace(/<think[\s\S]*?<\/think>\s*/gi, "")
    .replace(/<analysis[\s\S]*?<\/analysis>\s*/gi, "")
    .replace(/^\s*(tipo de mensaje|mensaje del cliente|hechos a comunicar)\s*:\s*.*$/gim, "")
    .replace(/^\s*debo\s+.*$/gim, "");

  const withoutTagsAndFences = withoutThink
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();

  const lines = withoutTagsAndFences
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const forbidden = /(soy (una )?ia|como ia|modelo( de lenguaje)?|minimax|gpt|openai|anthropic)/i;
  const menuIntro = /en\s+qu[eé]\s+te\s+puedo\s+ayudar\s+hoy/i;
  const safeLines = lines
    .filter((l) => !forbidden.test(l))
    .filter((l) => !menuIntro.test(l))
    .map((l) => l.replace(forbidden, "").trim())
    .filter(Boolean);

  const merged = safeLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!merged) return "";
  return merged.length > 1200 ? `${merged.slice(0, 1200).trim()}...` : merged;
}

function initState(): UserState {
  return {
    v: 1,
    greeted: false,
    activeBranch: "menu",
    recentInboundIds: [],
    catalog: { filters: {}, status: "idle" },
    projects: { offset: 0 },
    points: {},
  };
}

function resetBranchState(state: UserState, branch: Branch) {
  if (branch === "catalogo") state.catalog = { filters: {}, status: "idle" };
  if (branch === "proyectos") state.projects = { offset: 0 };
  if (branch === "puntos_venta") state.points = {};
}

async function listDistinctTipoProducto(): Promise<string[]> {
  const q = `inter_products?select=tipo_producto&tipo_producto=not.is.null&limit=1000`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  const values = (res.data as unknown[])
    .map((r) => toTrimmedString(getRecordValue(r, "tipo_producto")))
    .filter(Boolean);
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es"));
}

async function listTecnologias(filters: CatalogFilters): Promise<string[]> {
  if (!filters.tipo_producto) return [];
  const res = await supabaseFetch(`rpc/get_tecnologias`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_tipo_producto: filters.tipo_producto }),
  });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[]).map((r) => toTrimmedString(getRecordValue(r, "tecnologia"))).filter(Boolean);
}

async function listModalidades(filters: CatalogFilters): Promise<string[]> {
  if (!filters.tipo_producto) return [];
  const res = await supabaseFetch(`rpc/get_modalidades`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_tipo_producto: filters.tipo_producto,
      p_portabilidad: filters.portabilidad ?? null,
      p_tecnologia: filters.tecnologia ?? null,
    }),
  });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[]).map((r) => toTrimmedString(getRecordValue(r, "modalidad"))).filter(Boolean);
}

async function listPortabilidades(filters: CatalogFilters): Promise<string[]> {
  if (!filters.tipo_producto) return [];
  const res = await supabaseFetch(`rpc/get_portabilidades`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_tipo_producto: filters.tipo_producto,
      p_modalidad: filters.modalidad ?? null,
      p_tecnologia: filters.tecnologia ?? null,
    }),
  });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[]).map((r) => toTrimmedString(getRecordValue(r, "portabilidad"))).filter(Boolean);
}

async function listFrecuencias(filters: CatalogFilters): Promise<string[]> {
  if (!filters.tipo_producto) return [];
  const res = await supabaseFetch(`rpc/get_frecuencias`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_tipo_producto: filters.tipo_producto,
      p_modalidad: filters.modalidad ?? null,
      p_portabilidad: filters.portabilidad ?? null,
      p_tecnologia: filters.tecnologia ?? null,
    }),
  });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[]).map((r) => toTrimmedString(getRecordValue(r, "frecuencia"))).filter(Boolean);
}

async function queryProducts(filters: CatalogFilters): Promise<Array<{ product_id: string; nombre: string }>> {
  if (!filters.tipo_producto) return [];
  const params: string[] = [
    `select=product_id,nombre`,
    `tipo_producto=eq.${encodeURIComponent(filters.tipo_producto)}`,
    `limit=5`,
    `order=nombre.asc`,
  ];
  if (filters.modalidad) params.push(`modalidad=eq.${encodeURIComponent(filters.modalidad)}`);
  if (filters.portabilidad) params.push(`portabilidad=eq.${encodeURIComponent(filters.portabilidad)}`);
  if (filters.frecuencia) params.push(`frecuencia=ilike.*${encodeURIComponent(filters.frecuencia)}*`);
  if (filters.tecnologia) params.push(`tecnologia=ilike.*${encodeURIComponent(filters.tecnologia)}*`);
  const q = `inter_products?${params.join("&")}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[])
    .map((r) => ({ product_id: toTrimmedString(getRecordValue(r, "product_id")), nombre: toTrimmedString(getRecordValue(r, "nombre")) }))
    .filter((r) => r.product_id && r.nombre);
}

async function loadProductDetail(productId: string) {
  const select = encodeURIComponent(`ID,Nombre,"Descripción corta","Descripción","Imágenes","Precio normal"`);
  const q = `inter_products_staging?select=${select}&ID=eq.${encodeURIComponent(productId)}&limit=1`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return null;
  const row = (res.data as unknown[])[0];
  if (!row) return null;
  const nombre = toTrimmedString(getRecordValue(row, "Nombre"));
  const descCorta = toTrimmedString(getRecordValue(row, "Descripción corta"));
  const desc = toTrimmedString(getRecordValue(row, "Descripción"));
  const imagenes = toTrimmedString(getRecordValue(row, "Imágenes"));
  const precio = toTrimmedString(getRecordValue(row, "Precio normal"));
  const imageUrl = imagenes
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean)[0];
  const fichaUrl = extractFichaTecnicaUrl(`${descCorta}\n${desc}`);
  const descPlano = stripNectarShortcodes(`${descCorta}\n${desc}`);
  const shortText = descCorta.trim()
    ? stripNectarShortcodes(descCorta).slice(0, 600).trim()
    : descPlano.slice(0, 600).trim();
  const shortFinal = shortText.length >= 590 ? `${shortText.slice(0, 590).trim()}...` : shortText;

  return { productId, nombre, shortFinal, imageUrl, fichaUrl, precio };
}

async function listProjects(offset: number) {
  const q = `proyectos?select=id,titulo&order=id.asc&limit=5&offset=${offset}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[])
    .map((r) => ({ id: Number(getRecordValue(r, "id")), titulo: toTrimmedString(getRecordValue(r, "titulo")) }))
    .filter((r) => Number.isFinite(r.id) && r.titulo);
}

async function searchDealers(query: string) {
  const q = normalizeText(query);
  if (!q) return [];
  const like = encodeURIComponent(`*${query.trim()}*`);
  const params = [
    `select=nombre_punto,region,direccion,comuna,telefono`,
    `or=(region.ilike.${like},comuna.ilike.${like},direccion.ilike.${like},nombre_punto.ilike.${like})`,
    `limit=5`,
  ].join("&");
  const res = await supabaseFetch(`dealers?${params}`, { method: "GET" });
  if (res.ok && Array.isArray(res.data)) {
    return (res.data as unknown[]).map((r) => ({
      nombre_punto: toTrimmedString(getRecordValue(r, "nombre_punto")),
      region: toTrimmedString(getRecordValue(r, "region")),
      direccion: toTrimmedString(getRecordValue(r, "direccion")),
      comuna: toTrimmedString(getRecordValue(r, "comuna")),
      telefono: toTrimmedString(getRecordValue(r, "telefono")),
    }));
  }

  const fallback = await supabaseFetch(`dealers?select=nombre_punto,region,direccion,comuna,telefono&limit=200`, { method: "GET" });
  if (!fallback.ok || !Array.isArray(fallback.data)) return [];

  const tokens = tokenizeLocationQuery(query);
  const scored = (fallback.data as unknown[])
    .map((r) => {
      const row = {
        nombre_punto: toTrimmedString(getRecordValue(r, "nombre_punto")),
        region: toTrimmedString(getRecordValue(r, "region")),
        direccion: toTrimmedString(getRecordValue(r, "direccion")),
        comuna: toTrimmedString(getRecordValue(r, "comuna")),
        telefono: toTrimmedString(getRecordValue(r, "telefono")),
      };
      const hay = normalizeText([row.nombre_punto, row.region, row.direccion, row.comuna].filter(Boolean).join(" "));
      const score = scoreTokenMatch(tokens, hay);
      return { row, score };
    })
    .filter((x) => x.row.nombre_punto && (x.row.direccion || x.row.comuna || x.row.region))
    .filter((x) => (tokens.length ? x.score >= 1 : true))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 5).map((x) => x.row);
}

async function searchPuntosVenta(query: string) {
  const q = normalizeText(query);
  if (!q) return [];
  const like = encodeURIComponent(`*${query.trim()}*`);

  const tableCandidates = ["punto_venta", "puntos_venta", "puntos_de_venta"];
  for (const table of tableCandidates) {
    const params = [
      `select=titulo,direccion,categoria`,
      `or=(titulo.ilike.${like},direccion.ilike.${like},categoria.ilike.${like})`,
      `limit=5`,
    ].join("&");
    const res = await supabaseFetch(`${table}?${params}`, { method: "GET" });
    if (!res.ok || !Array.isArray(res.data)) continue;
    const rows = (res.data as unknown[])
      .map((r) => ({
        titulo: toTrimmedString(getRecordValue(r, "titulo")),
        direccion: toTrimmedString(getRecordValue(r, "direccion")),
        categoria: toTrimmedString(getRecordValue(r, "categoria")),
      }))
      .filter((r) => r.titulo && r.direccion);
    if (rows.length) return rows;
  }
  const fallback = await supabaseFetch(`punto_venta?select=titulo,direccion,categoria&limit=300`, { method: "GET" });
  if (!fallback.ok || !Array.isArray(fallback.data)) return [];
  const tokens = tokenizeLocationQuery(query);
  const scored = (fallback.data as unknown[])
    .map((r) => {
      const row = {
        titulo: toTrimmedString(getRecordValue(r, "titulo")),
        direccion: toTrimmedString(getRecordValue(r, "direccion")),
        categoria: toTrimmedString(getRecordValue(r, "categoria")),
      };
      const hay = normalizeText([row.titulo, row.direccion, row.categoria].filter(Boolean).join(" "));
      const score = scoreTokenMatch(tokens, hay);
      return { row, score };
    })
    .filter((x) => x.row.titulo && x.row.direccion)
    .filter((x) => (tokens.length ? x.score >= 1 : true))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 5).map((x) => x.row);
}

async function answerServicioTecnico(query: string) {
  const q = query.trim();
  if (!q) return null;
  const like = encodeURIComponent(`*${q}*`);
  const tokens = normalizeText(q)
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 5);

  const orParts = [`tema.ilike.${like}`, `informacion.ilike.${like}`];
  for (const t of tokens) {
    const arrayExpr = encodeURIComponent(`{${t}}`);
    orParts.push(`palabras_clave.cs.${arrayExpr}`);
  }

  const params = [`select=tema,informacion,palabras_clave`, `or=(${orParts.join(",")})`, `limit=3`].join("&");
  const res = await supabaseFetch(`servicio_tecnico?${params}`, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return null;
  const rows = (res.data as unknown[])
    .map((r) => ({ tema: toTrimmedString(getRecordValue(r, "tema")), info: toTrimmedString(getRecordValue(r, "informacion")) }))
    .filter((r) => r.tema && r.info);
  if (!rows.length) return null;
  return rows;
}

function isNumericChoice(text: string, max: number) {
  const t = normalizeText(text);
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1 || n > max) return null;
  return n;
}

function extractProjectChoiceFromText(text: string, max: number) {
  if (max <= 0) return null;
  const t = normalizeText(text);
  if (!t) return null;
  const m = t.match(/(?:^|[^0-9])(\d{1,2})(?!\d)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > max) return null;
  const hasKeyword =
    t.includes("proyecto") ||
    t.includes("proyectos") ||
    t.includes("ver") ||
    t.includes("veamos") ||
    t.includes("quiero") ||
    t.includes("muestra") ||
    t.includes("mostrar") ||
    t.includes("muestre") ||
    t.includes("muestreme") ||
    t.includes("elige") ||
    t.includes("elijo") ||
    t.includes("escoge") ||
    t.includes("escojo") ||
    t.includes("escoger") ||
    t.includes("selecciona") ||
    t.includes("seleccionar");
  if (hasKeyword) {
    return n;
  }
  return null;
}

function validateEmail(email: string) {
  const e = email.trim();
  if (!e.includes("@")) return false;
  const parts = e.split("@");
  if (parts.length !== 2) return false;
  if (!parts[0] || !parts[1] || !parts[1].includes(".")) return false;
  return true;
}

function normalizePhone(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.replace(/^00/, "+");
}

async function saveCotizacionToSupabase(userPhone: string, state: UserState) {
  const quote = state.catalog.quote?.data ?? {};
  const selectedProductId = state.catalog.selectedProductId ?? "";
  const productDetail = selectedProductId ? await loadProductDetail(selectedProductId) : null;

  const included = state.catalog.recommended?.includedIds ?? [];
  const rejected = state.catalog.recommended?.rejectedIds ?? [];
  const remaining = state.catalog.recommended?.remainingIds ?? [];
  const offered = Array.from(new Set([...included, ...rejected, ...remaining])).filter(Boolean);

  const row = {
    user_phone: userPhone,
    nombre: quote.nombre ?? null,
    telefono: quote.telefono ?? null,
    email: quote.email ?? null,
    empresa: quote.empresa ?? null,
    direccion: quote.direccion ?? null,
    ciudad: quote.ciudad ?? null,
    region: quote.region ?? null,
    producto_id: selectedProductId || null,
    producto_nombre: productDetail?.nombre ?? null,
    recomendados_ofrecidos: offered.length ? offered : null,
    recomendados_incluidos: included.length ? included : null,
    recomendados_rechazados: rejected.length ? rejected : null,
    canal: "whatsapp",
    estado: "enviada",
  };

  const res = await supabaseFetch(`cotizaciones`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    inboxAdd({
      source: "gowa",
      signatureValid: null,
      from: userPhone,
      text: `[DEBUG] cotizacion insert failed status=${res.status}`,
      body: res.data,
    });
  }
}

async function loadUserProfile(userPhone: string) {
  const q = `users?select=nombre,telefono,email,empresa,direccion,ciudad,region&user_phone=eq.${encodeURIComponent(userPhone)}&limit=1`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return null;
  const row = (res.data as unknown[])[0];
  if (!row) return null;
  const data = {
    nombre: toTrimmedString(getRecordValue(row, "nombre")) || undefined,
    telefono: toTrimmedString(getRecordValue(row, "telefono")) || undefined,
    email: toTrimmedString(getRecordValue(row, "email")) || undefined,
    empresa: toTrimmedString(getRecordValue(row, "empresa")) || undefined,
    direccion: toTrimmedString(getRecordValue(row, "direccion")) || undefined,
    ciudad: toTrimmedString(getRecordValue(row, "ciudad")) || undefined,
    region: toTrimmedString(getRecordValue(row, "region")) || undefined,
  };
  const hasAny = Object.values(data).some(Boolean);
  return hasAny ? data : null;
}

async function upsertUserProfile(userPhone: string, data: CatalogQuote["data"]) {
  const payload = {
    user_phone: userPhone,
    nombre: data.nombre ?? null,
    telefono: data.telefono ?? null,
    email: data.email ?? null,
    empresa: data.empresa ?? null,
    direccion: data.direccion ?? null,
    ciudad: data.ciudad ?? null,
    region: data.region ?? null,
    updated_at: new Date().toISOString(),
  };
  await supabaseFetch(`users?on_conflict=user_phone`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(payload),
  });
}

function getNextQuoteStep(data: CatalogQuote["data"]): CatalogQuoteStep {
  if (!data.nombre) return "nombre";
  if (!data.telefono) return "telefono";
  if (!data.email) return "email";
  if (!data.empresa) return "empresa";
  if (!data.direccion) return "direccion";
  if (!data.ciudad) return "ciudad";
  if (!data.region) return "region";
  return "final";
}

async function buildCotizacionResumen(state: UserState) {
  const q = state.catalog.quote?.data ?? {};
  const selectedProductId = state.catalog.selectedProductId ?? "";
  const productDetail = selectedProductId ? await loadProductDetail(selectedProductId) : null;

  const included = state.catalog.recommended?.includedIds ?? [];
  const includedNames: string[] = [];
  for (const id of included.slice(0, 5)) {
    const d = await loadProductDetail(id);
    if (d?.nombre) includedNames.push(cleanProductName(d.nombre));
  }

  const lines: string[] = [];
  lines.push("📌 *Resumen de tu cotización*");
  if (q.nombre) lines.push(`👤 Nombre: ${q.nombre}`);
  if (q.telefono) lines.push(`📞 Teléfono: ${q.telefono}`);
  if (q.email) lines.push(`📧 Correo: ${q.email}`);
  if (q.empresa) lines.push(`🏢 Empresa: ${q.empresa}`);

  const addressParts = [q.direccion, q.ciudad, q.region].filter(Boolean);
  if (addressParts.length) lines.push(`📍 Dirección: ${addressParts.join(", ")}`);

  if (productDetail?.nombre) {
    const base = cleanProductName(productDetail.nombre);
    lines.push(`📦 Producto: ${base}${selectedProductId ? ` (ID: ${selectedProductId})` : ""}`);
  } else if (selectedProductId) {
    lines.push(`📦 Producto: ID ${selectedProductId}`);
  }

  if (includedNames.length) lines.push(`➕ Recomendados incluidos: ${includedNames.join(", ")}`);

  lines.push("");
  lines.push("✅ Ya recibimos tu solicitud. En breve te vamos a contactar.");
  return lines.join("\n");
}

async function finalizeCotizacion(state: UserState, userPhone: string) {
  await saveCotizacionToSupabase(userPhone, state);
  if (state.catalog.quote?.data) {
    await upsertUserProfile(userPhone, state.catalog.quote.data);
  }
  const resumen = await buildCotizacionResumen(state);
  state.catalog = { filters: {}, status: "idle" };
  state.activeBranch = "menu";
  return withMainMenu(resumen);
}

async function handleCatalog(state: UserState, text: string, userPhone: string): Promise<string> {
  const input = text.trim();
  const t = normalizeText(input);

  if (state.catalog.status === "wait_finish_cotizacion") {
    if (t.includes("cancel")) {
      state.catalog = { filters: {}, status: "idle" };
      state.activeBranch = "menu";
      const msg = await minimaxRewrite({
        kind: "empatia",
        input,
        facts: ["Ok, dejé la cotización cancelada."],
      });
      return withMainMenu(msg);
    }
    if (t.includes("termin") || t.includes("confirm") || t === "si" || t === "sí") {
      return await finalizeCotizacion(state, userPhone);
    }
    if (t.startsWith("1") && state.catalog.recommended?.mode === "offer") {
      state.catalog.recommended.includedIds.push(...state.catalog.recommended.remainingIds);
      state.catalog.recommended.remainingIds = [];
      state.catalog.status = "wait_finish_cotizacion";
      return await minimaxRewrite({
        kind: "cierre",
        input,
        facts: [
          "Listo, incluí los recomendados en tu cotización.",
          "¿Quieres terminar o cancelar la cotización?",
          "Responde: Terminar / Cancelar.",
        ],
      });
    }
    if (t.startsWith("2") && state.catalog.recommended?.mode === "offer") {
      state.catalog.recommended.mode = "list";
      const remaining = state.catalog.recommended.remainingIds.slice(0, 5);
      const items: string[] = [];
      for (const id of remaining) {
        const d = await loadProductDetail(id);
        if (d?.nombre) items.push(d.nombre);
      }
      const lines = items.length
        ? items.map((n, i) => `${i + 1}) ${cleanProductName(n)}`).join("\n")
        : "No encontré recomendados para mostrar ahora.";
      return [`Estos son los productos recomendados:`, "", lines, "", "Elige un número o responde Terminar."].join("\n");
    }
    if (t.startsWith("3") && state.catalog.recommended?.mode === "offer") {
      state.catalog.recommended.rejectedIds.push(...state.catalog.recommended.remainingIds);
      state.catalog.recommended.remainingIds = [];
      return await minimaxRewrite({
        kind: "empatia",
        input,
        facts: ["Dale, dejamos los recomendados fuera.", "¿Quieres terminar o cancelar la cotización?", "Responde: Terminar / Cancelar."],
      });
    }

    if (state.catalog.recommended?.mode === "list") {
      const n = isNumericChoice(t, Math.min(5, state.catalog.recommended.remainingIds.length));
      if (n) {
        const id = state.catalog.recommended.remainingIds[n - 1];
        state.catalog.recommended.currentId = id;
        state.catalog.recommended.mode = "detail";
        const d = await loadProductDetail(id);
        if (!d) return "No pude cargar ese recomendado. Elige otro número o responde Terminar.";
        const parts = [
          `*${d.nombre}*`,
          d.imageUrl ? `🖼️ ${d.imageUrl}` : "",
          d.shortFinal ? d.shortFinal : "",
          d.fichaUrl ? `📄 Ficha técnica: ${d.fichaUrl}` : "",
          "",
          "Responde: Incluir / Rechazar / Terminar",
        ].filter(Boolean);
        return parts.join("\n");
      }
      if (t.includes("termin")) {
        return await finalizeCotizacion(state, userPhone);
      }
      return "Elige un número de la lista o responde Terminar.";
    }

    if (state.catalog.recommended?.mode === "detail" && state.catalog.recommended.currentId) {
      const id = state.catalog.recommended.currentId;
      if (t.includes("inclu")) {
        state.catalog.recommended.includedIds.push(id);
        state.catalog.recommended.remainingIds = state.catalog.recommended.remainingIds.filter((x) => x !== id);
        state.catalog.recommended.currentId = undefined;
        state.catalog.recommended.mode = "list";
        if (!state.catalog.recommended.remainingIds.length) {
          return await minimaxRewrite({
            kind: "cierre",
            input,
            facts: [
              "Listo, ya incluí los recomendados que seleccionaste.",
              "¿Quieres terminar o cancelar la cotización?",
              "Responde: Terminar / Cancelar.",
            ],
          });
        }
        return "Listo. Elige otro recomendado por número o responde Terminar.";
      }
      if (t.includes("rechaz")) {
        state.catalog.recommended.rejectedIds.push(id);
        state.catalog.recommended.remainingIds = state.catalog.recommended.remainingIds.filter((x) => x !== id);
        state.catalog.recommended.currentId = undefined;
        state.catalog.recommended.mode = "list";
        if (!state.catalog.recommended.remainingIds.length) {
          return await minimaxRewrite({
            kind: "cierre",
            input,
            facts: [
              "Ya, dejamos esos recomendados fuera.",
              "¿Quieres terminar o cancelar la cotización?",
              "Responde: Terminar / Cancelar.",
            ],
          });
        }
        return "Ok. Elige otro recomendado por número o responde Terminar.";
      }
      if (t.includes("termin")) {
        return await finalizeCotizacion(state, userPhone);
      }
      return "Responde: Incluir / Rechazar / Terminar";
    }

    return "Para cerrar la cotización responde: Terminar / Cancelar.";
  }

  if (t.includes("nueva busqueda") || t.includes("nueva búsqueda") || t === "reiniciar") {
    state.catalog = { filters: {}, status: "idle" };
    return "Perfecto. ¿Qué tipo de producto buscas? (Ej: Equipos Radio, Repetidores, Accesorios, Cámaras Corporales)";
  }

  if (state.catalog.quote) {
    const q = state.catalog.quote;
    if (t.includes("cancel")) {
      state.catalog.quote = undefined;
      state.catalog.status = "idle";
      return "Ok, dejé la cotización cancelada. ¿Quieres seguir viendo productos o vuelvo al menú?";
    }

    const setAndNext = (key: keyof CatalogQuote["data"], value: string, next: CatalogQuoteStep) => {
      q.data[key] = value;
      q.step = next;
    };

    if (q.step === "nombre") {
      if (input.length < 3) return "¿Me indicas tu nombre y apellido? (Ej: Juan Pérez)";
      setAndNext("nombre", input, "telefono");
      state.userName = input.split(" ")[0]?.trim() || state.userName;
      return "Perfecto. ¿Me compartes tu teléfono? (Ej: +56 9 1234 5678)";
    }
    if (q.step === "telefono") {
      const phone = normalizePhone(input);
      const digits = phone.replace(/[^\d]/g, "");
      if (digits.length < 8) return "Ese teléfono se ve incompleto. ¿Me lo confirmas? (Ej: +56 9 1234 5678)";
      setAndNext("telefono", phone, "email");
      return "Gracias. ¿Cuál es tu correo? (Ej: nombre@empresa.cl)";
    }
    if (q.step === "email") {
      if (!validateEmail(input)) return "Ese correo no me calza. ¿Me lo escribes nuevamente? (Ej: nombre@empresa.cl)";
      setAndNext("email", input.trim(), "empresa");
      return "Bacán. ¿Nombre de tu empresa?";
    }
    if (q.step === "empresa") {
      if (input.length < 2) return "¿Nombre de tu empresa?";
      setAndNext("empresa", input, "direccion");
      return "¿Dirección (calle y número)?";
    }
    if (q.step === "direccion") {
      if (input.length < 3) return "¿Dirección (calle y número)?";
      setAndNext("direccion", input, "ciudad");
      return "¿Ciudad?";
    }
    if (q.step === "ciudad") {
      if (input.length < 2) return "¿Ciudad?";
      setAndNext("ciudad", input, "region");
      return "¿Región / Provincia?";
    }
    if (q.step === "region") {
      if (input.length < 2) return "¿Región / Provincia?";
      setAndNext("region", input, "final");
      state.catalog.status = "wait_finish_cotizacion";
      state.catalog.quote = q;
      if (q.data.nombre) {
        state.userName = q.data.nombre.split(" ")[0]?.trim() || state.userName;
      }
      await upsertUserProfile(userPhone, q.data);

      const recommendedIds = await tryLoadRecommendedIds(state.catalog.selectedProductId);
      if (recommendedIds.length) {
        state.catalog.recommended = {
          mode: "offer",
          remainingIds: recommendedIds,
          includedIds: [],
          rejectedIds: [],
        };
        const names: string[] = [];
        for (const id of recommendedIds.slice(0, 3)) {
          const d = await loadProductDetail(id);
          if (d?.nombre) names.push(cleanProductName(d.nombre));
        }
        return await minimaxRewrite({
          kind: "cierre",
          input,
          facts: [
            "Listo, ya tengo tus datos para la cotización.",
            "Además, podría incluir productos recomendados para complementar.",
            names.length ? `Recomendados: ${names.join(", ")}.` : "",
            "Responde:",
            "1) Incluir recomendados",
            "2) Ver productos recomendados",
            "3) Rechazar",
          ].filter(Boolean),
        });
      }

      return await minimaxRewrite({
        kind: "cierre",
        input,
        facts: [
          "Listo, ya tengo tus datos para la cotización. En breve te vamos a contactar.",
          "¿Quieres terminar o cancelar la cotización?",
          "Responde: Terminar / Cancelar.",
        ],
      });
    }
  }

  if (state.catalog.pending) {
    const pending = state.catalog.pending;
    const n = isNumericChoice(t, pending.options.length);
    if (n) {
      state.catalog.filters[pending.attr] = pending.options[n - 1];
      state.catalog.pending = undefined;
    } else {
      const match = pending.options.find((o) => normalizeText(o) === normalizeText(input) || normalizeText(input).includes(normalizeText(o)));
      if (match) {
        state.catalog.filters[pending.attr] = match;
        state.catalog.pending = undefined;
      } else {
        return `Elige una opción (1–${pending.options.length}) o escríbela tal cual:`;
      }
    }
  }

  if (!state.catalog.filters.tipo_producto) {
    const tipos = await listDistinctTipoProducto();
    if (!tipos.length) return "¿Qué tipo de producto buscas? (Ej: Equipos Radio, Repetidores, Accesorios)";
    const candidates = tipos.filter((tp) => normalizeText(tp).includes(t) || t.includes(normalizeText(tp)));
    if (candidates.length === 1) {
      state.catalog.filters.tipo_producto = candidates[0];
    } else if (candidates.length > 1) {
      const top = candidates.slice(0, 5);
      state.catalog.pending = { attr: "tipo_producto", options: top };
      return ["¿Cuál de estos tipos de producto buscas?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    } else {
      const top = tipos.slice(0, 5);
      state.catalog.pending = { attr: "tipo_producto", options: top };
      return ["¿Qué tipo de producto buscas? Elige una opción o escríbela:", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    }
  }

  if (!state.catalog.filters.tecnologia) {
    const opts = await listTecnologias(state.catalog.filters);
    if (opts.length > 1) {
      const top = opts.slice(0, 5);
      state.catalog.pending = { attr: "tecnologia", options: top };
      return ["¿Qué tecnología prefieres?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    }
  }

  if (!state.catalog.filters.modalidad) {
    const opts = await listModalidades(state.catalog.filters);
    if (opts.length > 1) {
      const top = opts.slice(0, 5);
      state.catalog.pending = { attr: "modalidad", options: top };
      return ["¿Lo buscas para venta o arriendo?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    }
  }

  if (!state.catalog.filters.portabilidad) {
    const opts = await listPortabilidades(state.catalog.filters);
    if (opts.length > 1) {
      const top = opts.slice(0, 5);
      state.catalog.pending = { attr: "portabilidad", options: top };
      return ["¿Portátil o móvil?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    }
  }

  if (!state.catalog.filters.frecuencia) {
    const opts = await listFrecuencias(state.catalog.filters);
    if (opts.length > 1) {
      const top = opts.slice(0, 5);
      state.catalog.pending = { attr: "frecuencia", options: top };
      return ["¿Qué frecuencia te sirve?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    }
  }

  if (state.catalog.selectedProductId) {
    if (t.includes("cotiz")) {
      const profile = await loadUserProfile(userPhone);
      const prefill = profile ? { ...profile } : {};
      const next = getNextQuoteStep(prefill);
      state.catalog.quote = { step: next, data: prefill };
      if (next === "final") {
        state.catalog.status = "wait_finish_cotizacion";
        await upsertUserProfile(userPhone, state.catalog.quote.data);

        const recommendedIds = await tryLoadRecommendedIds(state.catalog.selectedProductId);
        if (recommendedIds.length) {
          state.catalog.recommended = {
            mode: "offer",
            remainingIds: recommendedIds,
            includedIds: [],
            rejectedIds: [],
          };
          const names: string[] = [];
          for (const id of recommendedIds.slice(0, 3)) {
            const d = await loadProductDetail(id);
            if (d?.nombre) names.push(cleanProductName(d.nombre));
          }
          return [
            "Ya tengo tus datos guardados para cotizar.",
            names.length ? `Recomendados: ${names.join(", ")}.` : "",
            "Responde:",
            "1) Incluir recomendados",
            "2) Ver productos recomendados",
            "3) Rechazar",
          ]
            .filter(Boolean)
            .join("\n");
        }

        return "Ya tengo tus datos guardados para cotizar. Responde Terminar para cerrar la cotización o Cancelar para anularla.";
      }

      if (next === "telefono") return "Perfecto. ¿Me compartes tu teléfono? (Ej: +56 9 1234 5678)";
      if (next === "email") return "Gracias. ¿Cuál es tu correo? (Ej: nombre@empresa.cl)";
      if (next === "empresa") return "Bacán. ¿Nombre de tu empresa?";
      if (next === "direccion") return "¿Dirección (calle y número)?";
      if (next === "ciudad") return "¿Ciudad?";
      if (next === "region") return "¿Región / Provincia?";
      return "Perfecto. Para la cotización, ¿me indicas tu nombre y apellido?";
    }
    if (t.includes("volver")) {
      state.catalog.selectedProductId = undefined;
    } else {
      return "Si quieres cotizar, responde: Cotizar. Si prefieres otra opción, responde: Volver o Nueva búsqueda.";
    }
  }

  if (state.catalog.lastList && state.catalog.lastList.length) {
    const n = isNumericChoice(t, state.catalog.lastList.length);
    if (n) {
      const chosen = state.catalog.lastList[n - 1];
      state.catalog.selectedProductId = chosen.product_id;
      const detail = await loadProductDetail(chosen.product_id);
      if (!detail) return "No pude cargar la ficha de ese producto. Elige otro número o escribe Nueva búsqueda.";
      const parts = [
        `*${detail.nombre}*`,
        detail.precio ? `💰 Precio: ${detail.precio}` : "",
        detail.imageUrl ? `🖼️ ${detail.imageUrl}` : "",
        detail.shortFinal ? detail.shortFinal : "",
        detail.fichaUrl ? `📄 Ficha técnica: ${detail.fichaUrl}` : "",
        "",
        "Responde: Cotizar / Volver / Nueva búsqueda",
      ].filter(Boolean);
      return parts.join("\n");
    }
  }

  const products = await queryProducts(state.catalog.filters);
  state.catalog.lastList = products;

  if (!products.length) {
    state.catalog.filters.frecuencia = undefined;
    state.catalog.filters.portabilidad = undefined;
    state.catalog.filters.modalidad = undefined;
    state.catalog.filters.tecnologia = undefined;
    return "No encontré productos con esos filtros. Probemos de nuevo: ¿qué tecnología o modalidad buscas?";
  }

  const lines = products.map((p, i) => `${i + 1}) ${cleanProductName(p.nombre)}`).join("\n");
  return ["Estos son los que encontré (máx. 5):", "", lines, "", "Elige un número para ver la ficha."].join("\n");
}

async function tryLoadRecommendedIds(productId?: string) {
  if (!productId) return [];
  const select = encodeURIComponent(`producto,recomendados`);
  const q = `catalogo_productos?select=${select}&limit=1&producto=eq.${encodeURIComponent(productId)}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  const row = (res.data as unknown[])[0];
  const raw = getRecordValue(row, "recomendados");
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function chunkText(text: string, chunkSize: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += chunkSize) {
    out.push(clean.slice(i, i + chunkSize).trim());
  }
  return out.filter(Boolean);
}

async function handleProjects(state: UserState, text: string): Promise<string | string[]> {
  const t = normalizeText(text);
  const wantsMoreProjects = t.includes("ver mas proyectos") || t.includes("ver más proyectos");

  let list = state.projects.lastList ?? [];
  let noMoreProjects = false;

  if (wantsMoreProjects) {
    const nextOffset = state.projects.offset + 5;
    const nextList = await listProjects(nextOffset);
    if (nextList.length) {
      state.projects.offset = nextOffset;
      list = nextList;
    } else if (state.projects.offset === 0 && !list.length) {
      list = await listProjects(0);
      noMoreProjects = true;
    } else {
      noMoreProjects = true;
    }
  } else if (t.includes("ver mas") || t.includes("ver más")) {
    state.projects.offset += 5;
    list = await listProjects(state.projects.offset);
  } else {
    if (!list.length) {
      list = await listProjects(state.projects.offset);
    }
  }

  state.projects.lastList = list;
  const n = isNumericChoice(t, list.length) ?? extractProjectChoiceFromText(t, list.length);
  if (n) {
    const chosen = list[n - 1];
    const detail = await loadProjectContent(chosen.id);
    if (!detail) return "No pude cargar ese proyecto. Elige otro número o escribe Menú.";

    const chunks = chunkText(detail.plain, 1100);
    const messages = [`*${detail.titulo}*`, ...(chunks.length ? chunks : ["Descripción no disponible."]), "Si quieres ver otro proyecto, elige un número o escribe Menú."].filter(Boolean);
    return messages;
  }
  if (!list.length) return "Por ahora no veo proyectos para mostrar. Responde Menú para volver al inicio.";

  if (noMoreProjects) {
    return "Por ahora no tengo más proyectos para mostrar. Elige algún proyecto o si quieres regresamos al menú.";
  }

  const lines = list.map((p, i) => `${i + 1}) ${p.titulo}`).join("\n");
  return ["Estos son algunos proyectos:", "", lines, "", "Elige algún proyecto o si quieres regresamos al menú."].join("\n");
}

async function loadProjectContent(id: number) {
  const q = `proyectos?select=id,titulo,contenido&limit=1&id=eq.${id}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return null;
  const row = (res.data as unknown[])[0];
  if (!row) return null;
  const titulo = toTrimmedString(getRecordValue(row, "titulo"));
  const contenido = toTrimmedString(getRecordValue(row, "contenido"));
  const plain = stripNectarShortcodes(contenido.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return { id, titulo, plain };
}

async function handlePoints(state: UserState, text: string) {
  const q = extractLocationQuery(text).trim();
  if (!q) return "¿En qué región o ciudad estás? Así te muestro los puntos de venta más cercanos.";
  state.points.lastQuery = q;
  const [dealers, puntosVenta] = await Promise.all([searchDealers(q), searchPuntosVenta(q)]);

  if (!dealers.length && !puntosVenta.length) {
    return [
      "No encontré puntos de venta con ese dato.",
      "",
      "¿Me dices otra comuna/ciudad cercana o la zona (Zona Norte / Zona Centro / Zona Sur)?",
      "Si quieres volver al menú, responde: Menú.",
    ].join("\n");
  }

  const blocks: string[] = [];

  const dealerRows = dealers.slice(0, 3);
  const dealerKeys = new Set(
    dealerRows
      .map((d) => normalizeText([d.nombre_punto, d.direccion, d.comuna, d.region].filter(Boolean).join(" ")))
      .filter(Boolean)
  );

  const dealerBlocks = dealerRows.map((d) => {
    const parts = [
      `📍 ${d.nombre_punto}`,
      d.direccion || d.comuna ? `   Dirección: ${[d.direccion, d.comuna].filter(Boolean).join(", ")}` : "",
      d.region ? `   Región: ${d.region}` : "",
      d.telefono ? `   Teléfono: ${d.telefono}` : "",
    ].filter(Boolean);
    return parts.join("\n");
  });
  blocks.push(...dealerBlocks);

  const remaining = Math.max(0, 5 - blocks.length);
  const pvBlocks = puntosVenta
    .filter((p) => {
      const key = normalizeText([p.titulo, p.direccion, p.categoria].filter(Boolean).join(" "));
      if (!key) return true;
      for (const dKey of dealerKeys) {
        if (dKey.includes(key) || key.includes(dKey)) return false;
      }
      return true;
    })
    .slice(0, remaining)
    .map((p) => [`📍 ${p.titulo}`, p.categoria ? `   Zona: ${p.categoria}` : "", `   Dirección: ${p.direccion}`].filter(Boolean).join("\n"));
  blocks.push(...pvBlocks);

  const formatted = blocks.join("\n\n");
  return [formatted, "", "Si quieres buscar otra zona/ciudad, escríbemela. Para volver al menú: Menú."].join("\n");
}

async function handleServicioTecnico(state: UserState, text: string) {
  const q = text.trim();
  if (!q) return "Cuéntame tu duda técnica y te ayudo al tiro.";
  const hits = await answerServicioTecnico(q);
  if (!hits) {
    const msg = await minimaxRewrite({
      kind: "empatia",
      input: q,
      facts: [
        "Puedo derivarte con un especialista para que te atiendan bien.",
        "📞 Mesa Central: +56 2 3263 5550",
        "📞 SAM (Servicio Asistencia Motorola): +56 2 3263 5551",
      ],
    });
    return `${msg}\n\nSi quieres volver al menú, responde: Menú.`;
  }
  const answer = hits
    .map((h) => [`*${h.tema}*`, h.info].filter(Boolean).join("\n"))
    .join("\n\n");
  return [
    answer,
    "",
    "Si necesitas que te deriven:",
    "📞 Mesa Central: +56 2 3263 5550",
    "📞 SAM: +56 2 3263 5551",
    "",
    "Si quieres volver al menú, responde: Menú.",
  ].join("\n");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === getVerifyToken() && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ ok: false }, { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const signatureValid = signature ? verifySignature(rawBody, signature) : null;
  if (signatureValid === false) {
    inboxAdd({ source: "gowa", signatureValid: false, body: safeJson(rawBody) });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    inboxAdd({ source: "gowa", signatureValid, body: rawBody });
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const payload = isRecord(body) && isRecord(body.payload) ? body.payload : body;
  const message =
    (isRecord(payload) && isRecord(payload.message) ? payload.message : undefined) ??
    (isRecord(payload) && Array.isArray(payload.messages) ? payload.messages[0] : undefined) ??
    (isRecord(payload) && isRecord(payload.data) ? (payload.data as Record<string, unknown>).message : undefined);

  const fromRaw =
    (toTrimmedString(isRecord(payload) ? payload.from : undefined) ||
      toTrimmedString(isRecord(payload) ? payload.sender : undefined) ||
      toTrimmedString(isRecord(payload) ? payload.sender_id : undefined) ||
      toTrimmedString(isRecord(message) ? (message as Record<string, unknown>).from : undefined) ||
      toTrimmedString(isRecord(message) ? (message as Record<string, unknown>).remoteJid : undefined)) ||
    undefined;
  const from = typeof fromRaw === "string" ? fromRaw.trim() : undefined;

  const text =
    (toTrimmedString(isRecord(message) ? (message as Record<string, unknown>).text : undefined) ||
      toTrimmedString(isRecord(message) ? (message as Record<string, unknown>).conversation : undefined) ||
      toTrimmedString(isRecord(message) ? (message as Record<string, unknown>).body : undefined) ||
      toTrimmedString(isRecord(payload) ? (payload as Record<string, unknown>).text : undefined) ||
      toTrimmedString(isRecord(payload) && isRecord(payload.message) ? (payload.message as Record<string, unknown>).text : undefined) ||
      toTrimmedString(isRecord(payload) && isRecord(payload.message) ? (payload.message as Record<string, unknown>).body : undefined) ||
      toTrimmedString(isRecord(payload) ? (payload as Record<string, unknown>).body : undefined) ||
      toTrimmedString(isRecord(payload) && isRecord(payload.data) ? (payload.data as Record<string, unknown>).body : undefined)) ||
    undefined;

  const fromMe =
    (isRecord(payload) && (payload as Record<string, unknown>).from_me === true) ||
    (isRecord(payload) && (payload as Record<string, unknown>).fromMe === true) ||
    (isRecord(message) && (message as Record<string, unknown>).from_me === true) ||
    (isRecord(message) && (message as Record<string, unknown>).fromMe === true) ||
    (isRecord(payload) && (payload as Record<string, unknown>).is_from_me === true);

  const inboundId =
    (toTrimmedString(isRecord(payload) ? (payload as Record<string, unknown>).id : undefined) ||
      toTrimmedString(isRecord(message) ? (message as Record<string, unknown>).id : undefined) ||
      toTrimmedString(isRecord(payload) && isRecord(payload.message) ? (payload.message as Record<string, unknown>).id : undefined)) ||
    undefined;

  const isInboundText = typeof text === "string" && text.trim().length > 0;
  const autoReplyEnabled = shouldAutoReply();
  const autoReplyGate = !fromMe && autoReplyEnabled && Boolean(from) && isInboundText;

  // #region debug-point B:parse-inbound
  (() => {
    try {
      const p = ".dbg/whatsapp-no-reply.env";
      let u = process.env.DEBUG_SERVER_URL || "http://127.0.0.1:7777/event";
      let s = process.env.DEBUG_SESSION_ID || "whatsapp-no-reply";
      try {
        const e = fs.readFileSync(p, "utf8");
        u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u;
        s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s;
      } catch {}
      const payloadBody = toTrimmedString(isRecord(payload) ? (payload as Record<string, unknown>).body : undefined);
      fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: s,
          runId: "post-fix",
          hypothesisId: "B",
          location: "webhook/route.ts:POST(parse)",
          msg: "[DEBUG] parsed inbound message fields",
          data: {
            from,
            fromMe,
            shouldAutoReply: shouldAutoReply(),
            extractedText: typeof text === "string" ? text : "",
            payloadBody,
            isInboundText,
            hasMessageObject: Boolean(message),
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
    } catch {}
  })();
  // #endregion

  inboxAdd({ source: "gowa", signatureValid, from, text, body: shouldStoreBody() ? body : undefined });

  inboxAdd({
    source: "gowa",
    signatureValid: null,
    from,
    text: `[DEBUG] IN gate autoReply=${autoReplyEnabled} fromMe=${fromMe} isInboundText=${isInboundText} gate=${autoReplyGate} inboundId=${inboundId ?? ""}`,
  });

  if (autoReplyGate) {
    // #region debug-point A:auto-reply-gate
    (() => {
      try {
        const p = ".dbg/whatsapp-no-reply.env";
        let u = process.env.DEBUG_SERVER_URL || "http://127.0.0.1:7777/event";
        let s = process.env.DEBUG_SESSION_ID || "whatsapp-no-reply";
        try {
          const e = fs.readFileSync(p, "utf8");
          u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u;
          s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s;
        } catch {}
        fetch(u, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: s,
            runId: "post-fix",
            hypothesisId: "A",
            location: "webhook/route.ts:POST(gate)",
            msg: "[DEBUG] auto-reply gate passed",
            data: { from, fromMe, isInboundText, autoReply: autoReplyEnabled },
            ts: Date.now(),
          }),
        }).catch(() => {});
      } catch {}
    })();
    // #endregion
    const inboundText = String(text ?? "").trim();
    if (!from) {
      inboxAdd({ source: "gowa", signatureValid: null, from: "", text: "[DEBUG] IN gate=true but from is empty" });
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    const userKey = from;
    await ensureMessageBufferRow(userKey);
    const acquired = await tryAcquireProcessingLock(userKey);
    if (!acquired) {
      inboxAdd({ source: "gowa", signatureValid: null, from: userKey, text: "[DEBUG] Skipping reply: lock not acquired" });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    let startedPresence = false;
    try {
      const state = (await loadUserState(userKey)) ?? initState();

      if (inboundId && (state.recentInboundIds ?? []).includes(inboundId)) {
        inboxAdd({ source: "gowa", signatureValid: null, from: userKey, text: `[DEBUG] Skipping reply: duplicate inboundId=${inboundId}` });
        await saveUserState(userKey, state);
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      if (inboundId) {
        await markMessageRead(inboundId, userKey);
      }

      await sendChatPresence(userKey, "start");
      startedPresence = true;

      let reply: string | string[] = "";

      if (!state.greeted) {
        const saludo = "¡Buenas! Espero que estés teniendo un gran día, ¿en qué te podemos ayudar hoy?";
        state.greeted = true;
        state.activeBranch = "menu";
        reply = `${saludo}\n\n${buildMainMenuText()}`;
      } else if (isMenuCommand(inboundText)) {
        if (state.catalog.status === "wait_finish_cotizacion") {
          reply = "Tienes una cotización en curso. ¿Quieres terminarla o cancelarla? Responde: Terminar / Cancelar.";
        } else {
          state.activeBranch = "menu";
          resetBranchState(state, "catalogo");
          resetBranchState(state, "proyectos");
          resetBranchState(state, "puntos_venta");
          reply = buildMainMenuText();
        }
      } else {
        if (state.activeBranch === "menu") {
          if (detectQuoteIntent(inboundText)) {
            reply = await startCotizarFlow(state, userKey);
          } else {
          const choice = parseMenuChoice(inboundText) ?? classifyFreeText(inboundText);
          if (choice) {
            state.activeBranch = choice;
            resetBranchState(state, choice);
            if (choice === "catalogo") {
              reply = "Perfecto. ¿Qué tipo de producto buscas? (Ej: Equipos Radio, Repetidores, Accesorios, Cámaras Corporales)";
            } else if (choice === "servicio_tecnico") {
              reply = "Ya. Cuéntame tu duda técnica y te ayudo.";
            } else if (choice === "proyectos") {
              reply = await handleProjects(state, "");
            } else if (choice === "puntos_venta") {
              reply = "¿En qué región o ciudad estás? Así te muestro los puntos de venta más cercanos.";
            }
          } else {
            const msg = await minimaxRewrite({
              kind: "fuera_menu",
              input: inboundText,
              facts: ["Te leo. Si me dices qué necesitas, te guío al tiro."],
            });
            reply = withMainMenu(msg);
          }
          }
        } else {
          if (detectQuoteIntent(inboundText) && state.activeBranch !== "catalogo") {
            if (state.catalog.status === "wait_finish_cotizacion") {
              reply = "Tienes una cotización en curso. ¿Quieres terminarla o cancelarla? Responde: Terminar / Cancelar.";
            } else {
              reply = await startCotizarFlow(state, userKey);
            }
          } else {
          const intent = detectBranchIntent(inboundText);
          if (intent.branch && intent.branch !== state.activeBranch) {
            if (state.catalog.status === "wait_finish_cotizacion") {
              reply = "Tienes una cotización en curso. ¿Quieres terminarla o cancelarla? Responde: Terminar / Cancelar.";
            } else {
              const previous = state.activeBranch;
              state.activeBranch = intent.branch;
              resetBranchState(state, previous);
              resetBranchState(state, intent.branch);
              if (intent.branch === "proyectos") {
                reply = await handleProjects(state, inboundText);
              } else if (intent.branch === "servicio_tecnico") {
                reply = "Ya. Cuéntame tu duda técnica y te ayudo.";
              } else if (intent.branch === "puntos_venta") {
                reply = "¿En qué región o ciudad estás? Así te muestro los puntos de venta más cercanos.";
              } else if (intent.branch === "catalogo") {
                reply = "Perfecto. ¿Qué tipo de producto buscas? (Ej: Equipos Radio, Repetidores, Accesorios, Cámaras Corporales)";
              } else {
                reply = buildMainMenuText();
              }
            }
          } else if (intent.branch && intent.branch === state.activeBranch && state.activeBranch === "proyectos") {
            reply = await handleProjects(state, inboundText);
          } else {
          if (state.activeBranch === "catalogo") {
            reply = await handleCatalog(state, inboundText, userKey);
          } else if (state.activeBranch === "proyectos") {
            reply = await handleProjects(state, inboundText);
          } else if (state.activeBranch === "puntos_venta") {
            reply = await handlePoints(state, inboundText);
          } else if (state.activeBranch === "servicio_tecnico") {
            reply = await handleServicioTecnico(state, inboundText);
          } else {
            state.activeBranch = "menu";
            reply = buildMainMenuText();
          }
          }
          }
        }
      }

      if (inboundId) {
        const prev = state.recentInboundIds ?? [];
        const next = [inboundId, ...prev.filter((x) => x !== inboundId)].slice(0, 10);
        state.recentInboundIds = next;
      }

      await saveUserState(userKey, state);
      const messages = Array.isArray(reply) ? reply : [reply];
      for (const m of messages) {
        const msg = String(m ?? "").trim();
        if (msg) {
          await sendTextMessage(from, msg);
        }
      }
    } finally {
      if (startedPresence) {
        await sendChatPresence(userKey, "stop");
      }
      await releaseProcessingLock(userKey);
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function shouldStoreBody() {
  return (process.env.DEBUG_STORE_WEBHOOK_BODY ?? "").toLowerCase() === "true";
}
