import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";
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

type OutboundMessage =
  | { type: "text"; text: string }
  | { type: "image"; imageUrl: string; caption?: string };

type Reply = string | OutboundMessage | Array<string | OutboundMessage>;

async function sendImageMessage(to: string, imageUrl: string, caption?: string) {
  const baseUrl = process.env.GOWA_BASE_URL?.trim();
  if (!baseUrl) {
    inboxAdd({ source: "gowa", signatureValid: null, from: to, text: "[DEBUG] OUT: missing GOWA_BASE_URL (image)" });
    return;
  }

  const headers: Record<string, string> = {};
  const auth = toBasicAuthHeader(getGowaBasicAuth());
  if (auth) headers.Authorization = auth;
  const deviceId = getGowaDeviceId();
  if (deviceId) headers["X-Device-Id"] = deviceId;

  const form = new FormData();
  form.append("phone", to);
  form.append("image_url", imageUrl);
  if (caption) form.append("caption", caption);

  try {
    const res = await fetch(`${baseUrl}/send/image`, { method: "POST", headers, body: form });
    inboxAdd({
      source: "gowa",
      signatureValid: null,
      from: to,
      text: `[DEBUG] OUT: send/image status=${res.status} ok=${res.ok}`,
    });
  } catch (err) {
    inboxAdd({ source: "gowa", signatureValid: null, from: to, text: `[DEBUG] OUT: send/image error=${String(err)}` });
    throw err;
  }
}

type Branch = "menu" | "catalogo" | "servicio_tecnico" | "proyectos" | "puntos_venta" | "cambium";

type Country = "CL" | "UY";

type CatalogFilters = {
  tipo_producto?: string;
  tecnologia?: string;
  modalidad?: string;
  portabilidad?: string;
  frecuencia?: string;
};

type CatalogPendingOption = {
  label: string;
  value: string;
  applyFilters?: Partial<CatalogFilters>;
  skipRadioTechFrequency?: boolean;
};

type CatalogPendingOptions = {
  attr: keyof CatalogFilters;
  options: CatalogPendingOption[];
};

type CatalogQuoteStep = "nombre" | "telefono" | "email" | "empresa" | "ciudad_region" | "final";

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

type CatalogRequestKind = "cotizacion" | "arriendo";
type CatalogArriendoStage = "landing" | "direct_topic" | "product_menu";
type CatalogArriendoIntent = "cotizar_radios" | "mas_informacion";

type CatalogState = {
  filters: CatalogFilters;
  pending?: CatalogPendingOptions;
  skipRadioTechFrequency?: boolean;
  lastList?: Array<{ product_id: string; nombre: string }>;
  selectedProductId?: string;
  quote?: CatalogQuote;
  requestKind?: CatalogRequestKind;
  arriendoStage?: CatalogArriendoStage;
  arriendoIntent?: CatalogArriendoIntent;
  optionalCompanyHandled?: boolean;
  reviewMode?: "arriendo" | "cotizacion";
  reviewEditField?: Exclude<CatalogQuoteStep, "final">;
  status?: "idle" | "wait_finish_cotizacion";
  forceAskAll?: boolean;
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
  awaitingDealerOffer?: boolean;
};

type ContactFormKind = "cl_proyectos" | "cl_dealer" | "cl_servicio_tecnico" | "uy_proyectos" | "uy_servicio_tecnico";

type ContactFormStep = "nombre" | "empresa" | "telefono" | "correo" | "direccion" | "producto" | "mensaje" | "final";

type ContactFormState = {
  kind: ContactFormKind;
  step: ContactFormStep;
  reviewMode?: boolean;
  reviewEditField?: Exclude<ContactFormStep, "final">;
  optionalProductHandled?: boolean;
  data: Partial<{
    nombre: string;
    empresa: string;
    telefono: string;
    correo: string;
    direccion: string;
    producto: string;
    mensaje: string;
  }>;
};

type CambiumCategory = "conectividad" | "radioenlaces";

type CambiumQuoteStep = "nombre" | "empresa" | "telefono" | "solucion" | "email" | "direccion" | "final";

type CambiumQuote = {
  step: CambiumQuoteStep;
  data: Partial<{
    nombre: string;
    empresa: string;
    telefono: string;
    solucion: string;
    email: string;
    direccion: string;
    categoria: string;
    producto: string;
  }>;
};

type CambiumProduct = { name: string; imageUrl?: string; detail?: string };

type CambiumState = {
  category?: CambiumCategory;
  lastList?: CambiumProduct[];
  selected?: CambiumProduct;
  quote?: CambiumQuote;
};

type UserState = {
  v: 1;
  greeted: boolean;
  lastMenuDate?: string;
  country?: Country;
  activeBranch: Branch;
  userName?: string;
  recentInboundIds?: string[];
  recentInboundHashes?: Array<{ h: string; ts: number }>;
  serviceTech?: {
    lastProducto?: string;
  };
  catalog: CatalogState;
  projects: ProjectsState;
  points: PointsState;
  contactForm?: ContactFormState;
  cambium?: CambiumState;
  postCotizacion?: {
    awaitingAction?: boolean;
    awaitingReuseConfirm?: boolean;
  };
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

function hasAnalogTechnology(value: string) {
  const t = normalizeText(value);
  return t.includes("analogo") || t.includes("analogico");
}

function hasDigitalTechnology(value: string) {
  return normalizeText(value).includes("digital");
}

function matchesSelectedTechnology(value: string, selected?: string) {
  const wanted = normalizeText(selected ?? "");
  if (!wanted) return true;
  const v = value ?? "";
  if (wanted.includes("digital")) return hasDigitalTechnology(v);
  if (wanted.includes("analogo") || wanted.includes("analogico")) return hasAnalogTechnology(v);
  return normalizeText(v).includes(wanted);
}

function detectCountryFromPhone(phone: string): Country {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  if (digits.startsWith("598")) return "UY";
  if (digits.startsWith("56")) return "CL";
  return "CL";
}

function isAffirmative(text: string) {
  const t = normalizeText(text);
  return t === "si" || t === "sí" || t.startsWith("si ") || t.startsWith("sí ") || t.includes("quiero") || t.includes("dale") || t.includes("ok");
}

function isNegative(text: string) {
  const t = normalizeText(text);
  return t === "no" || t.startsWith("no ") || t.includes("no gracias") || t.includes("por ahora no");
}

function getCurrentDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function isGreetingMessage(text: string) {
  const t = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  const greetings = new Set([
    "hola",
    "holi",
    "ola",
    "alo",
    "hello",
    "buenas",
    "buen dia",
    "buenos dias",
    "buenas tardes",
    "buenas noches",
    "buenas buenas",
  ]);
  return greetings.has(t);
}

function getAvailableBranches(country: Country): Branch[] {
  if (country === "UY") return ["catalogo", "servicio_tecnico", "proyectos", "cambium"];
  return ["catalogo", "servicio_tecnico", "proyectos", "puntos_venta"];
}

function isBranchAvailable(country: Country, branch: Branch) {
  if (branch === "menu") return true;
  return getAvailableBranches(country).includes(branch);
}

const localTextCache = new Map<string, string>();

function readLocalTextFile(relPath: string) {
  const key = relPath.replace(/\\/g, "/");
  const cached = localTextCache.get(key);
  if (cached != null) return cached;
  try {
    const abs = path.join(process.cwd(), relPath);
    const text = fs.readFileSync(abs, "utf8");
    localTextCache.set(key, text);
    return text;
  } catch {
    localTextCache.set(key, "");
    return "";
  }
}

function isPuntosVentaIntentNormalized(normalizedText: string) {
  const s = (normalizedText || "").replace(/[^a-z0-9]+/g, " ").trim();
  if (!s) return false;
  if (/\bpuntos?\s+(de\s+)?ventas?\b/.test(s)) return true;
  if (/\bdealers?\b/.test(s)) return true;
  if (/\bdistribuidores?\b/.test(s)) return true;
  return false;
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

function tokenizeGeneric(text: string) {
  return normalizeText(text)
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 3);
}

function matchPendingOption(input: string, options: CatalogPendingOption[]) {
  const raw = input.trim();
  if (!raw) return { value: null as string | null, ambiguous: false };
  const inNorm = normalizeText(raw);
  const tokens = tokenizeGeneric(raw);
  if (!tokens.length) return { value: null as string | null, ambiguous: false };

  let bestScore = 0;
  let best: CatalogPendingOption | null = null;
  let tie = false;

  for (const o of options) {
    const labelNorm = normalizeText(o.label);
    const valueNorm = normalizeText(o.value);
    let score = 0;
    if (labelNorm === inNorm || valueNorm === inNorm) score += 100;
    if (inNorm.includes(labelNorm) || labelNorm.includes(inNorm)) score += 10;
    if (inNorm.includes(valueNorm) || valueNorm.includes(inNorm)) score += 10;
    score += scoreTokenMatch(tokens, `${labelNorm} ${valueNorm}`);

    if (score > bestScore) {
      bestScore = score;
      best = o;
      tie = false;
    } else if (score === bestScore && score > 0 && best && best.value !== o.value) {
      tie = true;
    }
  }

  if (!best || bestScore <= 0) return { value: null as string | null, ambiguous: false };
  if (tie) return { value: null as string | null, ambiguous: true };
  return { value: best.value, ambiguous: false };
}

function extractChoiceNumberFromText(text: string, max: number) {
  if (!text) return null as number | null;
  const m = normalizeText(text).match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > max) return null;
  return n;
}

type ProductDetail = {
  productId: string;
  nombre: string;
  shortFinal?: string;
  imageUrl?: string;
  fichaUrl?: string;
  precio?: string;
};

function buildProductsListMessage(products: Array<{ product_id: string; nombre: string }>, example: string) {
  const lines = products
    .slice(0, 5)
    .map((p, i) => `${i + 1}) ${cleanProductName(p.nombre)}`)
    .join("\n");
  return [
    "Estos son los que encontré (máx. 5):",
    "",
    lines,
    "",
    `Indícame qué opción quieres para mostrarte su ficha. También puedes decir el nombre (ej: ${example}).`,
  ].join("\n");
}

function buildProductFichaMessages(detail: ProductDetail | null, options?: { requestKind?: CatalogRequestKind }) {
  if (!detail) return [];
  const title = cleanProductName(detail.nombre || "");
  const header = title ? `*${title}*` : "*Producto*";
  const bodyLines: string[] = [];
  if (detail.precio) bodyLines.push(`💰 Precio: ${detail.precio}`);
  if (detail.shortFinal) bodyLines.push(detail.shortFinal);
  if (detail.fichaUrl) bodyLines.push(`📄 Ficha técnica: ${detail.fichaUrl}`);
  const body = bodyLines.filter(Boolean).join("\n");
  const primaryAction = options?.requestKind === "arriendo" ? "Arrendar este equipo" : "Cotizar este equipo";
  const actions = ["¿Qué deseas hacer ahora?", "", primaryAction, "Volver a la lista", "Volver al menú", "Hacer una nueva búsqueda"].join("\n");

  const out: Array<string | OutboundMessage> = [header];
  if (detail.imageUrl) out.push({ type: "image", imageUrl: detail.imageUrl });
  if (body.trim()) out.push(body);
  out.push(actions);
  return out;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isStockQuestion(text: string) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    t.includes("stock") ||
    t.includes("hay disponible") ||
    t.includes("tienen disponible") ||
    t.includes("disponibilidad") ||
    t.includes("inventario") ||
    t.includes("entrega inmediata")
  );
}

function parseCityRegionInput(input: string) {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;
  const parts = normalized
    .split(/\n|,|\/| - |\|/g)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return { ciudad: parts[0]!, region: parts.slice(1).join(", ") };
  }
  const match = normalized.match(/^(.+?)\s+(?:-|,)?\s*(region|región|rm|metropolitana|valparaiso|valparaíso|biobio|biobío|araucania|araucanía|ohiggins|o'higgins|maule|antofagasta|atacama|coquimbo|tarapaca|tarapacá|los lagos|los rios|los ríos|aysen|aysén|magallanes)\b/i);
  if (match) {
    const ciudad = match[1]?.trim();
    const region = normalized.slice(ciudad.length).replace(/^[,\-\s]+/, "").trim();
    if (ciudad && region) return { ciudad, region };
  }
  return null;
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

function extractLikelyProductModel(text: string) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const m = raw.toUpperCase().match(/\b[A-Z]{1,6}\s?-?\s?\d{2,6}[A-Z]?\b/);
  if (!m?.[0]) return "";
  return m[0].replace(/[\s-]+/g, "").trim();
}

function extractInboundTimestampMs(payload: unknown, message: unknown) {
  const pick = (obj: unknown, key: string) => toTrimmedString(isRecord(obj) ? (obj as Record<string, unknown>)[key] : undefined);
  const raw =
    pick(message, "timestamp") ||
    pick(message, "messageTimestamp") ||
    pick(message, "t") ||
    pick(payload, "timestamp") ||
    pick(payload, "messageTimestamp") ||
    pick(payload, "t") ||
    pick(payload, "ts");
  if (!raw) return null as number | null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1_000_000_000_000 ? Math.trunc(n * 1000) : Math.trunc(n);
}

function buildInboundDedupeKey(from: string, text: string, tsMs: number) {
  const base = `${normalizeText(from)}|${normalizeText(text)}`;
  const h = crypto.createHash("sha256").update(base).digest("hex").slice(0, 16);
  const ts = Number.isFinite(tsMs) && tsMs > 0 ? Math.trunc(tsMs) : 0;
  return `t${ts}:${h}`;
}

function shouldUseServiceTechOpeningPrompt(text: string) {
  const t = normalizeText(text);
  if (!t) return true;
  if (t === "2") return true;
  if (t === "servicio tecnico" || t === "servicio técnico") return true;
  if (t === "soporte tecnico" || t === "soporte técnico") return true;
  if (t === "tecnico" || t === "técnico") return true;
  if (t.includes("servicio tecnico") || t.includes("servicio técnico")) return t.length <= 28;
  if (t.includes("soporte tecnico") || t.includes("soporte técnico")) return t.length <= 26;
  return false;
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

function isProjectsIntentNormalized(t: string) {
  if (!t) return false;
  return (
    t.includes("proyecto") ||
    t.includes("proyectos") ||
    t.includes("poryecto") ||
    t.includes("poryectos") ||
    t.includes("proyeto") ||
    t.includes("proyetos") ||
    t.includes("proyect") ||
    t.includes("asesoria") ||
    t.includes("asesoría") ||
    t.includes("consultoria") ||
    t.includes("consultoría")
  );
}

function detectBranchIntent(text: string, country: Country): { branch: Branch | null; wantsMenu: boolean } {
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

  const mentionsCatalog =
    t.includes("catalogo") ||
    t.includes("catálogo") ||
    t.includes("cotizar") ||
    t.includes("cotizacion") ||
    t.includes("cotización") ||
    t.includes("comprar") ||
    t.includes("compra") ||
    t.includes("comprame") ||
    t.includes("cómprame") ||
    t.includes("adquirir") ||
    t.includes("arrendar") ||
    t.includes("arriendo") ||
    t.includes("alquilar");
  const mentionsServicio = t.includes("servicio tecnico") || t.includes("servicio técnico") || t.includes("soporte tecnico") || t.includes("soporte técnico");
  const mentionsProjects = isProjectsIntentNormalized(t);
  const mentionsCambium = t.includes("cambium") || t.includes("cnmaestro") || t.includes("epmp") || t.includes("radioenlace") || t.includes("radioenlaces");
  const mentionsPoints = country !== "UY" && isPuntosVentaIntentNormalized(t);

  if (mentionsCatalog) return { branch: "catalogo", wantsMenu };
  if (mentionsServicio) return { branch: "servicio_tecnico", wantsMenu };
  if (mentionsProjects) return { branch: "proyectos", wantsMenu };
  if (mentionsCambium) return { branch: "cambium", wantsMenu };
  if (mentionsPoints) return { branch: "puntos_venta", wantsMenu };
  return { branch: null, wantsMenu };
}

function detectQuoteIntent(text: string) {
  const t = normalizeText(text);
  if (!t) return false;
  if (t.includes("donde comprar") || t.includes("dónde comprar") || t.includes("puntos de venta") || t.includes("punto de venta")) return false;
  return (
    t.includes("cotiz") ||
    t.includes("cotizacion") ||
    t.includes("cotización") ||
    t.includes("comprar") ||
    t.includes("compra") ||
    t.includes("comprame") ||
    t.includes("cómprame") ||
    t.includes("adquirir") ||
    t.includes("presupuest") ||
    t.includes("precio") ||
    t.includes("valor") ||
    t.includes("cuanto cuesta") ||
    t.includes("cuánto cuesta")
  );
}

function isRentalIntent(text: string) {
  const t = normalizeText(text);
  if (!t) return false;
  return t.includes("arrend") || t.includes("alquil") || t.includes("renta");
}

function isRentalRequest(state: UserState) {
  return state.catalog.requestKind === "arriendo" || normalizeText(state.catalog.filters.modalidad || "").includes("arriendo");
}

function buildArriendoLandingMessage(): Reply {
  return [
    [
      "Descubre las ventajas de arrendar con InterWins.",
      "Disponibilidad inmediata. Arrienda Radios Motorola y accesorios de manera permanente, por meses o por evento.",
    ].join("\n"),
    ["¿Qué opción prefieres para elegir?", "", "📻 Equipos de radio", "🎧 Accesorio de radio", "📷 Cámara corporal", "🤝 Arrendar directamente con un ejecutivo"].join(
      "\n",
    ),
  ];
}

function buildArriendoIntentMessage() {
  return [
    "Cuéntanos qué necesitas:",
    "",
    "1) Cotizar Arriendo de Radios",
    "2) Más Información",
  ].join("\n");
}

function buildArriendoProductMenuMessage(): Reply {
  return [
    "Perfecto. Para arrendar, ¿qué equipo buscas?",
    ["¿Qué opción prefieres para elegir?", "", "📻 Equipos de radio", "🎧 Accesorio de radio", "📷 Cámara corporal", "🤝 Arrendar directamente con un ejecutivo"].join(
      "\n",
    ),
  ];
}

function withCatalogTypeIcon(label: string) {
  const t = normalizeText(label);
  if (t.includes("accesor")) return `🎧 ${label}`;
  if (t.includes("camara")) return `📷 ${label}`;
  if (t.includes("equipo") || t.includes("radio")) return `📻 ${label}`;
  return label;
}

function buildCotizarProductMenuMessage(options: CatalogPendingOption[]): Reply {
  return [
    "Perfecto. Para cotizar, ¿qué tipo de producto te interesa?",
    options.map((option) => option.label).join("\n"),
    "También puedes escribir el nombre del equipo (ej: DP50).",
  ];
}

function parseArriendoLandingChoice(text: string) {
  const t = normalizeText(text);
  if (!t) return null;
  if (t === "1" || (t.includes("buscar") && t.includes("arrend")) || (t.includes("producto") && t.includes("arrend"))) return "buscar";
  if (t === "2" || t === "arrendar" || t === "arrendar equipos" || (t.includes("arrend") && !t.includes("buscar"))) return "directo";
  return null;
}

function parseArriendoIntentChoice(text: string): CatalogArriendoIntent | null {
  const t = normalizeText(text);
  if (!t) return null;
  if (t === "1" || t.includes("cotizar") || t.includes("radios")) return "cotizar_radios";
  if (t === "2" || t.includes("mas informacion") || t.includes("más información") || t.includes("informacion") || t.includes("información")) {
    return "mas_informacion";
  }
  return null;
}

function parseArriendoProductChoice(text: string): "equipos_radio" | "accesorio_radio" | "camara_corporal" | "dealer_region" | null {
  const t = normalizeText(text);
  if (!t) return null;

  if (t === "1") return "equipos_radio";
  if (t === "2") return "accesorio_radio";
  if (t === "3") return "camara_corporal";
  if (t === "4") return "dealer_region";

  const equipmentTerms = [
    "equipo",
    "equipos",
    "equpo",
    "eqipo",
    "equp",
    "equipo de radio",
    "equipos de radio",
    "radio movil",
    "radio móvil",
    "radio base",
    "radio",
    "radios",
    "handy",
    "portatil",
    "portátil",
    "movil",
    "móvil",
  ];
  const accessoryTerms = [
    "accesorio",
    "accesorios",
    "antena",
    "bateria",
    "batería",
    "cargador",
    "microfono",
    "micrófono",
    "parlante microfono",
    "parlante micrófono",
    "auricular",
  ];
  const cameraTerms = [
    "camara corporal",
    "cámara corporal",
    "bodycam",
    "camara personal",
    "cámara personal",
    "camara de cuerpo",
    "cámara de cuerpo",
  ];
  const dealerTerms = [
    "dealer",
    "distribuidor",
    "distribuidores",
    "ejecutivo",
    "asesor",
    "arrendar directamente",
    "directamente",
    "contacto directo",
    "contactar",
  ];

  const scoreByTerms = (terms: string[]) => terms.reduce((acc, term) => acc + (t.includes(term) ? 1 : 0), 0);

  const equipmentScore = scoreByTerms(equipmentTerms) + (t.includes("equipo") && t.includes("radio") ? 1 : 0);
  const accessoryScore = scoreByTerms(accessoryTerms) + (t.includes("radio") && t.includes("accesorio") ? 1 : 0);
  const cameraScore = scoreByTerms(cameraTerms) + (t.includes("camara") || t.includes("cámara") ? 1 : 0);
  const dealerScore =
    scoreByTerms(dealerTerms) +
    (t.includes("region") || t.includes("región") ? 1 : 0) +
    ((t.includes("arrendar") && t.includes("direct")) ? 1 : 0) +
    ((t.includes("contact") && (t.includes("dealer") || t.includes("ejecutivo") || t.includes("asesor"))) ? 1 : 0) +
    ((t.includes("hablar") && (t.includes("ejecutivo") || t.includes("asesor"))) ? 1 : 0);

  if (dealerScore > 0 && equipmentScore === 0 && accessoryScore === 0 && cameraScore === 0) return "dealer_region";
  if (cameraScore > 0 && cameraScore >= equipmentScore && cameraScore >= accessoryScore) return "camara_corporal";
  if (equipmentScore > 0 && accessoryScore > 0) {
    return equipmentScore >= accessoryScore ? "equipos_radio" : "accesorio_radio";
  }
  if (equipmentScore > 0) return "equipos_radio";
  if (accessoryScore > 0) return "accesorio_radio";
  if (dealerScore > 0) return "dealer_region";
  return null;
}

async function listDistinctTipoProductoByModalidad(country: Country, modalidad: string): Promise<string[]> {
  if (country === "UY") {
    return await listDistinctUyColumn("tipo_producto", { modalidad });
  }
  const q = `inter_products?select=tipo_producto&tipo_producto=not.is.null&modalidad=eq.${encodeURIComponent(modalidad)}&limit=1000`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  const values = (res.data as unknown[])
    .map((r) => toTrimmedString(getRecordValue(r, "tipo_producto")))
    .filter(Boolean);
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es"));
}

type SuggestedCatalogTypeKey = "equipos_radio" | "accesorio_radio" | "camara_corporal";

function findBestCatalogTypeByKeywords(tipos: string[], keywords: string[]) {
  const scored = tipos
    .map((tp) => {
      const hay = normalizeText(tp);
      const score = scoreTokenMatch(keywords.map((k) => normalizeText(k)), hay);
      return { tp, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.score >= 1 ? best.tp : undefined;
}

async function getSuggestedCatalogTypes(country: Country, modalidad?: string) {
  const tipos = modalidad
    ? await listDistinctTipoProductoByModalidad(country, modalidad)
    : country === "UY"
      ? await listDistinctTipoProductoUY()
      : await listDistinctTipoProducto();
  const wanted: Array<{ key: SuggestedCatalogTypeKey; label: string; keywords: string[] }> = [
    { key: "accesorio_radio", label: "Accesorios", keywords: ["accesorios", "accesorio", "bateria", "batería", "antena", "cargador", "auricular", "mic", "microfono", "micrófono"] },
    { key: "camara_corporal", label: "Cámaras Corporales", keywords: ["camara", "cámara", "camaras", "cámaras", "corporal", "bodycam", "body"] },
    { key: "equipos_radio", label: "Equipos Radio", keywords: ["equipos", "equipo", "radio", "radios", "handy", "portatil", "portátil", "movil", "móvil"] },
  ];

  const suggested: Array<{ key: SuggestedCatalogTypeKey; label: string; tipo: string }> = [];
  for (const w of wanted) {
    const best = findBestCatalogTypeByKeywords(tipos, w.keywords);
    if (best) {
      suggested.push({ key: w.key, label: w.label, tipo: best });
    }
  }

  const menu: Array<{ key: SuggestedCatalogTypeKey; label: string; tipo: string }> = [];
  for (const s of suggested) {
    if (menu.some((m) => m.tipo === s.tipo)) continue;
    menu.push(s);
  }
  return menu;
}

async function buildRadioSubtypeOptions(country: Country, filters: CatalogFilters): Promise<CatalogPendingOption[]> {
  const portabilidades = country === "UY" ? await listPortabilidadesUY(filters) : await listPortabilidades(filters);

  const options: CatalogPendingOption[] = [];
  const portable = portabilidades.find((o) => normalizeText(o).includes("portatil"));
  if (portable) {
    options.push({ label: "📻 Portátiles (Handy)", value: portable });
  }
  const mobile = portabilidades.find((o) => normalizeText(o).includes("movil"));
  if (mobile) {
    options.push({ label: "🚗 Móviles (Para vehículos/base)", value: mobile });
  }
  const repeaterPortability = portabilidades.find((o) => normalizeText(o).includes("repetidor"));
  if (repeaterPortability) {
    options.push({ label: "📡 Repetidores", value: repeaterPortability });
  }
  return options;
}

async function startCatalogFlow(state: UserState, userKey: string, args?: { modalidad?: string; mode?: "cotizar" | "arriendo"; seedText?: string }) {
  const country = state.country ?? "CL";
  const previous = state.activeBranch;
  state.activeBranch = "catalogo";
  resetBranchState(state, previous);
  resetBranchState(state, "catalogo");
  state.catalog.requestKind = args?.mode === "arriendo" ? "arriendo" : "cotizacion";
  state.catalog.arriendoStage = undefined;
  state.catalog.arriendoIntent = undefined;
  state.catalog.optionalCompanyHandled = false;
  const isRental = args?.mode === "arriendo";
  state.catalog.filters.modalidad = args?.modalidad ?? (isRental ? "Arriendo" : "Venta");

  if (state.catalog.selectedProductId) {
    return country === "UY" ? await handleCatalogUY(state, "cotizar", userKey) : await handleCatalog(state, "cotizar", userKey);
  }

  if (!isRental && !state.catalog.filters.tipo_producto && !state.catalog.pending && args?.seedText) {
    const hint = parseArriendoProductChoice(args.seedText);
    if (hint === "equipos_radio") {
      const menu = await getSuggestedCatalogTypes(country, args?.modalidad);
      const equipment = menu.find((m) => m.key === "equipos_radio");
      if (equipment?.tipo) {
        state.catalog.filters.tipo_producto = equipment.tipo;
        return country === "UY" ? await handleCatalogUY(state, "", userKey) : await handleCatalog(state, "", userKey);
      }
    }
  }

  if (!state.catalog.filters.tipo_producto && !state.catalog.pending) {
    const menu = await getSuggestedCatalogTypes(country, args?.modalidad);

    if (isRental) {
      state.catalog.arriendoStage = "product_menu";
      return buildArriendoProductMenuMessage();
    }

    if (menu.length >= 2) {
      const top = menu.slice(0, 5);
      const options = top.map((m) => ({ label: withCatalogTypeIcon(m.label), value: m.tipo }));
      state.catalog.pending = { attr: "tipo_producto", options };
      return buildCotizarProductMenuMessage(options);
    }
  }

  return isRental
    ? buildArriendoProductMenuMessage()
    : buildCotizarProductMenuMessage([
        { label: "📻 Equipos Radio", value: "equipos-radio" },
        { label: "🎧 Accesorios", value: "accesorios" },
        { label: "📷 Cámaras Corporales", value: "camaras-corporales" },
      ]);
}

async function startCotizarFlow(state: UserState, userKey: string, seedText?: string) {
  return await startCatalogFlow(state, userKey, { mode: "cotizar", seedText });
}

async function startArriendoFlow(state: UserState, userKey: string) {
  const previous = state.activeBranch;
  state.activeBranch = "catalogo";
  resetBranchState(state, previous);
  resetBranchState(state, "catalogo");
  state.catalog.requestKind = "arriendo";
  state.catalog.arriendoStage = "product_menu";
  state.catalog.optionalCompanyHandled = false;
  return buildArriendoLandingMessage();
}

async function startCatalogIntentFlow(state: UserState, userKey: string, text: string) {
  const country = state.country ?? "CL";
  if (country === "CL" && isRentalIntent(text)) {
    return await startArriendoFlow(state, userKey);
  }
  return await startCotizarFlow(state, userKey, text);
}

function buildMainMenuText(country: Country, variant: "welcome" | "return" = "return") {
  const introsWelcomeCL = [
    "¡Hola! Bienvenido al asistente virtual de InterWins.",
    "¡Hola! Qué bueno tenerte por aquí.",
  ];
  const introsReturnCL = [
    "Si quieres, también te puedo ayudar con esto:",
    "Seguimos cuando quieras. También puedo ayudarte con:",
  ];
  const introsWelcomeUY = [
    "¡Hola! Bienvenido al asistente virtual de InterWins.",
    "¡Hola! Encantado de ayudarte.",
  ];
  const introsReturnUY = [
    "Si quieres, también te puedo ayudar con esto:",
    "Seguimos por aquí. También puedo ayudarte con:",
  ];
  const introList =
    country === "UY"
      ? variant === "welcome"
        ? introsWelcomeUY
        : introsReturnUY
      : variant === "welcome"
        ? introsWelcomeCL
        : introsReturnCL;
  const intro = introList[crypto.randomInt(0, introList.length)];
  if (country === "UY") {
    return [
      intro,
      "",
      "Estas son algunas de las cosas con las que te puedo apoyar hoy:",
      "",
      "🛒 Comprar equipos o accesorios",
      "🔧 Servicio Técnico",
      "📊 Asesoría en Proyectos",
      "🌐 Soluciones Cambium Networks",
    ].join("\n");
  }

  return [
    intro,
    "",
    "Estas son algunas de las cosas con las que te puedo apoyar hoy:",
    "",
    "🛒 Comprar equipos o accesorios",
    "⏱️ Arrendar equipos de radiocomunicación",
    "📊 Asesoría en Proyectos",
    "🔧 Servicio Técnico",
    "📍 Direcciones y Puntos de Venta",
  ].join("\n");
}

function markMenuShown(state: UserState) {
  state.greeted = true;
  state.lastMenuDate = getCurrentDateKey();
}

function withMainMenu(message: string, state: UserState, country: Country, variant: "welcome" | "return" = "return") {
  markMenuShown(state);
  const m = message.trim();
  return m ? `${m}\n\n${buildMainMenuText(country, variant)}` : buildMainMenuText(country, variant);
}

function parseMenuChoice(text: string, country: Country): Branch | null {
  const t = normalizeText(text);
  if (t === "1" || t.includes("catalogo") || t.includes("catálogo") || t.includes("cotizar") || t.includes("cotizacion") || t.includes("cotización"))
    return "catalogo";
  if (t === "2" || t.includes("servicio") || t.includes("tecnico") || t.includes("técnico")) return "servicio_tecnico";
  if (t === "3" || isProjectsIntentNormalized(t)) return "proyectos";
  if (t === "4") return country === "UY" ? "cambium" : "puntos_venta";
  if (country !== "UY" && isPuntosVentaIntentNormalized(t)) return "puntos_venta";
  if (t.includes("cambium") || t.includes("cnmaestro")) return "cambium";
  return null;
}

function classifyFreeText(text: string, country: Country): Branch | null {
  const t = normalizeText(text);
  const catalogHints = [
    "cotizar",
    "cotizacion",
    "precio",
    "valor",
    "comprar",
    "compra",
    "adquirir",
    "radio",
    "repetidor",
    "camara",
    "cámara",
    "accesorio",
    "equipo",
    "equpo",
    "eqipo",
    "arrendar",
    "arriendo",
    "alquilar",
  ];
  const techHints = ["falla", "problema", "repar", "garantia", "garantía", "program", "configur", "servicio tecnico", "servicio técnico"];
  const projectHints = [
    "proyecto",
    "proyectos",
    "poryecto",
    "poryectos",
    "proyeto",
    "proyetos",
    "proyect",
    "asesoria",
    "asesoría",
    "asesoramiento",
    "consultoria",
    "consultoría",
    "implementacion",
    "implementación",
    "caso de exito",
    "caso de éxito",
    "certificacion",
    "certificación",
  ];
  const cambiumHints = ["cambium", "cnmaestro", "epmp", "ptp", "pmp", "radioenlace", "radioenlaces", "wifi", "sd wan", "sd-wan", "nse"];
  const pointsHints = [
    "donde comprar",
    "dónde comprar",
    "sucursal",
    "tienda",
    "punto de venta",
    "puntos de venta",
    "punto venta",
    "puntos venta",
    "dealer",
    "distribuidor",
    "distribuidores",
  ];

  if (country !== "UY") {
    if (isPuntosVentaIntentNormalized(t)) return "puntos_venta";
    if (pointsHints.some((h) => t.includes(normalizeText(h)))) return "puntos_venta";
  }

  if (cambiumHints.some((h) => t.includes(normalizeText(h)))) return "cambium";
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

function isRadioEquipmentTipoProducto(tipoProducto?: string) {
  const t = normalizeText(tipoProducto || "");
  return t.includes("equipo") && t.includes("radio");
}

function formatPortabilidadLabel(option: string) {
  const t = normalizeText(option);
  if (t.includes("portatil")) return "Portátiles (Handy)";
  if (t.includes("movil")) return "Móviles (Para vehículos/base)";
  return option;
}

function buildRadioFrequencyTechnologyOptions(): CatalogPendingOption[] {
  return [
    {
      label: "UHF - ANÁLOGO",
      value: "UHF - ANÁLOGO",
      applyFilters: { frecuencia: "UHF", tecnologia: "ANALOGO" },
    },
    {
      label: "UHF - DIGITAL",
      value: "UHF - DIGITAL",
      applyFilters: { frecuencia: "UHF", tecnologia: "DIGITAL" },
    },
    {
      label: "VHF - ANÁLOGO",
      value: "VHF - ANÁLOGO",
      applyFilters: { frecuencia: "VHF", tecnologia: "ANALOGO" },
    },
    {
      label: "VHF - DIGITAL",
      value: "VHF - DIGITAL",
      applyFilters: { frecuencia: "VHF", tecnologia: "DIGITAL" },
    },
    {
      label: "No estoy seguro / Necesito asesoría",
      value: "No estoy seguro / Necesito asesoría",
      skipRadioTechFrequency: true,
    },
  ];
}

function applyCatalogPendingSelection(state: UserState, pending: CatalogPendingOptions, option: CatalogPendingOption) {
  if (option.applyFilters) {
    Object.assign(state.catalog.filters, option.applyFilters);
    state.catalog.skipRadioTechFrequency = false;
  } else {
    state.catalog.filters[pending.attr] = option.value;
  }
  if (pending.attr === "tipo_producto") {
    state.catalog.selectedProductId = undefined;
    state.catalog.lastList = undefined;
    state.catalog.filters.frecuencia = undefined;
    state.catalog.filters.tecnologia = undefined;
    state.catalog.filters.portabilidad = undefined;
    state.catalog.skipRadioTechFrequency = undefined;
  }
  if (option.skipRadioTechFrequency) {
    state.catalog.skipRadioTechFrequency = true;
    state.catalog.filters.frecuencia = undefined;
    state.catalog.filters.tecnologia = undefined;
  }
  state.catalog.pending = undefined;
}

function stripNectarShortcodes(text: string) {
  return text.replace(/\[nectar_btn[^\]]*\]/gi, "").replace(/\s+/g, " ").trim();
}

function removeNectarShortcodesRaw(text: string) {
  return text.replace(/\[nectar_btn[^\]]*\]/gi, "");
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const cp = Number.parseInt(String(hex), 16);
      if (!Number.isFinite(cp)) return "";
      try {
        return String.fromCodePoint(cp);
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = Number.parseInt(String(dec), 10);
      if (!Number.isFinite(cp)) return "";
      try {
        return String.fromCodePoint(cp);
      } catch {
        return "";
      }
    });
}

function htmlToParagraphText(html: string) {
  const raw = removeNectarShortcodesRaw(html || "");
  if (!raw.trim()) return "";

  let s = raw;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");

  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|section|article|header|footer|blockquote)>/gi, "\n\n");
  s = s.replace(/<(p|div|h[1-6]|section|article|header|footer|blockquote)[^>]*>/gi, "\n\n");
  s = s.replace(/<\/li>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "• ");

  s = s.replace(/<[^>]+>/g, " ");
  s = decodeHtmlEntities(s);
  s = s
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lines = s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l !== "");

  const joined = lines.join("\n");
  return joined.replace(/\n{2,}/g, "\n\n").trim();
}

function normalizeParagraphs(text: string) {
  const t = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!t) return [];
  return t
    .split(/\n{2,}/g)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function splitLongText(text: string, maxLen: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?])\s+/g);
  const out: string[] = [];
  let cur = "";

  const flush = () => {
    const v = cur.trim();
    if (v) out.push(v);
    cur = "";
  };

  for (const s of sentences) {
    const seg = s.trim();
    if (!seg) continue;
    if (!cur) {
      if (seg.length <= maxLen) {
        cur = seg;
        continue;
      }
      let rest = seg;
      while (rest.length > maxLen) {
        const cut = rest.lastIndexOf(" ", maxLen);
        const idx = cut > 0 ? cut : maxLen;
        out.push(rest.slice(0, idx).trim());
        rest = rest.slice(idx).trim();
      }
      if (rest) cur = rest;
      continue;
    }

    const cand = `${cur} ${seg}`.trim();
    if (cand.length <= maxLen) {
      cur = cand;
      continue;
    }
    flush();
    if (seg.length <= maxLen) cur = seg;
    else out.push(...splitLongText(seg, maxLen));
  }

  flush();
  return out.filter(Boolean);
}

function summarizeProject(text: string, maxLen: number) {
  const paragraphs = normalizeParagraphs(text);
  if (!paragraphs.length) return "";
  const base = paragraphs.slice(0, 2).join("\n\n").trim();
  if (base.length <= maxLen) return base;

  const sents = base.split(/(?<=[.!?])\s+/g).filter(Boolean);
  const short = sents.slice(0, 4).join(" ").trim();
  if (short.length <= maxLen) return short;

  const cut = short.lastIndexOf(" ", maxLen);
  return (cut > 0 ? short.slice(0, cut) : short.slice(0, maxLen)).trim();
}

type UyProject = { id: number; titulo: string; contenido: string };

function loadUyProjectsData() {
  const raw = readLocalTextFile(path.join("instructivo", "uruguay", "proyectos.txt"));
  const lines = (raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const projects: UyProject[] = [];
  let bankStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (normalizeText(l).startsWith("banco informativo")) {
      bankStart = i;
      break;
    }
  }

  const bodyLines = bankStart === -1 ? lines : lines.slice(0, bankStart);
  const bankLines = bankStart === -1 ? [] : lines.slice(bankStart);
  const bankText = bankLines.join("\n").trim();

  let current: UyProject | null = null;
  for (const rawLine of bodyLines) {
    const line = String(rawLine ?? "").trimEnd();
    const m = line.match(/^\s*(\d+)\s*-\s*(.+)\s*$/);
    if (m) {
      if (current) projects.push({ ...current, contenido: current.contenido.trim() });
      current = { id: Number(m[1]), titulo: String(m[2]).trim(), contenido: "" };
      continue;
    }
    if (!current) continue;
    const cleaned = line.replace(/^\s*contrenido\s*:\s*/i, "").replace(/^\s*contenido\s*:\s*/i, "").trim();
    if (!cleaned) continue;
    current.contenido = current.contenido ? `${current.contenido}\n${cleaned}` : cleaned;
  }
  if (current) projects.push({ ...current, contenido: current.contenido.trim() });

  const safe = projects.filter((p) => Number.isFinite(p.id) && p.titulo);
  safe.sort((a, b) => a.id - b.id);
  return { projects: safe, bankText };
}

function loadUyServicioTecnicoText() {
  return readLocalTextFile(path.join("instructivo", "uruguay", "servicio_tecnico.txt")).trim();
}

function loadCambiumData() {
  const raw = readLocalTextFile(path.join("instructivo", "uruguay", "cambium_networks"));
  const text = (raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const intro = lines[0] || "Cambium Networks ofrece soluciones inalámbricas de alto rendimiento.";

  const normalized = lines.map((l) => normalizeText(l));
  const idxCon = normalized.findIndex((l) => l.startsWith("1.-conectividad empresarial"));
  const idxRad = normalized.findIndex((l) => l.startsWith("2.-radioenlaces"));
  const idxBank = normalized.findIndex((l) => l.startsWith("informacion para el banco") || l.startsWith("información para el banco"));

  const conSection = idxCon >= 0 ? lines.slice(idxCon, idxRad > idxCon ? idxRad : idxBank > idxCon ? idxBank : lines.length) : [];
  const radSection = idxRad >= 0 ? lines.slice(idxRad, idxBank > idxRad ? idxBank : lines.length) : [];
  const bankSection = idxBank >= 0 ? lines.slice(idxBank) : [];

  const pickProducts = (section: string[]) => {
    const out: CambiumProduct[] = [];
    for (const l of section) {
      const m = l.match(/^\s*-\s*(.+?)\s*-\s*imagen\s*:\s*(https?:\/\/\S+)\s*$/i);
      if (m) {
        out.push({ name: String(m[1]).trim(), imageUrl: String(m[2]).trim() });
        continue;
      }
      const m2 = l.match(/^\s*-\s*(.+?)\s*-\s*imagen\s*:\s*(https?:\/\/\S+)\s*$/i);
      if (m2) out.push({ name: String(m2[1]).trim(), imageUrl: String(m2[2]).trim() });
    }
    const seen = new Set<string>();
    return out.filter((p) => {
      const k = normalizeText(p.name);
      if (!k) return false;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const conProducts = pickProducts(conSection);
  const radProducts = pickProducts(radSection);
  const bankText = bankSection.join("\n").trim();

  const conDetail =
    conSection
      .find((l) => normalizeText(l).startsWith("1.-conectividad empresarial"))
      ?.split(":")
      .slice(1)
      .join(":")
      .trim() || "";

  const radDetail =
    radSection
      .find((l) => normalizeText(l).startsWith("2.-radioenlaces"))
      ?.split(":")
      .slice(1)
      .join(":")
      .trim() || "";

  return {
    intro,
    bankText,
    categories: [
      { key: "conectividad" as const, title: "Conectividad empresarial", detail: conDetail, products: conProducts },
      { key: "radioenlaces" as const, title: "Radioenlaces", detail: radDetail, products: radProducts },
    ],
  };
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

async function minimaxServicioTecnicoAnswer(args: { input: string; knowledge: Array<{ tema: string; info: string }> }) {
  const input = (args.input || "").trim();
  const knowledge = args.knowledge ?? [];

  const fallback = () => {
    if (knowledge.length) {
      const blocks = knowledge
        .slice(0, 2)
        .map((k) => [`*${k.tema}*`, k.info].filter(Boolean).join("\n"))
        .join("\n\n");
      return blocks.trim() ? blocks : "Ya. ¿Me cuentas un poquito más para ayudarte bien?";
    }
    return [
      "🔧 Te ayudo feliz. Para cachar bien:",
      "1) ¿Qué equipo/modelo es?",
      "2) ¿Qué está pasando exactamente y desde cuándo?",
      "",
      "Si el equipo se calienta mucho, huele a quemado o la batería está hinchada, mejor deja de usarlo y te derivamos.",
    ].join("\n");
  };

  const key = getMinimaxApiKey();
  if (!key) return fallback();

  const baseUrl = getMinimaxBaseUrl();
  const system = [
    "Eres un asesor humano de soporte técnico para una empresa de radiocomunicación.",
    "Hablas en español chileno, tono cordial, profesional y cercano.",
    "Entrega una respuesta útil y concreta.",
    "Puedes dar orientación técnica general (por ejemplo: conceptos como IP, temperatura, golpes, buenas prácticas).",
    "No afirmes características específicas de un modelo si no están en la base de conocimiento.",
    "No inventes datos de la empresa ni procedimientos internos.",
    "Si falta información, haz 1–2 preguntas para poder afinar la recomendación.",
    "Nunca menciones que eres una IA.",
    "Nunca uses etiquetas como <think> ni expliques tu razonamiento.",
    "Entrega solo el mensaje final listo para WhatsApp, sin encabezados ni meta-explicaciones.",
  ].join(" ");

  const knowledgeLines =
    knowledge.length > 0
      ? knowledge.map((k) => `- ${k.tema}: ${k.info}`).join("\n")
      : "- (Sin coincidencias exactas en la base para esta consulta)";

  const user = [
    `Mensaje del cliente: ${input}`,
    "",
    "Base de conocimiento (servicio_tecnico):",
    knowledgeLines,
    "",
    "Responde con una recomendación/ayuda en un único mensaje.",
  ].join("\n");

  try {
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
          { role: "user", content: user },
        ],
        temperature: 0.4,
        max_tokens: 380,
      }),
    });
    if (!res.ok) return fallback();
    const data = (await res.json()) as unknown;
    const choices = isRecord(data) ? getRecordValue(data, "choices") : undefined;
    const first = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
    const message = isRecord(first) ? getRecordValue(first, "message") : undefined;
    const content = isRecord(message) ? getRecordValue(message, "content") : undefined;
    if (typeof content === "string" && content.trim()) {
      const cleaned = sanitizeMinimaxOutput(content);
      if (cleaned) return cleaned;
    }
    return fallback();
  } catch {
    return fallback();
  }
}

async function minimaxAnswerFromKnowledge(args: { role: "proyectos" | "cambium"; input: string; knowledgeText: string }) {
  const input = (args.input || "").trim();
  const knowledgeText = (args.knowledgeText || "").trim();
  if (!input) return "";

  const key = getMinimaxApiKey();
  if (!key || !knowledgeText) return "";

  const baseUrl = getMinimaxBaseUrl();
  const systemBase = [
    "Eres un asesor humano para una empresa de telecomunicaciones y radiocomunicación.",
    "Hablas en español, tono cordial, profesional y cercano.",
    "Sé breve, claro y sin redundancias.",
    "No inventes datos: si no está en la base, dilo y pide un dato.",
    "Nunca menciones que eres una IA.",
    "Nunca uses etiquetas como <think> ni expliques tu razonamiento.",
    "Entrega solo el mensaje final listo para WhatsApp, sin encabezados ni meta-explicaciones.",
  ];
  const systemExtra =
    args.role === "proyectos"
      ? ["Enfócate en explicar proyectos, capacidades, certificaciones y enfoque de trabajo."]
      : ["Enfócate en explicar Cambium Networks, sus soluciones y orientar la elección de categoría/producto."];
  const system = [...systemBase, ...systemExtra].join(" ");

  const user = [
    `Mensaje del cliente: ${input}`,
    "",
    "Base de conocimiento:",
    knowledgeText.length > 5000 ? `${knowledgeText.slice(0, 5000).trim()}...` : knowledgeText,
    "",
    "Responde con una orientación útil y concreta en un único mensaje.",
  ].join("\n");

  try {
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
          { role: "user", content: user },
        ],
        temperature: 0.4,
        max_tokens: 350,
      }),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as unknown;
    const choices = isRecord(data) ? getRecordValue(data, "choices") : undefined;
    const first = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
    const message = isRecord(first) ? getRecordValue(first, "message") : undefined;
    const content = isRecord(message) ? getRecordValue(message, "content") : undefined;
    if (typeof content === "string" && content.trim()) {
      const cleaned = sanitizeMinimaxOutput(content);
      return cleaned || "";
    }
    return "";
  } catch {
    return "";
  }
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
    recentInboundHashes: [],
    catalog: { filters: {}, status: "idle" },
    projects: { offset: 0 },
    points: {},
    cambium: {},
  };
}

function resetBranchState(state: UserState, branch: Branch) {
  if (branch === "catalogo") {
    const forceAskAll = state.catalog.forceAskAll;
    state.catalog = { filters: {}, status: "idle", ...(forceAskAll ? { forceAskAll } : {}) };
  }
  if (branch === "proyectos") state.projects = { offset: 0 };
  if (branch === "puntos_venta") state.points = {};
  if (branch === "cambium") state.cambium = {};
}

function returnToCasualState(state: UserState) {
  state.activeBranch = "menu";
  resetBranchState(state, "catalogo");
  resetBranchState(state, "proyectos");
  resetBranchState(state, "puntos_venta");
  resetBranchState(state, "cambium");
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
  const queryLimit = filters.tecnologia ? 40 : 10;
  const params: string[] = [
    `select=product_id,nombre,tecnologia,frecuencia`,
    `tipo_producto=eq.${encodeURIComponent(filters.tipo_producto)}`,
    `limit=${queryLimit}`,
    `order=nombre.asc`,
  ];
  if (filters.modalidad) params.push(`modalidad=eq.${encodeURIComponent(filters.modalidad)}`);
  if (filters.portabilidad) params.push(`portabilidad=eq.${encodeURIComponent(filters.portabilidad)}`);
  if (filters.frecuencia) params.push(`frecuencia=ilike.*${encodeURIComponent(filters.frecuencia)}*`);
  const q = `inter_products?${params.join("&")}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[])
    .map((r) => ({
      product_id: toTrimmedString(getRecordValue(r, "product_id")),
      nombre: toTrimmedString(getRecordValue(r, "nombre")),
      tecnologia: toTrimmedString(getRecordValue(r, "tecnologia")),
    }))
    .filter((r) => r.product_id && r.nombre)
    .filter((r) => matchesSelectedTechnology(r.tecnologia, filters.tecnologia))
    .map((r) => ({ product_id: r.product_id, nombre: r.nombre }))
    .slice(0, 5)
    .filter((r) => r.product_id && r.nombre);
}

async function queryProductsUY(filters: CatalogFilters): Promise<Array<{ product_id: string; nombre: string }>> {
  if (!filters.tipo_producto) return [];
  const table = getUyProductsTable();
  const queryLimit = filters.tecnologia ? 40 : 10;
  const params: string[] = [
    `select=product_id,nombre,tecnologia,frecuencia`,
    `tipo_producto=eq.${encodeURIComponent(filters.tipo_producto)}`,
    `limit=${queryLimit}`,
    `order=nombre.asc`,
  ];
  if (filters.modalidad) params.push(`modalidad=eq.${encodeURIComponent(filters.modalidad)}`);
  if (filters.portabilidad) params.push(`portabilidad=eq.${encodeURIComponent(filters.portabilidad)}`);
  if (filters.frecuencia) params.push(`frecuencia=ilike.*${encodeURIComponent(filters.frecuencia)}*`);
  const q = `${table}?${params.join("&")}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[])
    .map((r) => ({
      product_id: toTrimmedString(getRecordValue(r, "product_id")),
      nombre: toTrimmedString(getRecordValue(r, "nombre")),
      tecnologia: toTrimmedString(getRecordValue(r, "tecnologia")),
    }))
    .filter((r) => r.product_id && r.nombre)
    .filter((r) => matchesSelectedTechnology(r.tecnologia, filters.tecnologia))
    .map((r) => ({ product_id: r.product_id, nombre: r.nombre }))
    .slice(0, 5)
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
  const descPlano = htmlToParagraphText(`${descCorta}\n${desc}`);
  const shortText = descCorta.trim() ? htmlToParagraphText(descCorta).slice(0, 600).trim() : descPlano.slice(0, 600).trim();
  const shortFinal = shortText.length >= 590 ? `${shortText.slice(0, 590).trim()}...` : shortText;

  return { productId, nombre, shortFinal, imageUrl, fichaUrl, precio };
}

function getUyProductsTable() {
  return (process.env.UY_PRODUCTS_TABLE ?? "inter_products_uy").trim() || "inter_products_uy";
}

async function listDistinctUyColumn(column: keyof CatalogFilters, filters: CatalogFilters) {
  const table = getUyProductsTable();
  const params: string[] = [`select=${encodeURIComponent(String(column))}`, `${String(column)}=not.is.null`, `limit=1000`];
  if (filters.tipo_producto && column !== "tipo_producto") params.push(`tipo_producto=eq.${encodeURIComponent(filters.tipo_producto)}`);
  if (filters.tecnologia && column !== "tecnologia") params.push(`tecnologia=eq.${encodeURIComponent(filters.tecnologia)}`);
  if (filters.modalidad && column !== "modalidad") params.push(`modalidad=eq.${encodeURIComponent(filters.modalidad)}`);
  if (filters.portabilidad && column !== "portabilidad") params.push(`portabilidad=eq.${encodeURIComponent(filters.portabilidad)}`);
  if (filters.frecuencia && column !== "frecuencia") params.push(`frecuencia=eq.${encodeURIComponent(filters.frecuencia)}`);
  const q = `${table}?${params.join("&")}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  const values = (res.data as unknown[])
    .map((r) => toTrimmedString(getRecordValue(r, String(column))))
    .filter(Boolean);
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "es"));
}

async function listDistinctTipoProductoUY(): Promise<string[]> {
  return await listDistinctUyColumn("tipo_producto", {});
}

async function listTecnologiasUY(filters: CatalogFilters): Promise<string[]> {
  if (!filters.tipo_producto) return [];
  return await listDistinctUyColumn("tecnologia", filters);
}

async function listModalidadesUY(filters: CatalogFilters): Promise<string[]> {
  if (!filters.tipo_producto) return [];
  return await listDistinctUyColumn("modalidad", filters);
}

async function listPortabilidadesUY(filters: CatalogFilters): Promise<string[]> {
  if (!filters.tipo_producto) return [];
  return await listDistinctUyColumn("portabilidad", filters);
}

async function listFrecuenciasUY(filters: CatalogFilters): Promise<string[]> {
  if (!filters.tipo_producto) return [];
  return await listDistinctUyColumn("frecuencia", filters);
}

async function loadProductDetailUY(productId: string) {
  const table = getUyProductsTable();
  const q = `${table}?select=product_id,nombre,descripcion_corta,descripcion,image_url,precio&limit=1&product_id=eq.${encodeURIComponent(productId)}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return null;
  const row = (res.data as unknown[])[0];
  if (!row) return null;
  const nombre = toTrimmedString(getRecordValue(row, "nombre"));
  const descCorta = toTrimmedString(getRecordValue(row, "descripcion_corta"));
  const desc = toTrimmedString(getRecordValue(row, "descripcion"));
  const imageUrl = toTrimmedString(getRecordValue(row, "image_url"));
  const precio = toTrimmedString(getRecordValue(row, "precio"));
  const fichaUrl = extractFichaTecnicaUrl(`${descCorta}\n${desc}`);
  const descPlano = htmlToParagraphText(`${descCorta}\n${desc}`);
  const shortText = descCorta.trim() ? htmlToParagraphText(descCorta).slice(0, 600).trim() : descPlano.slice(0, 600).trim();
  const shortFinal = shortText.length >= 590 ? `${shortText.slice(0, 590).trim()}...` : shortText;
  return { productId, nombre, shortFinal, imageUrl, fichaUrl, precio };
}

async function loadProductDetailByCountry(country: Country, productId: string): Promise<ProductDetail | null> {
  if (!productId) return null;
  if (country === "UY") return (await loadProductDetailUY(productId)) as ProductDetail | null;
  return (await loadProductDetail(productId)) as ProductDetail | null;
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

function normalizeUserKeyFrom(from: string) {
  const raw = String(from ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d]/g, "");
  return digits || raw;
}

async function saveCotizacionToSupabase(userPhone: string, state: UserState) {
  const quote = state.catalog.quote?.data ?? {};
  const country = state.country ?? "CL";
  const selectedProductId = state.catalog.selectedProductId ?? "";
  const productDetail = selectedProductId ? await loadProductDetailByCountry(country, selectedProductId) : null;
  const isRentalFlow = isRentalRequest(state);
  const origen =
    country === "UY"
      ? "uy_catalogo"
      : isRentalFlow
        ? selectedProductId
          ? "cl_arriendo_producto"
          : "cl_arriendo_directo"
        : "cl_cotizacion_producto";

  const included = state.catalog.recommended?.includedIds ?? [];
  const rejected = state.catalog.recommended?.rejectedIds ?? [];
  const remaining = state.catalog.recommended?.remainingIds ?? [];
  const offered = Array.from(new Set([...included, ...rejected, ...remaining])).filter(Boolean);

  const row = {
    user_phone: userPhone,
    country,
    origen,
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

function getUyLeadsTable() {
  return (process.env.UY_LEADS_TABLE ?? "uy_leads").trim() || "uy_leads";
}

async function saveUyLead(payload: Record<string, unknown>) {
  const table = getUyLeadsTable();
  const res = await supabaseFetch(table, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    inboxAdd({
      source: "gowa",
      signatureValid: null,
      from: String(payload.user_phone ?? ""),
      text: `[DEBUG] uy_lead insert failed status=${res.status}`,
      body: res.data,
    });
  }
}

async function loadUserProfile(userPhone: string) {
  const raw = String(userPhone ?? "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  const candidates = Array.from(
    new Set(
      [
        raw,
        digits,
        digits ? `+${digits}` : "",
        digits ? `${digits}@s.whatsapp.net` : "",
        digits ? `${digits}@c.us` : "",
      ].filter(Boolean),
    ),
  ).slice(0, 5);
  const or = candidates.length
    ? `&or=(${candidates.map((c) => `user_phone.eq.${encodeURIComponent(c)}`).join(",")})`
    : `&user_phone=eq.${encodeURIComponent(raw)}`;
  const q = `users?select=nombre,telefono,email,empresa,direccion,ciudad,region${or}&limit=1`;
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

function getCatalogQuoteStep(state: UserState, data: CatalogQuote["data"]): CatalogQuoteStep {
  const rental = isRentalRequest(state);
  if (rental) {
    const requiredComplete = Boolean(data.nombre && data.telefono && data.email);
    if (requiredComplete) return "final";
    if (!state.catalog.optionalCompanyHandled && !data.empresa) return "empresa";
    if (!data.nombre) return "nombre";
    if (!data.telefono) return "telefono";
    if (!data.email) return "email";
    return "final";
  }
  if (!data.nombre) return "nombre";
  if (!data.telefono) return "telefono";
  if (!data.email) return "email";
  if (!data.empresa) return "empresa";
  if (!data.ciudad || !data.region) return "ciudad_region";
  return "final";
}

function getRentalPromptForStep(step: CatalogQuoteStep, country: Country) {
  if (step === "empresa") return "Nombre de empresa (opcional). Si prefieres omitirlo, escribe: Omitir";
  if (step === "nombre") return "Perfecto. Ahora indícame tu nombre completo.";
  if (step === "telefono") return country === "UY" ? "Ahora indícame tu teléfono. Ej: +598 9 123 4567" : "Ahora indícame tu número de teléfono. Ej: +569 1234 5678";
  if (step === "email") {
    return country === "UY"
      ? "¿Cuál es tu correo electrónico? (Ej: nombre@empresa.com)"
      : "¿Cuál es tu correo electrónico? (Ej: nombre@empresa.cl)";
  }
  return "";
}

async function startDirectRentalForm(state: UserState, userPhone: string, intent: CatalogArriendoIntent) {
  state.catalog.requestKind = "arriendo";
  state.catalog.arriendoStage = undefined;
  state.catalog.arriendoIntent = intent;
  state.catalog.filters.modalidad = "Arriendo";
  state.catalog.pending = undefined;
  state.catalog.lastList = undefined;
  state.catalog.selectedProductId = undefined;
  state.catalog.reviewMode = undefined;
  state.catalog.reviewEditField = undefined;

  const profile = state.catalog.forceAskAll ? null : await loadUserProfile(userPhone);
  const prefill: CatalogQuote["data"] = profile ? { ...profile } : {};
  state.catalog.forceAskAll = undefined;
  state.catalog.optionalCompanyHandled = Boolean(prefill.empresa);
  const next = getCatalogQuoteStep(state, prefill);
  state.catalog.quote = { step: next, data: prefill };

  if (next === "final") {
    state.catalog.reviewMode = "arriendo";
    return await buildArriendoProfileReviewMessage(state);
  }

  const intro =
    intent === "mas_informacion"
      ? "Perfecto. Te ayudo con más información sobre arriendo."
      : "Perfecto. Te ayudo con la cotización de arriendo.";
  const prompt = getRentalPromptForStep(next, state.country ?? "CL");
  return [intro, "", prompt].filter(Boolean).join("\n");
}

async function startCatalogQuoteForm(
  state: UserState,
  userPhone: string,
  country: Country,
  options?: { intro?: string },
): Promise<Reply> {
  const profile = state.catalog.forceAskAll ? null : await loadUserProfile(userPhone);
  const prefill: CatalogQuote["data"] = profile ? { ...profile } : {};
  const isRentalFlow = isRentalRequest(state);

  state.catalog.forceAskAll = undefined;
  state.catalog.optionalCompanyHandled = Boolean(prefill.empresa);
  state.catalog.reviewMode = undefined;
  state.catalog.reviewEditField = undefined;

  const next = getCatalogQuoteStep(state, prefill);
  state.catalog.quote = { step: next, data: prefill };

  if (isRentalFlow && profile && next === "final") {
    state.catalog.reviewMode = "arriendo";
    return await buildArriendoProfileReviewMessage(state);
  }
  if (!isRentalFlow && profile && next === "final") {
    state.catalog.reviewMode = "cotizacion";
    return await buildCotizacionProfileReviewMessage(state);
  }
  if (next === "final") {
    return await completeCatalogQuote(state, userPhone, options?.intro ?? "");
  }

  const prompt = isRentalFlow
    ? getRentalPromptForStep(next, country)
    : next === "telefono"
      ? country === "UY"
        ? "Perfecto. Ahora indícame tu teléfono. Ej: +598 9 123 4567"
        : "Perfecto. Ahora indícame tu teléfono. Ej: +569 1234 5678"
      : next === "email"
        ? country === "UY"
          ? "¿Cuál es tu correo electrónico empresarial o personal? (Ej: nombre@empresa.com)"
          : "¿Cuál es tu correo electrónico empresarial o personal? (Ej: nombre@empresa.cl)"
        : next === "empresa"
          ? "¿Para qué empresa es la cotización? Si es para ti, escribe: Particular"
          : next === "ciudad_region"
            ? country === "UY"
              ? "Por último, indícame la Ciudad y Región. Ej: Montevideo, Montevideo"
              : "Por último, indícame la Ciudad y Región. Ej: Santiago, Región Metropolitana"
            : "Perfecto. Para generar tu cotización, por favor indícame tu nombre y apellido.";

  const intro =
    options?.intro ??
    (isRentalFlow
      ? "Perfecto. Avancemos con la cotización de arriendo para revisar disponibilidad y tiempos."
      : "Perfecto. Avancemos con la cotización para revisar stock y tiempos de entrega.");

  return [intro, "", prompt].filter(Boolean).join("\n");
}

function detectQuoteFieldToEdit(text: string): Exclude<CatalogQuoteStep, "final"> | null {
  const t = normalizeText(text);
  if (!t) return null;
  if (t.includes("telefono") || t.includes("teléfono") || t.includes("celular") || t.includes("fono")) return "telefono";
  if (t.includes("correo") || t.includes("email") || t.includes("mail")) return "email";
  if (t.includes("empresa")) return "empresa";
  if (t.includes("ciudad") || t.includes("region") || t.includes("región")) return "ciudad_region";
  if (t.includes("nombre") || t.includes("apellido")) return "nombre";
  return null;
}

function getQuoteFieldPrompt(field: Exclude<CatalogQuoteStep, "final">, country: Country) {
  if (field === "nombre") return "Perfecto. Para continuar, indícame tu nombre y apellido.";
  if (field === "telefono") return country === "UY" ? "Indícame tu teléfono. Ej: +598 9 123 4567" : "Indícame tu teléfono. Ej: +569 1234 5678";
  if (field === "email")
    return country === "UY"
      ? "¿Cuál es tu correo electrónico empresarial o personal? (Ej: nombre@empresa.com)"
      : "¿Cuál es tu correo electrónico empresarial o personal? (Ej: nombre@empresa.cl)";
  if (field === "empresa") return "¿Para qué empresa es la cotización? Si es para ti, escribe: Particular";
  return country === "UY"
    ? "Por último, indícame la Ciudad y Región. Ej: Montevideo, Montevideo"
    : "Por último, indícame la Ciudad y Región. Ej: Santiago, Región Metropolitana";
}

function applyQuoteFieldValue(q: CatalogQuote, field: Exclude<CatalogQuoteStep, "final">, input: string, country: Country) {
  if (field === "nombre") {
    if (input.trim().length < 3) return "Necesito tu nombre y apellido para continuar.";
    q.data.nombre = input.trim();
    return null;
  }
  if (field === "telefono") {
    const phone = normalizePhone(input);
    const minDigits = country === "UY" ? 7 : 8;
    if (phone.replace(/[^\d]/g, "").length < minDigits) {
      return country === "UY"
        ? "Disculpa, necesito el número completo para que el ejecutivo te contacte. Por favor, escríbelo con este formato EJ: +598 9 123 4567."
        : "Disculpa, necesito el número completo para que el ejecutivo te contacte. Por favor, escríbelo con este formato EJ: +569 1234 5678.";
    }
    q.data.telefono = phone;
    return null;
  }
  if (field === "email") {
    if (!validateEmail(input)) {
      return country === "UY"
        ? "Necesito un correo válido para enviarte la cotización. ¿Me lo compartes? (Ej: nombre@empresa.com)"
        : "Necesito un correo válido para enviarte la cotización. ¿Me lo compartes? (Ej: nombre@empresa.cl)";
    }
    q.data.email = input.trim();
    return null;
  }
  if (field === "empresa") {
    const t = normalizeText(input);
    if (!input.trim()) return "Nombre de empresa (opcional). Si prefieres omitirlo, escribe: Omitir";
    if (t === "omitir" || t === "omit" || t === "sin empresa" || t === "no tengo empresa" || t === "particular") {
      q.data.empresa = undefined;
      return null;
    }
    if (input.trim().length < 2) return "Nombre de empresa (opcional). Si prefieres omitirlo, escribe: Omitir";
    q.data.empresa = input.trim();
    return null;
  }
  const parsed = parseCityRegionInput(input);
  if (!parsed) {
    return country === "UY"
      ? "Para cerrar la cotización necesito ambos datos. Escríbeme la Ciudad y Región en este formato: Montevideo, Montevideo"
      : "Para cerrar la cotización necesito ambos datos. Escríbeme la Ciudad y Región en este formato: Santiago, Región Metropolitana";
  }
  q.data.ciudad = parsed.ciudad;
  q.data.region = parsed.region;
  return null;
}

async function buildArriendoProfileReviewMessage(state: UserState) {
  const q = state.catalog.quote?.data ?? {};
  const country = state.country ?? "CL";
  const detail = await loadProductDetailByCountry(country, state.catalog.selectedProductId ?? "");
  const lines = [
    "Perfecto. Este es el resumen de tu solicitud:",
    "",
    "*Solicitud*",
    "- Tipo: Arriendo",
    "",
    "*Datos de contacto*",
    q.nombre ? `- Nombre y Apellido: ${q.nombre}` : "",
    q.telefono ? `- Teléfono: ${q.telefono}` : "",
    q.email ? `- Correo electrónico: ${q.email}` : "",
    "",
    "*Empresa*",
    q.empresa ? `- Empresa: ${q.empresa}` : "- Empresa: Particular / No informada",
    "",
    "*Equipo solicitado*",
    detail?.nombre ? `- Equipo: ${cleanProductName(detail.nombre)}` : "- Equipo: No informado",
    "",
    "Si está todo correcto, escribe: Confirmar solicitud",
    "Si quieres editar algo, puedes decir por ejemplo: cambiar teléfono",
  ].filter(Boolean);
  return lines.join("\n");
}

async function buildCotizacionProfileReviewMessage(state: UserState) {
  const q = state.catalog.quote?.data ?? {};
  const country = state.country ?? "CL";
  const detail = await loadProductDetailByCountry(country, state.catalog.selectedProductId ?? "");
  const ubicacion = [q.ciudad, q.region].filter(Boolean).join(", ");
  const lines = [
    "Perfecto. Este es el resumen de tu solicitud:",
    "",
    "*Solicitud*",
    "- Tipo: Cotización",
    "",
    "*Datos de contacto*",
    q.nombre ? `- Nombre y Apellido: ${q.nombre}` : "",
    q.telefono ? `- Teléfono: ${q.telefono}` : "",
    q.email ? `- Correo electrónico: ${q.email}` : "",
    "",
    "*Empresa*",
    q.empresa ? `- Empresa: ${q.empresa}` : "- Empresa: Particular / No informada",
    "",
    "*Ubicación*",
    ubicacion ? `- Ciudad y Región: ${ubicacion}` : "- Ciudad y Región: No informadas",
    "",
    "*Producto solicitado*",
    detail?.nombre ? `- Producto: ${cleanProductName(detail.nombre)}` : "- Producto: No informado",
    "",
    "Si está todo correcto, escribe: Confirmar cotización",
    "Si quieres editar algo, puedes decir por ejemplo: cambiar teléfono",
  ].filter(Boolean);
  return lines.join("\n");
}

async function completeCatalogQuote(state: UserState, userPhone: string, input: string): Promise<Reply> {
  const q = state.catalog.quote;
  if (!q) return "No veo una cotización activa en este momento.";
  state.catalog.status = "wait_finish_cotizacion";
  state.catalog.quote = q;
  state.catalog.reviewMode = undefined;
  state.catalog.reviewEditField = undefined;
  if (q.data.nombre) {
    state.userName = q.data.nombre.split(" ")[0]?.trim() || state.userName;
  }
  await upsertUserProfile(userPhone, q.data);
  const country = state.country ?? "CL";
  const isRentalFlow = isRentalRequest(state);
  if (country !== "UY" && !isRentalFlow) {
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
  }
  return await finalizeCotizacion(state, userPhone);
}

function getNextQuoteStep(data: CatalogQuote["data"]): CatalogQuoteStep {
  if (!data.nombre) return "nombre";
  if (!data.telefono) return "telefono";
  if (!data.email) return "email";
  if (!data.empresa) return "empresa";
  if (!data.ciudad || !data.region) return "ciudad_region";
  return "final";
}

async function buildCotizacionResumen(state: UserState) {
  const q = state.catalog.quote?.data ?? {};
  const country = state.country ?? "CL";
  const selectedProductId = state.catalog.selectedProductId ?? "";
  const productDetail = selectedProductId ? await loadProductDetailByCountry(country, selectedProductId) : null;

  const included = state.catalog.recommended?.includedIds ?? [];
  const includedNames: string[] = [];
  if (country !== "UY") {
    for (const id of included.slice(0, 5)) {
      const d = await loadProductDetailByCountry(country, id);
      if (d?.nombre) includedNames.push(cleanProductName(d.nombre));
    }
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
  lines.push("✅ Ya recibimos tu solicitud.");
  return lines.join("\n");
}

function buildAfterCotizacionMessage(country: Country) {
  return [
    "Uno de nuestros vendedores se pondrá en contacto contigo.",
    "",
    buildMainMenuText(country, "return"),
  ].join("\n");
}

async function finalizeCotizacion(state: UserState, userPhone: string): Promise<Reply> {
  const isRentalFlow = isRentalRequest(state);
  await saveCotizacionToSupabase(userPhone, state);
  if (state.catalog.quote?.data) {
    await upsertUserProfile(userPhone, state.catalog.quote.data);
  }
  if (isRentalFlow) {
    const forceAskAll = state.catalog.forceAskAll;
    state.catalog = { filters: {}, status: "idle", ...(forceAskAll ? { forceAskAll } : {}) };
    state.activeBranch = "menu";
    state.postCotizacion = undefined;
    markMenuShown(state);
    return ["Gracias por cotizar con nosotros. Pronto nos pondremos en contacto. 📻✨", "", buildMainMenuText(state.country ?? "CL", "return")].join("\n");
  }
  const resumen = await buildCotizacionResumen(state);
  const forceAskAll = state.catalog.forceAskAll;
  state.catalog = { filters: {}, status: "idle", ...(forceAskAll ? { forceAskAll } : {}) };
  state.activeBranch = "menu";
  state.postCotizacion = { awaitingAction: true };
  markMenuShown(state);
  return [resumen, buildAfterCotizacionMessage(state.country ?? "CL")];
}

async function handleCatalog(state: UserState, text: string, userPhone: string): Promise<Reply> {
  const input = text.trim();
  const t = normalizeText(input);
  let selectedPendingOption: CatalogPendingOption | null = null;
  const rentalRequest = isRentalRequest(state);

  if (state.catalog.status === "wait_finish_cotizacion") {
    if (t.includes("cancel")) {
      state.catalog = { filters: {}, status: "idle" };
      state.activeBranch = "menu";
      const msg = await minimaxRewrite({
        kind: "empatia",
        input,
        facts: ["Ok, dejé la cotización cancelada."],
      });
      return withMainMenu(msg, state, state.country ?? "CL");
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
      return [`Estos son los productos recomendados:`, "", lines, "", "Indícame qué opción quieres ver (número o nombre) o responde Terminar."].join("\n");
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
        if (!d) return "No pude cargar ese recomendado. Indícame otra opción o responde Terminar.";
        const base = buildProductFichaMessages(d, { requestKind: state.catalog.requestKind });
        return [
          ...base,
          "",
          "Responde: Incluir / Rechazar / Terminar",
        ].filter((x) => (typeof x === "string" ? x.trim() : true));
      }
      if (t.includes("termin")) {
        return await finalizeCotizacion(state, userPhone);
      }
      return "Indícame qué opción quieres ver, o responde Terminar.";
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
    const keepRental = rentalRequest;
    state.catalog = {
      filters: { modalidad: keepRental ? "Arriendo" : "Venta" },
      status: "idle",
      ...(keepRental ? { requestKind: "arriendo" as CatalogRequestKind, arriendoStage: "product_menu" as CatalogArriendoStage } : {}),
    };
    return keepRental
      ? buildArriendoLandingMessage()
      : buildCotizarProductMenuMessage([
          { label: "📻 Equipos Radio", value: "equipos-radio" },
          { label: "🎧 Accesorios", value: "accesorios" },
          { label: "📷 Cámaras Corporales", value: "camaras-corporales" },
        ]);
  }

  if (state.catalog.arriendoStage === "landing") {
    state.catalog.arriendoStage = "product_menu";
    return buildArriendoLandingMessage();
  }

  if (state.catalog.arriendoStage === "direct_topic") {
    const choice = parseArriendoIntentChoice(input);
    if (choice) {
      return await startDirectRentalForm(state, userPhone, choice);
    }
    return "Cuéntame si quieres Cotizar Arriendo de Radios o prefieres Más Información.";
  }

  if (state.catalog.arriendoStage === "product_menu") {
    const choice = parseArriendoProductChoice(input);
    if (choice === "dealer_region") {
      return await startDirectRentalForm(state, userPhone, "mas_informacion");
    }
    if (choice) {
      const suggested = await getSuggestedCatalogTypes(state.country ?? "CL", "Arriendo");
      const selected = suggested.find((item) => item.key === choice);
      if (selected) {
        state.catalog.arriendoStage = undefined;
        state.catalog.filters.modalidad = "Arriendo";
        state.catalog.filters.tipo_producto = selected.tipo;
      } else {
        return "No encontré esa categoría de arriendo ahora mismo. Si quieres, elige otra opción o te pongo en contacto con un dealer de tu región.";
      }
    } else {
      return "Puedo ayudarte con equipos de radio, accesorio de radio, cámara corporal o contacto con un dealer de tu región.";
    }
  }

  if (state.catalog.quote) {
    const q = state.catalog.quote;
    if (t.includes("cancel")) {
      state.catalog.quote = undefined;
      state.catalog.status = "idle";
      state.catalog.reviewMode = undefined;
      state.catalog.reviewEditField = undefined;
      return "Ok, dejé la cotización cancelada. ¿Quieres seguir viendo productos o vuelvo al menú?";
    }

    if (state.catalog.reviewMode === "arriendo") {
      if (state.catalog.reviewEditField) {
        const error = applyQuoteFieldValue(q, state.catalog.reviewEditField, input, "CL");
        if (error) return error;
        state.catalog.reviewEditField = undefined;
        state.catalog.quote = q;
        await upsertUserProfile(userPhone, q.data);
        return await buildArriendoProfileReviewMessage(state);
      }

      const confirmArriendo =
        t.includes("confirmar arriendo") ||
        t.includes("confirmar el arriendo") ||
        t.includes("confirmar solicitud") ||
        t.includes("confirmar la solicitud") ||
        t === "confirmar" ||
        t === "confirmo" ||
        t.includes("confirmo") ||
        t.includes("esta bien") ||
        t.includes("está bien") ||
        t.includes("correcto") ||
        t.includes("dale");
      const fieldToEdit = detectQuoteFieldToEdit(input);

      if (confirmArriendo) {
        return await completeCatalogQuote(state, userPhone, input);
      }
      if (fieldToEdit) {
        if (fieldToEdit === "ciudad_region") {
          return "Para arriendo no necesito ciudad y región. Si está todo bien, escribe Confirmar solicitud.";
        }
        state.catalog.reviewEditField = fieldToEdit;
        return fieldToEdit === "empresa" ? getRentalPromptForStep("empresa", "CL") : getRentalPromptForStep(fieldToEdit, "CL");
      }
      if (isStockQuestion(input)) {
        return "Para confirmar stock inmediato y tiempos de entrega del arriendo, avancemos con la cotización y un ejecutivo te validará el inventario en minutos.";
      }
      return "Si está todo correcto, escribe Confirmar solicitud. Si quieres cambiar algo, dime por ejemplo: cambiar teléfono.";
    }

    if (state.catalog.reviewMode === "cotizacion") {
      if (state.catalog.reviewEditField) {
        const error = applyQuoteFieldValue(q, state.catalog.reviewEditField, input, "CL");
        if (error) return error;
        state.catalog.reviewEditField = undefined;
        state.catalog.quote = q;
        await upsertUserProfile(userPhone, q.data);
        return await buildCotizacionProfileReviewMessage(state);
      }

      const confirmCotizacion =
        t.includes("confirmar cotizacion") ||
        t.includes("confirmar cotización") ||
        t === "confirmar" ||
        t.includes("esta bien") ||
        t.includes("está bien") ||
        t.includes("correcto") ||
        t.includes("dale");
      const fieldToEdit = detectQuoteFieldToEdit(input);

      if (confirmCotizacion) {
        return await completeCatalogQuote(state, userPhone, input);
      }
      if (fieldToEdit) {
        state.catalog.reviewEditField = fieldToEdit;
        return getQuoteFieldPrompt(fieldToEdit, "CL");
      }
      return "Si está todo correcto, escribe Confirmar cotización. Si quieres cambiar algo, dime por ejemplo: cambiar teléfono.";
    }

    const setAndNext = (key: keyof CatalogQuote["data"], value: string, next: CatalogQuoteStep) => {
      q.data[key] = value;
      q.step = next;
    };

    if (rentalRequest && q.step === "empresa") {
      const omit = !input || t === "omitir" || t === "omit" || t === "sin empresa" || t === "no tengo empresa" || t === "particular";
      if (!omit && input.trim().length >= 2) {
        q.data.empresa = input.trim();
      } else if (!omit) {
        return "Nombre de empresa (opcional). Si prefieres omitirlo, escribe: Omitir";
      }
      state.catalog.optionalCompanyHandled = true;
      q.step = !q.data.nombre ? "nombre" : !q.data.telefono ? "telefono" : !q.data.email ? "email" : "final";
      state.catalog.quote = q;
      if (q.step === "final") {
        await upsertUserProfile(userPhone, q.data);
        state.catalog.reviewMode = "arriendo";
        return await buildArriendoProfileReviewMessage(state);
      }
      return getRentalPromptForStep(q.step, "CL");
    }

    if (q.step === "nombre") {
      if (input.length < 3) return rentalRequest ? "Necesito tu nombre completo para continuar." : "Perfecto. Para generar tu cotización, por favor indícame tu nombre y apellido.";
      setAndNext("nombre", input, "telefono");
      state.userName = input.split(" ")[0]?.trim() || state.userName;
      return rentalRequest ? getRentalPromptForStep("telefono", "CL") : "Perfecto. Ahora indícame tu teléfono. Ej: +569 1234 5678";
    }
    if (q.step === "telefono") {
      const phone = normalizePhone(input);
      const digits = phone.replace(/[^\d]/g, "");
      if (digits.length < 8) {
        return "Disculpa, necesito el número completo para que el ejecutivo te contacte. Por favor, escríbelo con este formato EJ: +569 1234 5678.";
      }
      setAndNext("telefono", phone, "email");
      return rentalRequest ? getRentalPromptForStep("email", "CL") : "¿Cuál es tu correo electrónico empresarial o personal? (Ej: nombre@empresa.cl)";
    }
    if (q.step === "email") {
      if (!validateEmail(input)) return "Necesito un correo válido para enviarte la cotización. ¿Me lo compartes? (Ej: nombre@empresa.cl)";
      if (rentalRequest) {
        q.data.email = input.trim();
        q.step = "final";
        state.catalog.quote = q;
        await upsertUserProfile(userPhone, q.data);
        state.catalog.reviewMode = "arriendo";
        return await buildArriendoProfileReviewMessage(state);
      }
      setAndNext("email", input.trim(), "empresa");
      return "¿Para qué empresa es la cotización? Si es para ti, escribe: Particular";
    }
    if (q.step === "empresa") {
      if (input.length < 2) return "¿Para qué empresa es la cotización? Si es para ti, escribe: Particular";
      setAndNext("empresa", input, "ciudad_region");
      return "Por último, indícame la Ciudad y Región. Ej: Santiago, Región Metropolitana";
    }
    if (q.step === "ciudad_region") {
      const parsed = parseCityRegionInput(input);
      if (!parsed) {
        return "Para cerrar la cotización necesito ambos datos. Escríbeme la Ciudad y Región en este formato: Santiago, Región Metropolitana";
      }
      q.data.ciudad = parsed.ciudad;
      q.data.region = parsed.region;
      q.step = "final";
      state.catalog.quote = q;
      return await completeCatalogQuote(state, userPhone, input);
    }
  }

  if (state.catalog.pending) {
    const pending = state.catalog.pending;
    const n = isNumericChoice(t, pending.options.length);
    if (n) {
      selectedPendingOption = pending.options[n - 1]!;
      applyCatalogPendingSelection(state, pending, selectedPendingOption);
    } else {
      const match = matchPendingOption(input, pending.options);
      if (match.value) {
        const selected = pending.options.find((o) => o.value === match.value);
        if (!selected) return `Dale. Responde con un número (1–${pending.options.length}) o escríbeme la opción (como la ves en la lista).`;
        selectedPendingOption = selected;
        applyCatalogPendingSelection(state, pending, selected);
      } else {
        if (match.ambiguous) {
          return `Me quedaron 2 opciones parecidas. ¿Me respondes con el número (1–${pending.options.length}) para elegir bien?`;
        }
        return `Dale. Responde con un número (1–${pending.options.length}) o escríbeme la opción (como la ves en la lista).`;
      }
    }
  }

  if (selectedPendingOption?.skipRadioTechFrequency) {
    return await startCatalogQuoteForm(state, userPhone, "CL", {
      intro: "Perfecto. Si prefieres asesoría, avancemos con tu solicitud y un ejecutivo te ayudará a definir la mejor alternativa.",
    });
  }

  if (!state.catalog.filters.tipo_producto) {
    const tipos = await listDistinctTipoProducto();
    if (!tipos.length) return "¿Qué tipo de producto buscas? (Ej: Equipos Radio, Repetidores, Accesorios)";
    const candidates = tipos.filter((tp) => normalizeText(tp).includes(t) || t.includes(normalizeText(tp)));
    if (candidates.length === 1) {
      state.catalog.filters.tipo_producto = candidates[0];
      state.catalog.selectedProductId = undefined;
      state.catalog.lastList = undefined;
      state.catalog.filters.frecuencia = undefined;
      state.catalog.filters.tecnologia = undefined;
      state.catalog.filters.portabilidad = undefined;
      state.catalog.skipRadioTechFrequency = undefined;
    } else if (candidates.length > 1) {
      const top = candidates.slice(0, 5);
      state.catalog.pending = { attr: "tipo_producto", options: top.map((o) => ({ label: o, value: o })) };
      return ["¿Cuál de estos tipos de producto buscas?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    } else {
      const suggested = await getSuggestedCatalogTypes("CL", state.catalog.filters.modalidad);
      const top = suggested.length
        ? suggested.map((o) => ({ label: withCatalogTypeIcon(o.label), value: o.tipo }))
        : tipos.slice(0, 5).map((o) => ({ label: o, value: o }));
      state.catalog.pending = { attr: "tipo_producto", options: top };
      return buildCotizarProductMenuMessage(top);
    }
  }

  const isRadioEquipment = isRadioEquipmentTipoProducto(state.catalog.filters.tipo_producto);

  if (!isRadioEquipment && !state.catalog.filters.tecnologia) {
    const opts = await listTecnologias(state.catalog.filters);
    if (opts.length > 1) {
      const top = opts.slice(0, 5);
      state.catalog.pending = { attr: "tecnologia", options: top.map((o) => ({ label: o, value: o })) };
      return ["¿Qué tecnología prefieres?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    }
  }

  if (!state.catalog.filters.modalidad) {
    const opts = await listModalidades(state.catalog.filters);
    if (opts.length > 1) {
      const top = opts.slice(0, 5);
      state.catalog.pending = { attr: "modalidad", options: top.map((o) => ({ label: o, value: o })) };
      return ["¿Lo buscas para venta o arriendo?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    }
  }

  if (!state.catalog.filters.portabilidad) {
    const opts = isRadioEquipment ? await buildRadioSubtypeOptions("CL", state.catalog.filters) : await listPortabilidades(state.catalog.filters);
    if (opts.length > 1) {
      const options: CatalogPendingOption[] = isRadioEquipment
        ? (opts as CatalogPendingOption[]).slice(0, 5)
        : (opts as string[]).slice(0, 5).map((o) => ({ label: o, value: o }));
      state.catalog.pending = { attr: "portabilidad", options };
      return isRadioEquipment
        ? ["¿Qué formato necesitas?", "", ...state.catalog.pending.options.map((o) => o.label)].join("\n")
        : ["¿Portátil o móvil?", ...state.catalog.pending.options.map((o) => o.label)].join("\n");
    }
  }

  if (isRadioEquipment && !state.catalog.skipRadioTechFrequency && (!state.catalog.filters.frecuencia || !state.catalog.filters.tecnologia)) {
    const options = buildRadioFrequencyTechnologyOptions();
    state.catalog.pending = { attr: "frecuencia", options };
    return ["¿En qué frecuencia operan tus equipos actuales o cuál necesitas?", "", ...options.map((o, i) => `${i + 1}) ${o.label}`)].join("\n");
  }

  if (!isRadioEquipment && !state.catalog.filters.frecuencia) {
    const opts = await listFrecuencias(state.catalog.filters);
    if (opts.length > 1) {
      const top = opts.slice(0, 5);
      state.catalog.pending = { attr: "frecuencia", options: top.map((o) => ({ label: o, value: o })) };
      return ["¿Qué frecuencia te sirve?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    }
  }

  if (state.catalog.selectedProductId) {
    if (t.includes("cotiz") || t.includes("arrend")) {
      return await startCatalogQuoteForm(state, userPhone, "CL");
    }
    if (isMenuCommand(input)) {
      returnToCasualState(state);
      markMenuShown(state);
      return buildMainMenuText("CL", "return");
    }
    if (t === "volver a la lista" || (t.includes("volver") && t.includes("lista")) || t === "lista" || t.includes("ver lista") || t === "volver") {
      state.catalog.selectedProductId = undefined;
      if (state.catalog.lastList?.length) return buildProductsListMessage(state.catalog.lastList, "Motorola DP250");
      return "Perfecto. Indícame el número del producto que quieres ver o escribe Nueva búsqueda.";
    }
    if (isStockQuestion(input)) {
      return await startCatalogQuoteForm(state, userPhone, "CL", {
        intro: "Para confirmar stock inmediato y tiempos de entrega, avancemos con la cotización y un ejecutivo te validará el inventario en minutos.",
      });
    }
    if (t.includes("nueva busqueda") || t.includes("nueva búsqueda")) {
      const keepRental = normalizeText(state.catalog.filters.modalidad || "").includes("arriendo");
      state.catalog.selectedProductId = undefined;
      state.catalog.lastList = undefined;
      state.catalog.filters = { modalidad: keepRental ? "Arriendo" : "Venta" };
      state.catalog.pending = undefined;
      state.catalog.skipRadioTechFrequency = undefined;
      return keepRental
        ? "Perfecto. Hagamos una nueva búsqueda de arriendo. ¿Qué tipo de equipo necesitas?"
        : "Perfecto. Hagamos una nueva búsqueda. ¿Qué tipo de producto necesitas?";
    }
    if (t.includes("volver")) {
      state.catalog.selectedProductId = undefined;
    } else {
      return "Puedo ayudarte con eso. Si quieres validar stock y tiempos de entrega, lo mejor es avanzar con la cotización. También puedes volver al menú o hacer una nueva búsqueda.";
    }
  }

  if (state.catalog.lastList && state.catalog.lastList.length) {
    const max = state.catalog.lastList.length;
    const n = isNumericChoice(t, max) ?? extractChoiceNumberFromText(input, max);
    if (n) {
      const chosen = state.catalog.lastList[n - 1];
      state.catalog.selectedProductId = chosen.product_id;
      const detail = await loadProductDetail(chosen.product_id);
      if (!detail) return "No pude cargar la ficha de ese producto. Indícame otra opción o escribe Nueva búsqueda.";
      return buildProductFichaMessages(detail, { requestKind: state.catalog.requestKind });
    }

    const productOptions: CatalogPendingOption[] = state.catalog.lastList.map((p) => ({
      label: cleanProductName(p.nombre),
      value: p.product_id,
    }));
    const match = matchPendingOption(input, productOptions);
    if (match.value) {
      state.catalog.selectedProductId = match.value;
      const detail = await loadProductDetail(match.value);
      if (!detail) return "No pude cargar la ficha de ese producto. Indícame otra opción o escribe Nueva búsqueda.";
      return buildProductFichaMessages(detail, { requestKind: state.catalog.requestKind });
    }
    if (match.ambiguous) {
      return `Me quedaron 2 opciones parecidas. ¿Me dices el número (1–${max}) para elegir bien?`;
    }
  }

  const products = await queryProducts(state.catalog.filters);
  state.catalog.lastList = products;

  if (!products.length) {
    const missingLabel = (() => {
      const tp = normalizeText(state.catalog.filters.tipo_producto || "");
      if (tp.includes("camara") || tp.includes("cámara") || tp.includes("body")) return "Cámaras Corporales";
      if (tp.includes("accesor")) return "Accesorios";
      if (tp.includes("radio") || tp.includes("equipo")) return "Equipos Radio";
      return "";
    })();
    const keepRental = normalizeText(state.catalog.filters.modalidad || "").includes("arriendo");
    state.catalog.filters.frecuencia = undefined;
    state.catalog.filters.portabilidad = undefined;
    state.catalog.filters.modalidad = keepRental ? "Arriendo" : "Venta";
    state.catalog.filters.tecnologia = undefined;
    state.catalog.skipRadioTechFrequency = undefined;
    if (!keepRental && !isRadioEquipment) {
      const retry = await queryProducts(state.catalog.filters);
      if (retry.length) {
        state.catalog.lastList = retry;
        const lines = retry.map((p, i) => `${i + 1}) ${cleanProductName(p.nombre)}`).join("\n");
        return ["Estos son los que encontré (máx. 5):", "", lines, "", "Indícame qué opción quieres para mostrarte su ficha. También puedes decir el nombre."].join("\n");
      }
      const menu = await getSuggestedCatalogTypes("CL", state.catalog.filters.modalidad);
      const top = menu.length
        ? menu.slice(0, 5).map((m) => ({ label: withCatalogTypeIcon(m.label), value: m.tipo }))
        : [
            { label: "📻 Equipos Radio", value: "equipos-radio" },
            { label: "🎧 Accesorios", value: "accesorios" },
            { label: "📷 Cámaras Corporales", value: "camaras-corporales" },
          ];
      state.catalog.filters.tipo_producto = undefined;
      state.catalog.pending = { attr: "tipo_producto", options: top };
      const intro = missingLabel ? `Por ahora no encontré opciones para ${missingLabel}. Probemos con otra categoría:` : "Por ahora no encontré opciones para esa categoría. Probemos con otra:";
      return [intro, "", top.map((o) => o.label).join("\n"), "También puedes escribir el nombre del producto (ej: DP50)."].join("\n");
    }
    return keepRental
      ? "No encontré equipos de arriendo con esos filtros. Probemos otra vez y te ayudo a encontrar una alternativa."
      : isRadioEquipment
      ? "No encontré productos con esa combinación. Probemos otra vez desde la modalidad del equipo."
      : "Por ahora no encontré productos con esos filtros. ¿Quieres hacer una nueva búsqueda o volver al menú?";
  }

  const lines = products.map((p, i) => `${i + 1}) ${cleanProductName(p.nombre)}`).join("\n");
  return [
    "Estos son los que encontré (máx. 5):",
    "",
    lines,
    "",
    "Indícame qué opción quieres para mostrarte su ficha. También puedes decir el nombre (ej: Motorola DP250).",
  ].join("\n");
}

async function handleCatalogUY(state: UserState, text: string, userPhone: string): Promise<Reply> {
  const input = text.trim();
  const t = normalizeText(input);
  let selectedPendingOption: CatalogPendingOption | null = null;

  if (state.catalog.status === "wait_finish_cotizacion") {
    if (t.includes("cancel")) {
      state.catalog = { filters: {}, status: "idle" };
      state.activeBranch = "menu";
      const msg = await minimaxRewrite({
        kind: "empatia",
        input,
        facts: ["Ok, dejé la cotización cancelada."],
      });
      return withMainMenu(msg, state, state.country ?? "UY");
    }
    if (t.includes("termin") || t.includes("confirm") || t === "si" || t === "sí") {
      return await finalizeCotizacion(state, userPhone);
    }
    return "Para cerrar la cotización responde: Terminar / Cancelar.";
  }

  if (t.includes("nueva busqueda") || t.includes("nueva búsqueda") || t === "reiniciar") {
    state.catalog = { filters: { modalidad: "Venta" }, status: "idle" };
    return buildCotizarProductMenuMessage([
      { label: "📻 Equipos Radio", value: "equipos-radio" },
      { label: "🎧 Accesorios", value: "accesorios" },
      { label: "📷 Cámaras Corporales", value: "camaras-corporales" },
    ]);
  }

  if (state.catalog.quote) {
    const q = state.catalog.quote;
    if (t.includes("cancel")) {
      state.catalog.quote = undefined;
      state.catalog.status = "idle";
      state.catalog.reviewMode = undefined;
      state.catalog.reviewEditField = undefined;
      return "Ok, dejé la cotización cancelada. ¿Quieres seguir viendo productos o vuelvo al menú?";
    }

    if (state.catalog.reviewMode === "cotizacion") {
      if (state.catalog.reviewEditField) {
        const error = applyQuoteFieldValue(q, state.catalog.reviewEditField, input, "UY");
        if (error) return error;
        state.catalog.reviewEditField = undefined;
        state.catalog.quote = q;
        await upsertUserProfile(userPhone, q.data);
        return await buildCotizacionProfileReviewMessage(state);
      }

      const confirmCotizacion =
        t.includes("confirmar cotizacion") ||
        t.includes("confirmar cotización") ||
        t === "confirmar" ||
        t.includes("esta bien") ||
        t.includes("está bien") ||
        t.includes("correcto") ||
        t.includes("dale");
      const fieldToEdit = detectQuoteFieldToEdit(input);

      if (confirmCotizacion) {
        return await completeCatalogQuote(state, userPhone, input);
      }
      if (fieldToEdit) {
        state.catalog.reviewEditField = fieldToEdit;
        return getQuoteFieldPrompt(fieldToEdit, "UY");
      }
      return "Si está todo correcto, escribe Confirmar cotización. Si quieres cambiar algo, dime por ejemplo: cambiar correo.";
    }

    const setAndNext = (key: keyof CatalogQuote["data"], value: string, next: CatalogQuoteStep) => {
      q.data[key] = value;
      q.step = next;
    };

    if (q.step === "nombre") {
      if (input.length < 3) return "Perfecto. Para generar tu cotización, por favor indícame tu nombre y apellido.";
      setAndNext("nombre", input, "telefono");
      state.catalog.quote = q;
      return "Perfecto. Ahora indícame tu teléfono. Ej: +598 9 123 4567";
    }
    if (q.step === "telefono") {
      const p = normalizePhone(input);
      if (p.replace(/[^\d]/g, "").length < 7) {
        return "Disculpa, necesito el número completo para que el ejecutivo te contacte. Por favor, escríbelo con este formato EJ: +598 9 123 4567.";
      }
      setAndNext("telefono", p, "email");
      state.catalog.quote = q;
      return "¿Cuál es tu correo electrónico empresarial o personal? (Ej: nombre@empresa.com)";
    }
    if (q.step === "email") {
      if (!validateEmail(input)) return "Necesito un correo válido para enviarte la cotización. ¿Me lo compartes? (Ej: nombre@empresa.com)";
      setAndNext("email", input.trim(), "empresa");
      state.catalog.quote = q;
      return "¿Para qué empresa es la cotización? Si es para ti, escribe: Particular";
    }
    if (q.step === "empresa") {
      if (input.length < 2) return "¿Para qué empresa es la cotización? Si es para ti, escribe: Particular";
      setAndNext("empresa", input, "ciudad_region");
      state.catalog.quote = q;
      return "Por último, indícame la Ciudad y Región. Ej: Montevideo, Montevideo";
    }
    if (q.step === "ciudad_region") {
      const parsed = parseCityRegionInput(input);
      if (!parsed) {
        return "Para cerrar la cotización necesito ambos datos. Escríbeme la Ciudad y Región en este formato: Montevideo, Montevideo";
      }
      q.data.ciudad = parsed.ciudad;
      q.data.region = parsed.region;
      q.step = "final";
      state.catalog.status = "wait_finish_cotizacion";
      state.catalog.quote = q;
      if (q.data.nombre) state.userName = q.data.nombre.split(" ")[0]?.trim() || state.userName;
      await upsertUserProfile(userPhone, q.data);
      return await finalizeCotizacion(state, userPhone);
    }
  }

  if (state.catalog.pending) {
    const pending = state.catalog.pending;
    const n = isNumericChoice(t, pending.options.length);
    if (n) {
      selectedPendingOption = pending.options[n - 1]!;
      applyCatalogPendingSelection(state, pending, selectedPendingOption);
    } else {
      const match = matchPendingOption(input, pending.options);
      if (match.value) {
        const selected = pending.options.find((o) => o.value === match.value);
        if (!selected) return `Dale. Responde con un número (1–${pending.options.length}) o escríbeme la opción (como la ves en la lista).`;
        selectedPendingOption = selected;
        applyCatalogPendingSelection(state, pending, selected);
      } else {
        if (match.ambiguous) {
          return `Me quedaron 2 opciones parecidas. ¿Me respondes con el número (1–${pending.options.length}) para elegir bien?`;
        }
        return `Dale. Responde con un número (1–${pending.options.length}) o escríbeme la opción (como la ves en la lista).`;
      }
    }
  }

  if (selectedPendingOption?.skipRadioTechFrequency) {
    return await startCatalogQuoteForm(state, userPhone, "UY", {
      intro: "Perfecto. Si prefieres asesoría, avancemos con tu solicitud y un ejecutivo te ayudará a definir la mejor alternativa.",
    });
  }

  if (!state.catalog.filters.tipo_producto) {
    const tipos = await listDistinctTipoProductoUY();
    if (!tipos.length) return "¿Qué tipo de producto buscas? (Ej: Equipos, Accesorios, Cámaras)";
    const candidates = tipos.filter((tp) => normalizeText(tp).includes(t) || t.includes(normalizeText(tp)));
    if (candidates.length === 1) {
      state.catalog.filters.tipo_producto = candidates[0];
      state.catalog.selectedProductId = undefined;
      state.catalog.lastList = undefined;
      state.catalog.filters.frecuencia = undefined;
      state.catalog.filters.tecnologia = undefined;
      state.catalog.filters.portabilidad = undefined;
      state.catalog.skipRadioTechFrequency = undefined;
    } else if (candidates.length > 1) {
      const top = candidates.slice(0, 5);
      state.catalog.pending = { attr: "tipo_producto", options: top.map((o) => ({ label: o, value: o })) };
      return ["¿Cuál de estos tipos de producto buscas?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    } else {
      const suggested = await getSuggestedCatalogTypes("UY", state.catalog.filters.modalidad);
      const top = suggested.length
        ? suggested.map((o) => ({ label: withCatalogTypeIcon(o.label), value: o.tipo }))
        : tipos.slice(0, 5).map((o) => ({ label: o, value: o }));
      state.catalog.pending = { attr: "tipo_producto", options: top };
      return buildCotizarProductMenuMessage(top);
    }
  }

  const isRadioEquipment = isRadioEquipmentTipoProducto(state.catalog.filters.tipo_producto);

  if (!isRadioEquipment && !state.catalog.filters.tecnologia) {
    const opts = await listTecnologiasUY(state.catalog.filters);
    if (opts.length > 1) {
      const top = opts.slice(0, 5);
      state.catalog.pending = { attr: "tecnologia", options: top.map((o) => ({ label: o, value: o })) };
      return ["¿Qué tecnología prefieres?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    }
  }

  if (!state.catalog.filters.modalidad) {
    const opts = await listModalidadesUY(state.catalog.filters);
    if (opts.length > 1) {
      const top = opts.slice(0, 5);
      state.catalog.pending = { attr: "modalidad", options: top.map((o) => ({ label: o, value: o })) };
      return ["¿Lo buscas para venta o arriendo?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    }
  }

  if (!state.catalog.filters.portabilidad) {
    const opts = isRadioEquipment ? await buildRadioSubtypeOptions("UY", state.catalog.filters) : await listPortabilidadesUY(state.catalog.filters);
    if (opts.length > 1) {
      const options: CatalogPendingOption[] = isRadioEquipment
        ? (opts as CatalogPendingOption[]).slice(0, 5)
        : (opts as string[]).slice(0, 5).map((o) => ({ label: o, value: o }));
      state.catalog.pending = { attr: "portabilidad", options };
      return isRadioEquipment
        ? ["¿Qué formato necesitas?", "", ...state.catalog.pending.options.map((o) => o.label)].join("\n")
        : ["¿Portátil o móvil?", ...state.catalog.pending.options.map((o) => o.label)].join("\n");
    }
  }

  if (isRadioEquipment && !state.catalog.skipRadioTechFrequency && (!state.catalog.filters.frecuencia || !state.catalog.filters.tecnologia)) {
    const options = buildRadioFrequencyTechnologyOptions();
    state.catalog.pending = { attr: "frecuencia", options };
    return ["¿En qué frecuencia operan tus equipos actuales o cuál necesitas?", "", ...options.map((o, i) => `${i + 1}) ${o.label}`)].join("\n");
  }

  if (!isRadioEquipment && !state.catalog.filters.frecuencia) {
    const opts = await listFrecuenciasUY(state.catalog.filters);
    if (opts.length > 1) {
      const top = opts.slice(0, 5);
      state.catalog.pending = { attr: "frecuencia", options: top.map((o) => ({ label: o, value: o })) };
      return ["¿Qué frecuencia te sirve?", "", ...top.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    }
  }

  if (state.catalog.selectedProductId) {
    if (t.includes("cotiz")) {
      return await startCatalogQuoteForm(state, userPhone, "UY");
    }
    if (isMenuCommand(input)) {
      returnToCasualState(state);
      markMenuShown(state);
      return buildMainMenuText("UY", "return");
    }
    if (t === "volver a la lista" || (t.includes("volver") && t.includes("lista")) || t === "lista" || t.includes("ver lista") || t === "volver") {
      state.catalog.selectedProductId = undefined;
      if (state.catalog.lastList?.length) return buildProductsListMessage(state.catalog.lastList, "DEP250");
      return "Perfecto. Indícame el número del producto que quieres ver o escribe Nueva búsqueda.";
    }
    if (isStockQuestion(input)) {
      return await startCatalogQuoteForm(state, userPhone, "UY", {
        intro: "Para confirmar stock inmediato y tiempos de entrega, avancemos con la cotización y un ejecutivo te validará el inventario en minutos.",
      });
    }
    if (t.includes("nueva busqueda") || t.includes("nueva búsqueda")) {
      state.catalog.selectedProductId = undefined;
      state.catalog.lastList = undefined;
      state.catalog.filters = { modalidad: "Venta" };
      state.catalog.pending = undefined;
      state.catalog.skipRadioTechFrequency = undefined;
      return "Perfecto. Hagamos una nueva búsqueda. ¿Qué tipo de producto necesitas?";
    }
    if (t.includes("volver")) {
      state.catalog.selectedProductId = undefined;
    } else {
      return "Puedo ayudarte con eso. Si quieres validar stock y tiempos de entrega, lo mejor es avanzar con la cotización. También puedes volver al menú o hacer una nueva búsqueda.";
    }
  }

  if (state.catalog.lastList?.length) {
    const max = Math.min(5, state.catalog.lastList.length);
    const n = isNumericChoice(t, max) ?? extractChoiceNumberFromText(input, max);
    if (n) {
      const chosen = state.catalog.lastList[n - 1];
      state.catalog.selectedProductId = chosen.product_id;
      const detail = await loadProductDetailByCountry("UY", chosen.product_id);
      if (!detail) return "No pude cargar la ficha de ese producto. Indícame otra opción o escribe Nueva búsqueda.";
      return buildProductFichaMessages(detail);
    }

    const productOptions: CatalogPendingOption[] = state.catalog.lastList.map((p) => ({
      label: cleanProductName(p.nombre),
      value: p.product_id,
    }));
    const match = matchPendingOption(input, productOptions);
    if (match.value) {
      state.catalog.selectedProductId = match.value;
      const detail = await loadProductDetailByCountry("UY", match.value);
      if (!detail) return "No pude cargar la ficha de ese producto. Indícame otra opción o escribe Nueva búsqueda.";
      return buildProductFichaMessages(detail);
    }
    if (match.ambiguous) {
      return `Me quedaron 2 opciones parecidas. ¿Me dices el número (1–${max}) para elegir bien?`;
    }
  }

  const products = await queryProductsUY(state.catalog.filters);
  state.catalog.lastList = products;

  if (!products.length) {
    const missingLabel = (() => {
      const tp = normalizeText(state.catalog.filters.tipo_producto || "");
      if (tp.includes("camara") || tp.includes("cámara") || tp.includes("body")) return "Cámaras Corporales";
      if (tp.includes("accesor")) return "Accesorios";
      if (tp.includes("radio") || tp.includes("equipo")) return "Equipos Radio";
      return "";
    })();
    const keepRental = normalizeText(state.catalog.filters.modalidad || "").includes("arriendo");
    state.catalog.filters.frecuencia = undefined;
    state.catalog.filters.portabilidad = undefined;
    state.catalog.filters.modalidad = keepRental ? "Arriendo" : "Venta";
    state.catalog.filters.tecnologia = undefined;
    state.catalog.skipRadioTechFrequency = undefined;
    if (!keepRental && !isRadioEquipment) {
      const retry = await queryProductsUY(state.catalog.filters);
      if (retry.length) {
        state.catalog.lastList = retry;
        const lines = retry.map((p, i) => `${i + 1}) ${cleanProductName(p.nombre)}`).join("\n");
        return ["Estos son los que encontré (máx. 5):", "", lines, "", "Indícame qué opción quieres para mostrarte su ficha. También puedes decir el nombre."].join("\n");
      }
      const menu = await getSuggestedCatalogTypes("UY", state.catalog.filters.modalidad);
      const top = menu.length
        ? menu.slice(0, 5).map((m) => ({ label: withCatalogTypeIcon(m.label), value: m.tipo }))
        : [
            { label: "📻 Equipos Radio", value: "equipos-radio" },
            { label: "🎧 Accesorios", value: "accesorios" },
            { label: "📷 Cámaras Corporales", value: "camaras-corporales" },
          ];
      state.catalog.filters.tipo_producto = undefined;
      state.catalog.pending = { attr: "tipo_producto", options: top };
      const intro = missingLabel ? `Por ahora no encontré opciones para ${missingLabel}. Probemos con otra categoría:` : "Por ahora no encontré opciones para esa categoría. Probemos con otra:";
      return [intro, "", top.map((o) => o.label).join("\n"), "También puedes escribir el nombre del producto."].join("\n");
    }
    return keepRental
      ? "No encontré equipos de arriendo con esos filtros. Probemos otra vez y te ayudo a encontrar una alternativa."
      : isRadioEquipment
      ? "No encontré productos con esa combinación. Probemos otra vez desde la modalidad del equipo."
      : "Por ahora no encontré productos con esos filtros. ¿Quieres hacer una nueva búsqueda o volver al menú?";
  }

  const lines = products.map((p, i) => `${i + 1}) ${cleanProductName(p.nombre)}`).join("\n");
  return [
    "Estos son los que encontré (máx. 5):",
    "",
    lines,
    "",
    "Indícame qué opción quieres para mostrarte su ficha. También puedes decir el nombre (ej: DEP250).",
  ].join("\n");
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
  const paragraphs = normalizeParagraphs(text);
  if (!paragraphs.length) return [];

  const out: string[] = [];
  let current = "";

  const flush = () => {
    const v = current.trim();
    if (v) out.push(v);
    current = "";
  };

  for (const p of paragraphs) {
    if (!p) continue;
    if (!current) {
      if (p.length <= chunkSize) {
        current = p;
        continue;
      }
      flush();
      out.push(...splitLongText(p, chunkSize));
      continue;
    }

    const candidate = `${current}\n\n${p}`.trim();
    if (candidate.length <= chunkSize) {
      current = candidate;
      continue;
    }

    flush();
    if (p.length <= chunkSize) {
      current = p;
    } else {
      out.push(...splitLongText(p, chunkSize));
    }
  }

  flush();
  return out.filter(Boolean);
}

async function handleProjects(state: UserState, text: string, userPhone: string): Promise<string | string[]> {
  const t = normalizeText(text);
  const wantsDetail = t.includes("detalle") || t.includes("completo") || t.includes("texto completo") || t.includes("ver completo");
  const wantsMoreProjects = t.includes("ver mas proyectos") || t.includes("ver más proyectos");

  if (t.includes("solicit") || t.includes("asesoria") || t.includes("asesoría") || t.includes("formulario") || t.includes("contact")) {
    return await startContactForm(state, userPhone, "cl_proyectos");
  }

  let list = state.projects.lastList ?? [];
  let noMoreProjects = false;

  if (wantsDetail && state.projects.reading?.id) {
    const detail = await loadProjectContent(state.projects.reading.id);
    if (!detail) return "No pude cargar ese proyecto. Elige otro número o escribe Menú.";
    const chunks = chunkText(detail.plain, 1100);
    return [
      `*${detail.titulo}*`,
      ...(chunks.length ? chunks : ["Descripción no disponible."]),
      getProjectsCtaText(),
      "Si quieres ver otro proyecto, elige un número o escribe Menú.",
    ].filter(Boolean);
  }

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

    state.projects.reading = { id: chosen.id, offset: 0 };

    const resumen = summarizeProject(detail.plain, 900);
    const messages: string[] = [`*${detail.titulo}*`];
    if (resumen) messages.push(resumen);
    messages.push("Si quieres que te envíe el detalle completo, dime: Detalle.");
    messages.push(getProjectsCtaText());
    messages.push("Para ver otro proyecto, indícame el número (ej: 2) o escribe: proyecto 2.");
    return messages.filter(Boolean);
  }
  if (!list.length) return "Por ahora no veo proyectos para mostrar. Responde Menú para volver al inicio.";

  if (noMoreProjects) {
    return "Por ahora no tengo más proyectos para mostrar. Elige algún proyecto o si quieres regresamos al menú.";
  }

  const lines = list.map((p, i) => `${i + 1}) ${p.titulo}`).join("\n");
  return ["Estos son algunos proyectos:", "", lines, "", getProjectsNaturalGuidanceText(), "", getProjectsMenuReminderText()].join("\n");
}

async function loadProjectContent(id: number) {
  const q = `proyectos?select=id,titulo,contenido&limit=1&id=eq.${id}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return null;
  const row = (res.data as unknown[])[0];
  if (!row) return null;
  const titulo = toTrimmedString(getRecordValue(row, "titulo"));
  const contenido = toTrimmedString(getRecordValue(row, "contenido"));
  const plain = htmlToParagraphText(contenido);
  return { id, titulo, plain };
}

function isFormLockActive(state: UserState) {
  if (state.catalog.status === "wait_finish_cotizacion") return true;
  if (state.catalog.quote) return true;
  if (state.contactForm) return true;
  if (state.cambium?.quote) return true;
  return false;
}

function getContactFormCountry(kind: ContactFormKind): Country {
  return kind.startsWith("uy_") ? "UY" : "CL";
}

function getDealerZoneLabel(data?: ContactFormState["data"]) {
  const zone = (data?.direccion ?? "").trim();
  return zone ? `Contacto con dealer - ${zone}` : "Contacto con dealer";
}

function isServiceContactKind(kind: ContactFormKind) {
  return kind === "cl_servicio_tecnico" || kind === "uy_servicio_tecnico";
}

function getContactFormRequestLabel(kind: ContactFormKind, data?: ContactFormState["data"]) {
  switch (kind) {
    case "cl_proyectos":
    case "uy_proyectos":
      return "Asesoría en proyectos";
    case "cl_dealer":
      return getDealerZoneLabel(data);
    case "cl_servicio_tecnico":
    case "uy_servicio_tecnico":
      return "Servicio técnico";
  }
}

function getContactFormStartIntro(kind: ContactFormKind) {
  switch (kind) {
    case "cl_proyectos":
      return "Perfecto. Armemos tu solicitud de asesoría en proyectos.";
    case "cl_dealer":
      return "Perfecto. Armemos tu solicitud para que un dealer de tu región te contacte.";
    case "cl_servicio_tecnico":
      return "Perfecto. Armemos tu solicitud de servicio técnico.";
    case "uy_proyectos":
      return "Perfecto. Armemos tu solicitud de asesoría en proyectos.";
    case "uy_servicio_tecnico":
      return "Perfecto. Armemos tu solicitud de servicio técnico.";
  }
}

function getContactFormReviewTitle(kind: ContactFormKind, data?: ContactFormState["data"]) {
  switch (kind) {
    case "cl_proyectos":
    case "uy_proyectos":
      return "Perfecto. Este es el resumen de tu solicitud de asesoría en proyectos:";
    case "cl_dealer":
      return `Perfecto. Este es el resumen de tu solicitud de ${getContactFormRequestLabel(kind, data)}:`;
    case "cl_servicio_tecnico":
    case "uy_servicio_tecnico":
      return "Perfecto. Este es el resumen de tu solicitud de servicio técnico:";
  }
}

function getContactFormSuccessMessage(kind: ContactFormKind, data?: ContactFormState["data"]) {
  switch (kind) {
    case "cl_proyectos":
    case "uy_proyectos":
      return "✅ Tu solicitud de asesoría en proyectos fue enviada correctamente. Te contactaremos a la brevedad.";
    case "cl_dealer":
      return `✅ Tu solicitud de ${getContactFormRequestLabel(kind, data)} fue enviada correctamente. Te contactaremos a la brevedad.`;
    case "cl_servicio_tecnico":
    case "uy_servicio_tecnico":
      return "✅ Tu solicitud de servicio técnico fue enviada correctamente. Te contactaremos a la brevedad.";
  }
}

function getProjectsCtaText() {
  return "Si quieres ingresar una solicitud, escribe: Solicitar Asesoría.";
}

function getProjectsNaturalGuidanceText() {
  return "Puedes escoger algun proyecto para revisarlo, en caso de necesitar una asesoria para tus proyectos solo debes solicitarla y te derivamos al formulario de contacto.";
}

function getProjectsMenuReminderText() {
  return "Recuerda que puedes volver a tu menu de opciones cuando lo desees.";
}

function getServiceCtaText() {
  return "Si quieres ingresar una solicitud, escribe: Solicitar Servicio Técnico.";
}

function getDealerCtaText() {
  return "Si quieres ingresar una solicitud, escribe: Contactar Dealer.";
}

function getNaturalMenuReminderText() {
  return "Recuerda que puedes volver a tu menu de opciones cuando lo desees.";
}

function getServiceNaturalGuidanceText() {
  return "Si necesitas ayuda mas personalizada con tu caso, solo debes solicitar el servicio tecnico y te derivamos al formulario de contacto.";
}

function getDealerNaturalGuidanceText() {
  return "Si necesitas que te pongamos en contacto con un dealer de tu region, solo debes solicitarlo y te derivamos al formulario de contacto.";
}

function getCancelReminderText() {
  return "Si en algun momento quieres salir de este proceso, solo escribe: Cancelar.";
}

function getCancelConfirmationText() {
  return "Perfecto, cancelé esta solicitud. Si quieres, retomamos desde el menu.";
}

function getFormInProgressText() {
  return "Ahora mismo estamos completando una solicitud. Si prefieres salir de este proceso, solo escribe: Cancelar.";
}

function getContactFormMessagePrompt(kind: ContactFormKind) {
  switch (kind) {
    case "cl_proyectos":
    case "uy_proyectos":
      return "¿Qué proyecto o necesidad tienes? (mensaje)";
    case "cl_dealer":
      return "¿Qué necesitas del dealer de tu región? (mensaje)";
    case "cl_servicio_tecnico":
    case "uy_servicio_tecnico":
      return "¿Qué problema o solicitud tienes? (mensaje)";
  }
}

function getContactFormStepPrompt(step: Exclude<ContactFormStep, "final">, kind: ContactFormKind) {
  const country = getContactFormCountry(kind);
  if (step === "nombre") return "Perfecto. Para continuar, indícame tu nombre y apellido.";
  if (step === "empresa") return "¿Para qué empresa es la solicitud? Si es para ti, escribe: Particular";
  if (step === "telefono") return country === "UY" ? "Ahora indícame tu teléfono. Ej: +598 9 123 4567" : "Ahora indícame tu teléfono. Ej: +569 1234 5678";
  if (step === "correo") return country === "UY" ? "¿Cuál es tu correo electrónico? (Ej: nombre@empresa.com)" : "¿Cuál es tu correo electrónico? (Ej: nombre@empresa.cl)";
  if (step === "direccion") return "¿Cuál es tu dirección, comuna o referencia de ubicación?";
  if (step === "producto") return "¿Con qué equipo o producto necesitas ayuda? Si prefieres omitirlo, escribe: Omitir";
  return getContactFormMessagePrompt(kind);
}

function getContactFormNextStep(kind: ContactFormKind, data: ContactFormState["data"], optionalProductHandled?: boolean): ContactFormStep {
  if (!data.nombre) return "nombre";
  if (!data.empresa) return "empresa";
  if (!data.telefono) return "telefono";
  if (!data.correo) return "correo";
  if (!data.direccion) return "direccion";
  if (isServiceContactKind(kind) && !optionalProductHandled && !data.producto) return "producto";
  if (!data.mensaje) return "mensaje";
  return "final";
}

function detectContactFieldToEdit(text: string): Exclude<ContactFormStep, "final"> | null {
  const t = normalizeText(text);
  if (!t) return null;
  if (t.includes("nombre") || t.includes("apellido")) return "nombre";
  if (t.includes("empresa")) return "empresa";
  if (t.includes("telefono") || t.includes("teléfono") || t.includes("celular") || t.includes("fono")) return "telefono";
  if (t.includes("correo") || t.includes("mail") || t.includes("email")) return "correo";
  if (t.includes("direccion") || t.includes("dirección") || t.includes("comuna") || t.includes("ubicacion") || t.includes("ubicación")) return "direccion";
  if (t.includes("producto") || t.includes("equipo") || t.includes("modelo")) return "producto";
  if (t.includes("mensaje") || t.includes("detalle") || t.includes("observacion") || t.includes("observación")) return "mensaje";
  return null;
}

function applyContactFieldValue(form: ContactFormState, field: Exclude<ContactFormStep, "final">, input: string) {
  const country = getContactFormCountry(form.kind);
  if (field === "nombre") {
    if (input.trim().length < 3) return "Necesito tu nombre y apellido para continuar.";
    form.data.nombre = input.trim();
    return null;
  }
  if (field === "empresa") {
    const t = normalizeText(input);
    if (!input.trim()) return "¿Para qué empresa es la solicitud? Si es para ti, escribe: Particular";
    form.data.empresa = t === "particular" ? "Particular" : input.trim();
    return null;
  }
  if (field === "telefono") {
    const phone = normalizePhone(input);
    const minDigits = country === "UY" ? 7 : 8;
    if (phone.replace(/[^\d]/g, "").length < minDigits) {
      return country === "UY"
        ? "Disculpa, necesito el número completo. Por favor, escríbelo con este formato: +598 9 123 4567."
        : "Disculpa, necesito el número completo. Por favor, escríbelo con este formato: +569 1234 5678.";
    }
    form.data.telefono = phone;
    return null;
  }
  if (field === "correo") {
    if (!validateEmail(input)) {
      return country === "UY" ? "Necesito un correo válido. ¿Me lo compartes? (Ej: nombre@empresa.com)" : "Necesito un correo válido. ¿Me lo compartes? (Ej: nombre@empresa.cl)";
    }
    form.data.correo = input.trim();
    return null;
  }
  if (field === "direccion") {
    if (input.trim().length < 3) return "Necesito una dirección, comuna o referencia para continuar.";
    form.data.direccion = input.trim();
    return null;
  }
  if (field === "producto") {
    const t = normalizeText(input);
    if (!input.trim()) return "¿Con qué equipo o producto necesitas ayuda? Si prefieres omitirlo, escribe: Omitir";
    if (t === "omitir" || t === "no se" || t === "nose" || t === "ninguno") {
      form.data.producto = "";
      form.optionalProductHandled = true;
      return null;
    }
    if (input.trim().length < 2) return "Cuéntame el equipo o modelo. Si prefieres omitirlo, escribe: Omitir";
    form.data.producto = input.trim();
    form.optionalProductHandled = true;
    return null;
  }
  if (input.trim().length < 4) return "Dime un poquito más en el mensaje para que podamos ayudarte mejor.";
  form.data.mensaje = input.trim();
  return null;
}

function mapContactFormToUserProfile(data: ContactFormState["data"]): CatalogQuote["data"] {
  return {
    nombre: data.nombre,
    telefono: data.telefono,
    email: data.correo,
    empresa: data.empresa,
    direccion: data.direccion,
  };
}

async function buildContactFormReviewMessage(state: UserState) {
  const form = state.contactForm;
  if (!form) return "No veo una solicitud activa en este momento.";
  const productSection = isServiceContactKind(form.kind)
    ? ["*Equipo o producto*", form.data.producto ? `- Producto: ${form.data.producto}` : "- Producto: No informado", ""]
    : [];
  const lines = [
    getContactFormReviewTitle(form.kind, form.data),
    "",
    "*Solicitud*",
    `- Tipo: ${getContactFormRequestLabel(form.kind, form.data)}`,
    "",
    "*Datos de contacto*",
    form.data.nombre ? `- Nombre y Apellido: ${form.data.nombre}` : "",
    form.data.telefono ? `- Teléfono: ${form.data.telefono}` : "",
    form.data.correo ? `- Correo electrónico: ${form.data.correo}` : "",
    "",
    "*Empresa*",
    form.data.empresa ? `- Empresa: ${form.data.empresa}` : "- Empresa: Particular / No informada",
    "",
    "*Ubicación*",
    form.data.direccion ? `- Dirección o referencia: ${form.data.direccion}` : "- Dirección o referencia: No informada",
    "",
    ...productSection,
    "*Detalle*",
    form.data.mensaje ? `- Mensaje: ${form.data.mensaje}` : "- Mensaje: No informado",
    "",
    "Si está todo correcto, escribe: Confirmar solicitud",
    "Si quieres editar algo, puedes decir por ejemplo: cambiar teléfono",
  ].filter(Boolean);
  return lines.join("\n");
}

async function saveClContactLead(userPhone: string, form: ContactFormState) {
  const row = {
    user_phone: userPhone,
    country: "CL",
    origen: form.kind,
    nombre: form.data.nombre ?? null,
    telefono: form.data.telefono ?? null,
    email: form.data.correo ?? null,
    empresa: form.data.empresa ?? null,
    direccion: form.data.direccion ?? null,
    ciudad: null,
    region: null,
    producto_id: null,
    producto_nombre: form.data.producto?.trim() || getContactFormRequestLabel(form.kind, form.data),
    mensaje: form.data.mensaje ?? null,
    canal: "whatsapp",
    estado: "enviada",
  };
  const res = await supabaseFetch(`cotizaciones`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const fallbackRow = { ...row };
    delete (fallbackRow as Record<string, unknown>).mensaje;
    await supabaseFetch(`cotizaciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(fallbackRow),
    });
  }
}

async function finalizeContactForm(state: UserState, userPhone: string) {
  const form = state.contactForm;
  if (!form) return "No veo una solicitud activa en este momento.";

  await upsertUserProfile(userPhone, mapContactFormToUserProfile(form.data));

  if (getContactFormCountry(form.kind) === "UY") {
    await saveUyLead({
      user_phone: userPhone,
      country: "UY",
      flow: form.kind,
      nombre: form.data.nombre ?? null,
      empresa: form.data.empresa ?? null,
      telefono: form.data.telefono ?? null,
      email: form.data.correo ?? null,
      direccion: form.data.direccion ?? null,
      producto: form.data.producto?.trim() || null,
      mensaje: form.data.mensaje ?? null,
      canal: "whatsapp",
      created_at: new Date().toISOString(),
    });
  } else {
    await saveClContactLead(userPhone, form);
  }

  state.contactForm = undefined;
  state.activeBranch = "menu";
  markMenuShown(state);

  return [
    getContactFormSuccessMessage(form.kind, form.data),
    "",
    buildMainMenuText(state.country ?? getContactFormCountry(form.kind), "return"),
  ].join("\n");
}

async function startContactForm(
  state: UserState,
  userPhone: string,
  kind: ContactFormKind,
  options?: { intro?: string; presetData?: Partial<ContactFormState["data"]> },
) {
  const profile = await loadUserProfile(userPhone);
  const data: ContactFormState["data"] = {
    nombre: options?.presetData?.nombre ?? profile?.nombre,
    empresa: options?.presetData?.empresa ?? profile?.empresa,
    telefono: options?.presetData?.telefono ?? profile?.telefono,
    correo: options?.presetData?.correo ?? profile?.email,
    direccion: options?.presetData?.direccion ?? profile?.direccion,
    producto: options?.presetData?.producto,
    mensaje: options?.presetData?.mensaje,
  };

  const optionalProductHandled = Boolean(options?.presetData?.producto);
  const next = getContactFormNextStep(kind, data, optionalProductHandled);
  state.contactForm = { kind, step: next, data, reviewMode: false, reviewEditField: undefined, optionalProductHandled };

  if (next === "final") {
    state.contactForm.reviewMode = true;
    return await buildContactFormReviewMessage(state);
  }

  const intro = options?.intro ?? getContactFormStartIntro(kind);
  return [intro, "", getContactFormStepPrompt(next, kind), "", getCancelReminderText()].join("\n");
}

async function handleContactForm(state: UserState, text: string, userPhone: string) {
  const input = text.trim();
  const t = normalizeText(input);
  const form = state.contactForm;
  if (!form) return "¿Me cuentas un poquito más?";

  if (t.includes("cancel")) {
    state.contactForm = undefined;
    state.activeBranch = "menu";
    markMenuShown(state);
    return [getCancelConfirmationText(), "", buildMainMenuText(state.country ?? getContactFormCountry(form.kind), "return")].join("\n");
  }

  if (form.reviewMode) {
    if (form.reviewEditField) {
      const error = applyContactFieldValue(form, form.reviewEditField, input);
      if (error) return error;
      form.reviewEditField = undefined;
      state.contactForm = form;
      await upsertUserProfile(userPhone, mapContactFormToUserProfile(form.data));
      return await buildContactFormReviewMessage(state);
    }

    const confirm =
      t.includes("confirmar solicitud") ||
      t.includes("confirmar la solicitud") ||
      t === "confirmar" ||
      t === "confirmo" ||
      (t.includes("confirm") && t.includes("solicitud")) ||
      t.includes("esta bien") ||
      t.includes("está bien") ||
      t.includes("correcto") ||
      t.includes("dale");

    if (confirm) {
      return await finalizeContactForm(state, userPhone);
    }
    const fieldToEdit = detectContactFieldToEdit(input);
    if (fieldToEdit) {
      form.reviewEditField = fieldToEdit;
      state.contactForm = form;
      return getContactFormStepPrompt(fieldToEdit, form.kind);
    }
    return "Si está todo correcto, escribe Confirmar solicitud. Si quieres editar algo, dime por ejemplo: cambiar teléfono.";
  }

  const error = applyContactFieldValue(form, form.step as Exclude<ContactFormStep, "final">, input);
  if (error) return error;

  form.step = getContactFormNextStep(form.kind, form.data, form.optionalProductHandled);
  state.contactForm = form;

  if (form.step === "final") {
    form.reviewMode = true;
    await upsertUserProfile(userPhone, mapContactFormToUserProfile(form.data));
    return await buildContactFormReviewMessage(state);
  }

  return getContactFormStepPrompt(form.step as Exclude<ContactFormStep, "final">, form.kind);
}

async function handleProjectsUY(state: UserState, text: string, userPhone: string): Promise<Reply> {
  const input = text.trim();
  const t = normalizeText(input);
  if (t.includes("solicit") || t.includes("formulario") || t.includes("contact")) {
    return await startContactForm(state, userPhone, "uy_proyectos");
  }

  const { projects, bankText } = loadUyProjectsData();
  state.projects.lastList = projects.map((p) => ({ id: p.id, titulo: p.titulo }));

  const wantsDetail = t.includes("detalle") || t.includes("completo") || t.includes("texto completo");
  if (wantsDetail && state.projects.reading?.id) {
    const found = projects.find((p) => p.id === state.projects.reading?.id);
    if (!found) return "No pude cargar ese proyecto. Elige otro número o escribe Menú.";
    const chunks = chunkText(found.contenido, 1100);
    return [
      `*${found.titulo}*`,
      ...(chunks.length ? chunks : ["Descripción no disponible."]),
      getProjectsCtaText(),
      "Para ver otro proyecto, indícame el número o escribe Menú.",
    ].filter(Boolean);
  }

  const n = isNumericChoice(t, projects.length) ?? extractProjectChoiceFromText(t, projects.length);
  if (n) {
    const chosen = projects[n - 1];
    if (!chosen) return "Elige un número válido o escribe Menú.";
    state.projects.reading = { id: chosen.id, offset: 0 };
    const resumen = summarizeProject(chosen.contenido, 900);
    const messages: string[] = [`*${chosen.titulo}*`];
    if (resumen) messages.push(resumen);
    messages.push("Si quieres que te envíe el detalle completo, dime: Detalle.");
    messages.push(getProjectsCtaText());
    return messages.filter(Boolean);
  }

  const bankHints = ["certificacion", "certificación", "certificaciones", "enfoque", "banco", "informativo", "capacidad", "soluciones"];
  if (bankHints.some((h) => t.includes(normalizeText(h))) && bankText) {
    const ai = await minimaxAnswerFromKnowledge({ role: "proyectos", input, knowledgeText: bankText });
    if (ai) return [ai, "", getProjectsCtaText()].join("\n");
    const clipped = bankText.length > 1400 ? `${bankText.slice(0, 1400).trim()}...` : bankText;
    return [clipped, "", getProjectsCtaText()].join("\n");
  }

  if (!projects.length) return "Por ahora no veo proyectos para mostrar. Responde Menú para volver al inicio.";
  const lines = projects.map((p, i) => `${i + 1}) ${p.titulo}`).join("\n");
  return [
    "Estos son algunos proyectos:",
    "",
    lines,
    "",
    `Elige un proyecto por número. ${getProjectsCtaText()}`,
  ].join("\n");
}

async function handleServicioTecnicoUY(state: UserState, text: string, userPhone: string): Promise<Reply> {
  const input = text.trim();
  const t = normalizeText(input);
  const opening = "🔧 ¡Buenas! Cuéntame tu duda técnica (equipo/modelo y qué te está pasando) y lo revisamos al tiro.";
  if (!input) return `${opening}\n\n${getServiceCtaText()}`;

  if (t.includes("solicit") || t.includes("agendar") || t.includes("formulario") || t.includes("contact")) {
    const producto = extractLikelyProductModel(input) || state.serviceTech?.lastProducto || "";
    return await startContactForm(state, userPhone, "uy_servicio_tecnico", producto ? { presetData: { producto } } : undefined);
  }

  const st = loadUyServicioTecnicoText();
  const core = st ? (st.length > 2200 ? `${st.slice(0, 2200).trim()}...` : st) : "";
  const ai = await minimaxServicioTecnicoAnswer({
    input,
    knowledge: core ? [{ tema: "Servicio técnico (Uruguay)", info: core }] : [],
  });

  const tail = [
    getServiceNaturalGuidanceText(),
    "",
    getNaturalMenuReminderText(),
  ].join("\n");

  return [ai || opening, "", tail].join("\n");
}

function matchByNameOrNumber(input: string, list: { name: string }[]) {
  const t = normalizeText(input);
  const n = extractChoiceNumberFromText(t, list.length);
  if (n) return list[n - 1] ?? null;
  const candidates = list
    .map((p) => {
      const hay = normalizeText(p.name);
      const score = scoreTokenMatch(t.split(/\s+/g).filter(Boolean), hay) + (hay.includes(t) || t.includes(hay) ? 10 : 0);
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.p ?? null;
}

async function handleCambium(state: UserState, text: string, userPhone: string): Promise<Reply> {
  state.cambium ??= {};
  const cambium = state.cambium;
  const input = text.trim();
  const t = normalizeText(input);
  const data = loadCambiumData();

  if (cambium.quote) {
    const q = cambium.quote;
    if (t.includes("cancel")) {
      cambium.quote = undefined;
      markMenuShown(state);
      return [getCancelConfirmationText(), "", buildMainMenuText("UY", "return")].join("\n");
    }

    const setAndNext = (key: keyof CambiumQuote["data"], value: string, next: CambiumQuoteStep) => {
      q.data[key] = value;
      q.step = next;
    };

    if (q.step === "nombre") {
      if (input.length < 3) return "¿Nombre y apellidos?";
      setAndNext("nombre", input, "empresa");
      return "Perfecto. ¿Empresa?";
    }
    if (q.step === "empresa") {
      if (input.length < 2) return "¿Empresa?";
      setAndNext("empresa", input, "telefono");
      return "¿Teléfono?";
    }
    if (q.step === "telefono") {
      const p = normalizePhone(input);
      if (p.replace(/[^\d]/g, "").length < 7) return "¿Me lo repites? (Ej: +598 9 123 4567)";
      setAndNext("telefono", p, "solucion");
      const opts = ["ePMP", "Punto a Punto", "Punto a multipunto", "Aplicaciones de Software", "Accesorios de Banda Ancha"];
      return ["¿Cuál de estas soluciones te interesa?", "", ...opts.map((o, i) => `${i + 1}) ${o}`)].join("\n");
    }
    if (q.step === "solucion") {
      const opts = ["ePMP", "Punto a Punto", "Punto a multipunto", "Aplicaciones de Software", "Accesorios de Banda Ancha"];
      const n = extractChoiceNumberFromText(t, opts.length);
      const value = n ? opts[n - 1] : input;
      if (!value || String(value).trim().length < 2) return "¿Cuál solución te interesa? (Puedes responder con el número)";
      setAndNext("solucion", String(value).trim(), "email");
      return "¿Correo?";
    }
    if (q.step === "email") {
      if (!validateEmail(input)) return "¿Correo válido? (Ej: nombre@empresa.com)";
      setAndNext("email", input.trim(), "direccion");
      return "¿Dirección?";
    }
    if (q.step === "direccion") {
      if (input.length < 3) return "¿Dirección?";
      setAndNext("direccion", input, "final");

      const payload = {
        user_phone: userPhone,
        country: "UY",
        flow: "uy_cambium",
        nombre: q.data.nombre ?? null,
        empresa: q.data.empresa ?? null,
        telefono: q.data.telefono ?? null,
        email: q.data.email ?? null,
        direccion: q.data.direccion ?? null,
        producto: q.data.producto ?? null,
        categoria: q.data.categoria ?? null,
        solucion: q.data.solucion ?? null,
        canal: "whatsapp",
        created_at: new Date().toISOString(),
      };
      await saveUyLead(payload);

      cambium.quote = undefined;
      state.activeBranch = "menu";
      markMenuShown(state);
      return ["✅ Listo, recibimos tu solicitud de Cambium. Te contactamos a la brevedad.", "", buildMainMenuText("UY", "return")].join("\n");
    }
  }

  if (!cambium.category) {
    const intro = [
      "🌐 *Cambium Networks*",
      data.intro,
      "",
      "¿Qué necesitas?",
      "1) Conectividad empresarial",
      "2) Radioenlaces",
      "",
      "También puedes preguntarme algo específico (ej: “qué es cnMaestro”).",
    ].join("\n");

    const n = extractChoiceNumberFromText(t, 2);
    const wantsCon = n === 1 || t.includes("conectiv") || t.includes("wifi") || t.includes("switch") || t.includes("sd wan") || t.includes("sd-wan") || t.includes("nse");
    const wantsRad = n === 2 || t.includes("radioenlace") || t.includes("radioenlaces") || t.includes("ptp") || t.includes("pmp");

    if (wantsCon) cambium.category = "conectividad";
    else if (wantsRad) cambium.category = "radioenlaces";
    else {
      const ai = await minimaxAnswerFromKnowledge({ role: "cambium", input, knowledgeText: `${data.intro}\n\n${data.bankText}`.trim() });
      return ai ? [ai, "", "Si quieres ver productos, elige: 1) Conectividad empresarial / 2) Radioenlaces"].join("\n") : intro;
    }
  }

  if (t.includes("cambiar") || t.includes("otra categoria") || t.includes("otra categoría")) {
    cambium.category = undefined;
    cambium.lastList = undefined;
    cambium.selected = undefined;
    return await handleCambium(state, "", userPhone);
  }

  const category = data.categories.find((c) => c.key === cambium.category) ?? data.categories[0]!;
  const products = category.products.slice(0, 10);
  cambium.lastList = products;

  if (!cambium.selected && products.length) {
    const chosen = input ? matchByNameOrNumber(input, products) : null;
    if (chosen) {
      cambium.selected = chosen;
    } else if (!input) {
      const lines = products.slice(0, 8).map((p, i) => `${i + 1}) ${p.name}`).join("\n");
      const head = [`*${category.title}*`, category.detail ? category.detail : "", ""].filter(Boolean).join("\n");
      return [head, "Estos son algunos productos:", "", lines, "", "Elige uno por número o nombre. Para cambiar categoría: Cambiar categoría."].join("\n");
    } else {
      const ai = await minimaxAnswerFromKnowledge({ role: "cambium", input, knowledgeText: `${category.detail}\n\n${data.bankText}`.trim() });
      if (ai) return [ai, "", "Si quieres ver productos, dime: Listar o elige 1–8."].join("\n");
      const lines = products.slice(0, 8).map((p, i) => `${i + 1}) ${p.name}`).join("\n");
      return ["No caché cuál producto querías.", "", lines, "", "Responde con el número o nombre."].join("\n");
    }
  }

  if (cambium.selected) {
    if (t.includes("volver")) {
      cambium.selected = undefined;
      return await handleCambium(state, "", userPhone);
    }
    if (t.includes("cotiz")) {
      cambium.quote = {
        step: "nombre",
        data: { categoria: category.title, producto: cambium.selected.name },
      };
      return "📄 Perfecto. Para cotizar Cambium, ¿nombre y apellidos? (Puedes cancelar con: Cancelar)";
    }
    const out: Array<string | OutboundMessage> = [`*${cambium.selected.name}*`];
    if (cambium.selected.imageUrl) out.push({ type: "image", imageUrl: cambium.selected.imageUrl });
    out.push("Responde: Cotizar / Volver / Cambiar categoría / Menú");
    return out;
  }

  return "Dime si quieres: Listar productos / Cambiar categoría / Menú.";
}

async function handlePoints(state: UserState, text: string, userPhone: string) {
  const t = normalizeText(text);

  if (state.points.awaitingDealerOffer) {
    if (isAffirmative(text) || t.includes("dealer") || t.includes("distribuidor") || t.includes("contact") || t.includes("ejecutivo") || t.includes("asesor")) {
      state.points.awaitingDealerOffer = false;
      return await startContactForm(state, userPhone, "cl_dealer", {
        intro: state.points.lastQuery
          ? `Perfecto. Armemos tu solicitud para que un dealer te contacte por la zona de ${state.points.lastQuery}.`
          : "Perfecto. Armemos tu solicitud para que un dealer de tu región te contacte.",
        presetData: {
          direccion: state.points.lastQuery,
          mensaje: state.points.lastQuery
            ? `Solicita contacto con dealer para la zona: ${state.points.lastQuery}.`
            : "Solicita contacto con dealer de su región.",
        },
      });
    }
    if (isNegative(text)) {
      state.points.awaitingDealerOffer = false;
      return ["Perfecto. Si quieres buscar otra zona o ciudad, escríbemela.", "", getNaturalMenuReminderText()].join("\n");
    }
  }

  const q = extractLocationQuery(text).trim();
  if (!q) return "¿En qué región o ciudad estás? Así te muestro los puntos de venta más cercanos.";
  state.points.lastQuery = q;
  state.points.awaitingDealerOffer = false;
  const [, puntosVenta] = await Promise.all([searchDealers(q), searchPuntosVenta(q)]);

  if (!puntosVenta.length) {
    return [
      "No encontré puntos de venta con ese dato.",
      "",
      "¿Me dices otra comuna/ciudad cercana o la zona (Zona Norte / Zona Centro / Zona Sur)?",
      "",
      getNaturalMenuReminderText(),
    ].join("\n");
  }
  const blocks = puntosVenta
    .slice(0, 3)
    .map((p) => [`📍 ${p.titulo}`, p.categoria ? `   Zona: ${p.categoria}` : "", `   Dirección: ${p.direccion}`].filter(Boolean).join("\n"));

  const formatted = blocks.join("\n\n");
  state.points.awaitingDealerOffer = true;
  return [
    formatted,
    "",
    "¿Deseas que te pongamos en contacto con un dealer de su región?",
    getDealerNaturalGuidanceText(),
    "",
    "Si quieres buscar otra zona o ciudad, escríbemela.",
    "",
    getNaturalMenuReminderText(),
  ].join("\n");
}

async function handleServicioTecnico(state: UserState, text: string, userPhone: string) {
  const q = text.trim();
  const t = normalizeText(q);
  const opening = "🔧 ¡Dale! Cuéntame tu duda técnica (equipo/modelo y qué te está pasando) y lo revisamos al tiro.";
  const cta = getServiceCtaText();
  if (!q) return [opening, "", cta].join("\n");

  if (t.includes("solicit") || t.includes("agendar") || t.includes("formulario") || t.includes("contact")) {
    const producto = extractLikelyProductModel(q) || state.serviceTech?.lastProducto || "";
    return await startContactForm(state, userPhone, "cl_servicio_tecnico", producto ? { presetData: { producto } } : undefined);
  }

  state.serviceTech ??= {};
  const detected = extractLikelyProductModel(q);
  if (detected) state.serviceTech.lastProducto = detected;

  const hits = (await answerServicioTecnico(q)) ?? [];
  const ai = await minimaxServicioTecnicoAnswer({ input: q, knowledge: hits.map((h) => ({ tema: h.tema, info: h.info })) });

  const servicios = [
    "🛠️ Mantención preventiva",
    "Optimice la durabilidad de sus equipos y mejore la comunicación mediante mantenimientos preventivos anuales que incluyen ajustes de frecuencia y sensibilidad.",
    "",
    "🧰 Reparación (radios y equipos)",
    "Recupere la funcionalidad de sus radios con repuestos y accesorios originales. Nuestros especialistas utilizan herramientas de vanguardia y tecnología Motorola en la reparación.",
    "",
    "Si necesitas que te deriven:",
    "📞 Mesa Central: +56 2 3263 5550",
    "📞 SAM: +56 2 3263 5551",
    "",
    getServiceNaturalGuidanceText(),
    "",
    getNaturalMenuReminderText(),
  ].join("\n");

  if (!ai) return servicios;
  const aiNorm = normalizeText(ai);
  const alreadyHasFooter =
    aiNorm.includes("mantencion preventiva") ||
    aiNorm.includes("mantencion") ||
    aiNorm.includes("reparacion") ||
    aiNorm.includes("mesa central") ||
    aiNorm.includes("sam:");
  return alreadyHasFooter ? ai : [ai, "", servicios].join("\n");
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
  const inboundTimestampMsRaw = extractInboundTimestampMs(payload, message);
  const inboundTimestampMs = inboundTimestampMsRaw ?? Date.now();
  const inboundDedupeTimestampMs = Math.floor(inboundTimestampMs / 15000) * 15000;

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
    const replyTo = from;
    const userKey = normalizeUserKeyFrom(from);
    await ensureMessageBufferRow(userKey);
    const acquired = await tryAcquireProcessingLock(userKey);
    if (!acquired) {
      inboxAdd({ source: "gowa", signatureValid: null, from: replyTo, text: "[DEBUG] Skipping reply: lock not acquired" });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    let startedPresence = false;
    try {
      const state = (await loadUserState(userKey)) ?? initState();
      const country = detectCountryFromPhone(userKey);
      const todayKey = getCurrentDateKey();
      state.country = country;
      if (!isBranchAvailable(country, state.activeBranch)) {
        returnToCasualState(state);
      }

      if (inboundId) {
        await markMessageRead(inboundId, replyTo);
      }

      const inboundHash = crypto
        .createHash("sha256")
        .update(`${normalizeText(userKey)}|${normalizeText(inboundText)}`)
        .digest("hex")
        .slice(0, 16);
      const hashWindowMs = 20 * 1000;
      const hashKeepMs = 5 * 60 * 1000;
      const prevHashes = state.recentInboundHashes ?? [];
      const prunedHashes = prevHashes.filter((e) => Number.isFinite(e.ts) && e.ts > inboundTimestampMs - hashKeepMs);
      const isHashDuplicate = prunedHashes.some((e) => e.h === inboundHash && inboundTimestampMs - e.ts < hashWindowMs);
      state.recentInboundHashes = [{ h: inboundHash, ts: inboundTimestampMs }, ...prunedHashes.filter((e) => e.h !== inboundHash)].slice(0, 40);
      if (isHashDuplicate) {
        inboxAdd({ source: "gowa", signatureValid: null, from: userKey, text: `[DEBUG] Skipping reply: duplicate hash=${inboundHash}` });
        await saveUserState(userKey, state);
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      const derivedInboundKey = buildInboundDedupeKey(userKey, inboundText, inboundDedupeTimestampMs);
      const inboundKeys = [inboundId, derivedInboundKey].filter(Boolean) as string[];
      if (inboundKeys.some((k) => (state.recentInboundIds ?? []).includes(k))) {
        inboxAdd({
          source: "gowa",
          signatureValid: null,
          from: userKey,
          text: `[DEBUG] Skipping reply: duplicate inboundKey=${(inboundId || derivedInboundKey) ?? ""}`,
        });
        await saveUserState(userKey, state);
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      await sendChatPresence(replyTo, "start");
      startedPresence = true;

      let reply: Reply = "";
      const rawBranchIntent = detectBranchIntent(inboundText, country);
      const branchIntent =
        state.activeBranch === "catalogo" && isRentalRequest(state) && rawBranchIntent.branch === "puntos_venta"
          ? { ...rawBranchIntent, branch: null as Branch | null }
          : rawBranchIntent;
      const casualChoice = parseMenuChoice(inboundText, country) ?? classifyFreeText(inboundText, country) ?? branchIntent.branch;
      const pureGreeting = isGreetingMessage(inboundText);
      const menuShownToday = state.lastMenuDate === todayKey;

      if (!isFormLockActive(state) && pureGreeting) {
        returnToCasualState(state);
        reply = withMainMenu("", state, country, menuShownToday ? "return" : "welcome");
      } else if (!isFormLockActive(state) && !menuShownToday && !casualChoice) {
        returnToCasualState(state);
        reply = withMainMenu("", state, country, "welcome");
      } else if (isFormLockActive(state)) {
        const t0 = normalizeText(inboundText);
        const wantsNav = isMenuCommand(inboundText) || branchIntent.wantsMenu || Boolean(isNumericChoice(t0, 4));
        const wantsCancel = t0.includes("cancel");
        if (wantsNav && !wantsCancel) {
          reply = getFormInProgressText();
        } else
        if (state.contactForm) {
          reply = await handleContactForm(state, inboundText, userKey);
        } else if (state.cambium?.quote) {
          reply = await handleCambium(state, inboundText, userKey);
        } else if (state.activeBranch === "catalogo") {
          reply = country === "UY" ? await handleCatalogUY(state, inboundText, userKey) : await handleCatalog(state, inboundText, userKey);
        } else {
          reply = getFormInProgressText();
        }
      } else if (isMenuCommand(inboundText)) {
        if (state.catalog.status === "wait_finish_cotizacion") {
          reply = "Tienes una cotización en curso. ¿Quieres terminarla o cancelarla? Responde: Terminar / Cancelar.";
        } else {
          returnToCasualState(state);
          markMenuShown(state);
          reply = buildMainMenuText(country, "return");
        }
      } else {
        if (state.postCotizacion?.awaitingAction) {
          const intent = branchIntent;
          const wantsCotizarOtro = detectQuoteIntent(inboundText) || normalizeText(inboundText).includes("otra cotizacion") || normalizeText(inboundText).includes("otra cotización");

          if (state.postCotizacion.awaitingReuseConfirm) {
            const t2 = normalizeText(inboundText);
            const yes = t2 === "si" || t2 === "sí" || t2.includes("si ") || t2.includes("sí ") || t2.includes("dale") || t2.includes("ok") || t2.includes("de acuerdo");
            const no = t2 === "no" || t2.startsWith("no ");

            if (yes) {
              state.postCotizacion = undefined;
              state.catalog.forceAskAll = undefined;
              reply = await startCatalogIntentFlow(state, userKey, inboundText);
            } else if (no) {
              state.postCotizacion = undefined;
              state.catalog.forceAskAll = true;
              reply = await startCatalogIntentFlow(state, userKey, inboundText);
            } else if (intent.wantsMenu) {
              state.postCotizacion = undefined;
              returnToCasualState(state);
              markMenuShown(state);
              reply = buildMainMenuText(country, "return");
            } else if (intent.branch) {
              state.postCotizacion = undefined;
              const previous = state.activeBranch;
              state.activeBranch = intent.branch;
              resetBranchState(state, previous);
              resetBranchState(state, intent.branch);
              if (!isBranchAvailable(country, intent.branch)) {
                markMenuShown(state);
                reply = buildMainMenuText(country, "return");
              } else if (intent.branch === "catalogo") {
                reply = await startCatalogIntentFlow(state, userKey, inboundText);
              } else if (intent.branch === "proyectos") {
                reply = country === "UY" ? await handleProjectsUY(state, "", userKey) : await handleProjects(state, "", userKey);
              } else if (intent.branch === "servicio_tecnico") {
                reply = country === "UY" ? await handleServicioTecnicoUY(state, "", userKey) : await handleServicioTecnico(state, "", userKey);
              } else if (intent.branch === "cambium") {
                reply = await handleCambium(state, "", userKey);
              } else if (intent.branch === "puntos_venta") {
                reply = await handlePoints(state, "", userKey);
              } else {
                markMenuShown(state);
                reply = buildMainMenuText(country, "return");
              }
            } else {
              reply = "¿Quieres que use los datos que ya ingresaste para una nueva cotización?";
            }
          } else if (wantsCotizarOtro) {
            state.postCotizacion.awaitingReuseConfirm = true;
            reply = "Perfecto. ¿Quieres que use los datos que ya ingresaste para hacerlo más rápido?";
          } else if (intent.wantsMenu) {
            state.postCotizacion = undefined;
            returnToCasualState(state);
            markMenuShown(state);
            reply = buildMainMenuText(country, "return");
          } else if (intent.branch) {
            state.postCotizacion = undefined;
            const previous = state.activeBranch;
            state.activeBranch = intent.branch;
            resetBranchState(state, previous);
            resetBranchState(state, intent.branch);
            if (!isBranchAvailable(country, intent.branch)) {
              markMenuShown(state);
              reply = buildMainMenuText(country, "return");
            } else if (intent.branch === "catalogo") {
              reply = await startCatalogIntentFlow(state, userKey, inboundText);
            } else if (intent.branch === "proyectos") {
              reply = country === "UY" ? await handleProjectsUY(state, "", userKey) : await handleProjects(state, "", userKey);
            } else if (intent.branch === "servicio_tecnico") {
              const stInput = shouldUseServiceTechOpeningPrompt(inboundText) ? "" : inboundText;
              reply = country === "UY" ? await handleServicioTecnicoUY(state, stInput, userKey) : await handleServicioTecnico(state, stInput, userKey);
            } else if (intent.branch === "cambium") {
              reply = await handleCambium(state, "", userKey);
            } else if (intent.branch === "puntos_venta") {
              reply = await handlePoints(state, "", userKey);
            } else {
              markMenuShown(state);
              reply = buildMainMenuText(country, "return");
            }
          } else {
            reply =
              country === "UY"
                ? "Seguimos por aquí. Si quieres, puedo ayudarte con otra cotización, proyectos, servicio técnico o soluciones Cambium."
                : "Seguimos por aquí. Si quieres, puedo ayudarte con otra cotización, arriendo o compra de equipos, proyectos, servicio técnico o puntos de venta.";
          }
        } else
        if (state.activeBranch === "menu") {
          if (detectQuoteIntent(inboundText)) {
            reply = await startCatalogIntentFlow(state, userKey, inboundText);
          } else {
          const choice = casualChoice;
          if (choice) {
            state.activeBranch = choice;
            resetBranchState(state, choice);
            if (!isBranchAvailable(country, choice)) {
              state.activeBranch = "menu";
              markMenuShown(state);
              reply = buildMainMenuText(country, "return");
            } else if (choice === "catalogo") {
              reply = await startCatalogIntentFlow(state, userKey, inboundText);
            } else if (choice === "servicio_tecnico") {
              const stInput = shouldUseServiceTechOpeningPrompt(inboundText) ? "" : inboundText;
              reply = country === "UY" ? await handleServicioTecnicoUY(state, stInput, userKey) : await handleServicioTecnico(state, stInput, userKey);
            } else if (choice === "proyectos") {
              reply = country === "UY" ? await handleProjectsUY(state, "", userKey) : await handleProjects(state, "", userKey);
            } else if (choice === "cambium") {
              reply = await handleCambium(state, "", userKey);
            } else if (choice === "puntos_venta") {
              reply = await handlePoints(state, "", userKey);
            } else {
              markMenuShown(state);
              reply = buildMainMenuText(country, "return");
            }
          } else {
            const msg = await minimaxRewrite({
              kind: "fuera_menu",
              input: inboundText,
              facts:
                country === "UY"
                  ? [
                      "Te leo.",
                      "Puedo ayudarte con compra de equipos y accesorios, servicio técnico, proyectos y soluciones Cambium.",
                      "Cuéntame qué necesitas y te oriento.",
                    ]
                  : [
                      "Te leo.",
                      "Puedo ayudarte con compra o arriendo de equipos, servicio técnico, proyectos y puntos de venta.",
                      "Cuéntame qué necesitas y te oriento.",
                    ],
            });
            reply = msg;
          }
          }
        } else {
          if (detectQuoteIntent(inboundText) && state.activeBranch !== "catalogo") {
            if (state.catalog.status === "wait_finish_cotizacion") {
              reply = "Tienes una cotización en curso. ¿Quieres terminarla o cancelarla? Responde: Terminar / Cancelar.";
            } else {
              reply = await startCatalogIntentFlow(state, userKey, inboundText);
            }
          } else {
          const intent = detectBranchIntent(inboundText, country);
          if (intent.branch && intent.branch !== state.activeBranch) {
            if (state.catalog.status === "wait_finish_cotizacion") {
              reply = "Tienes una cotización en curso. ¿Quieres terminarla o cancelarla? Responde: Terminar / Cancelar.";
            } else {
              const previous = state.activeBranch;
              state.activeBranch = intent.branch;
              resetBranchState(state, previous);
              resetBranchState(state, intent.branch);
              if (!isBranchAvailable(country, intent.branch)) {
                returnToCasualState(state);
                markMenuShown(state);
                reply = buildMainMenuText(country, "return");
              } else if (intent.branch === "catalogo") {
                reply = await startCatalogIntentFlow(state, userKey, inboundText);
              } else if (intent.branch === "proyectos") {
                reply = country === "UY" ? await handleProjectsUY(state, "", userKey) : await handleProjects(state, "", userKey);
              } else if (intent.branch === "servicio_tecnico") {
                const stInput = shouldUseServiceTechOpeningPrompt(inboundText) ? "" : inboundText;
                reply = country === "UY" ? await handleServicioTecnicoUY(state, stInput, userKey) : await handleServicioTecnico(state, stInput, userKey);
              } else if (intent.branch === "cambium") {
                reply = await handleCambium(state, "", userKey);
              } else if (intent.branch === "puntos_venta") {
                reply = await handlePoints(state, "", userKey);
              } else {
                markMenuShown(state);
                reply = buildMainMenuText(country, "return");
              }
            }
          } else if (intent.branch && intent.branch === state.activeBranch && state.activeBranch === "proyectos") {
            reply = country === "UY" ? await handleProjectsUY(state, inboundText, userKey) : await handleProjects(state, inboundText, userKey);
          } else {
          if (state.activeBranch === "catalogo") {
            reply = country === "UY" ? await handleCatalogUY(state, inboundText, userKey) : await handleCatalog(state, inboundText, userKey);
          } else if (state.activeBranch === "proyectos") {
            reply = country === "UY" ? await handleProjectsUY(state, inboundText, userKey) : await handleProjects(state, inboundText, userKey);
          } else if (state.activeBranch === "puntos_venta") {
            if (country === "UY") {
              markMenuShown(state);
              reply = buildMainMenuText(country, "return");
            } else {
              reply = await handlePoints(state, inboundText, userKey);
            }
          } else if (state.activeBranch === "servicio_tecnico") {
            reply = country === "UY" ? await handleServicioTecnicoUY(state, inboundText, userKey) : await handleServicioTecnico(state, inboundText, userKey);
          } else if (state.activeBranch === "cambium") {
            reply = await handleCambium(state, inboundText, userKey);
          } else {
            returnToCasualState(state);
            markMenuShown(state);
            reply = buildMainMenuText(country, "return");
          }
          }
          }
        }
      }

      {
        const prev = state.recentInboundIds ?? [];
        const toAdd = inboundKeys.length ? inboundKeys : [derivedInboundKey];
        const keep = prev.filter((x) => !toAdd.includes(x));
        state.recentInboundIds = [...toAdd, ...keep].slice(0, 25);
      }

      await saveUserState(userKey, state);
      const messages = Array.isArray(reply) ? reply : [reply];
      const hasProductFicha =
        messages.some((m) => m && typeof m === "object" && "type" in m && (m as OutboundMessage).type === "image") ||
        messages.some((m) => typeof m === "string" && (m.includes("📄 Ficha técnica") || m.includes("💰 Precio") || m.includes("¿Qué deseas hacer ahora?")));
      if (hasProductFicha) await sleep(700);
      for (const m of messages) {
        if (typeof m === "string") {
          const msg = m.trim();
          if (msg) await sendTextMessage(from, msg);
          continue;
        }
        if (m && typeof m === "object") {
          if (m.type === "text") {
            const msg = String(m.text ?? "").trim();
            if (msg) await sendTextMessage(from, msg);
          } else if (m.type === "image") {
            const url = String(m.imageUrl ?? "").trim();
            if (url) await sendImageMessage(from, url, m.caption);
          }
        }
      }
    } finally {
      if (startedPresence) {
        await sendChatPresence(replyTo, "stop");
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
