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

type SheetsLeadRow = {
  fecha: string;
  country: Country;
  flowKey: string;
  flowLabel: string;
  userPhone: string;
  nombre: string;
  empresa: string;
  telefono: string;
  email: string;
  direccion: string;
  producto: string;
  mensaje: string;
  ciudad: string;
};

let googleSheetsTokenCache: { token: string; expMs: number } | null = null;

function getGoogleSheetsClientEmail() {
  return String(process.env.GSHEETS_CLIENT_EMAIL ?? "").trim();
}

function getGoogleSheetsPrivateKey() {
  const raw = String(process.env.GSHEETS_PRIVATE_KEY ?? "").trim();
  return raw ? raw.replace(/\\n/g, "\n") : "";
}

function base64UrlEncode(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function googleJwtSign(payload: Record<string, unknown>, privateKeyPem: string) {
  const header = { alg: "RS256", typ: "JWT" };
  const part1 = base64UrlEncode(JSON.stringify(header));
  const part2 = base64UrlEncode(JSON.stringify(payload));
  const data = `${part1}.${part2}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const sig = signer.sign(privateKeyPem);
  return `${data}.${base64UrlEncode(sig)}`;
}

async function getGoogleSheetsAccessToken() {
  const now = Date.now();
  if (googleSheetsTokenCache && googleSheetsTokenCache.expMs - 30_000 > now) {
    return googleSheetsTokenCache.token;
  }
  const email = getGoogleSheetsClientEmail();
  const key = getGoogleSheetsPrivateKey();
  if (!email || !key) return "";
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const assertion = googleJwtSign(
    {
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp,
    },
    key,
  );
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  const token = typeof (data as Record<string, unknown>)?.access_token === "string" ? ((data as Record<string, unknown>).access_token as string) : "";
  const expiresIn = Number((data as Record<string, unknown>)?.expires_in ?? 0);
  if (!token) {
    inboxAdd({ source: "gowa", signatureValid: null, from: "", text: `[DEBUG] sheets token failed status=${res.status}` });
    return "";
  }
  googleSheetsTokenCache = { token, expMs: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600_000) };
  return token;
}

function getSheetTabName() {
  return (process.env.GSHEETS_TAB_NAME ?? "Whatsapp Leads").trim() || "Whatsapp Leads";
}

function resolveSheetsTarget(country: Country, flowKey: string) {
  const tab = getSheetTabName();
  if (country === "UY") {
    const spreadsheetId =
      (process.env.GSHEET_UY_ID ?? "").trim() || "1cc7sxuaf6aCEXxT1S9b4f3zHQvzfYuAqPmwVmdkINog";
    return spreadsheetId ? { spreadsheetId, tab } : null;
  }
  const key = normalizeText(flowKey);
  if (key.includes("servicio") || key.includes("sam")) {
    const spreadsheetId = (process.env.GSHEET_CL_SAM_ID ?? "").trim() || "17boi45yM9hZtnEAg3-YsKrbdi7-OVvuuD4tJVrapyEg";
    return spreadsheetId ? { spreadsheetId, tab } : null;
  }
  if (key.includes("arriendo")) {
    const spreadsheetId = (process.env.GSHEET_CL_ARRIENDO_ID ?? "").trim() || "1yUIwrMQ8DZZ12Z5nH45JBQOXhdr1GKHMbdCSit757nQ";
    return spreadsheetId ? { spreadsheetId, tab } : null;
  }
  if (key.includes("proyectos")) {
    const spreadsheetId = (process.env.GSHEET_CL_PROYECTOS_ID ?? "").trim() || "1RcRwH0TVZAl22zrO7ugF_I-AR8qpCLyhiJffggC58l4";
    return spreadsheetId ? { spreadsheetId, tab } : null;
  }
  const spreadsheetId = (process.env.GSHEET_CL_COMPRAS_ID ?? "").trim() || "1WKR_sctuGrxe_6ImpAyDeTnjtCOtE9zFNQdocRNHXvs";
  return spreadsheetId ? { spreadsheetId, tab } : null;
}

async function appendLeadToGoogleSheet(row: SheetsLeadRow) {
  const email = getGoogleSheetsClientEmail();
  const key = getGoogleSheetsPrivateKey();
  if (!email || !key) return;
  const target = resolveSheetsTarget(row.country, row.flowKey);
  if (!target) return;
  const token = await getGoogleSheetsAccessToken();
  if (!token) return;
  const values = [
    row.nombre,
    row.empresa,
    row.telefono,
    row.email,
    row.direccion,
    row.producto,
    row.mensaje,
    row.ciudad,
    row.fecha,
  ];
  const range = encodeURIComponent(`${target.tab}!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(target.spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [values] }),
  });
  if (!res.ok) {
    inboxAdd({ source: "gowa", signatureValid: null, from: row.userPhone, text: `[DEBUG] sheets append failed status=${res.status}` });
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(undefined as T), ms);
  });
  const result = await Promise.race([promise, timeout]);
  if (timeoutId) clearTimeout(timeoutId);
  return result;
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
  returnList?: Array<{ product_id: string; nombre: string }>;
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
  arriendoPriceMenuActive?: boolean;
  recommended?: {
    mode?: "offer" | "list" | "detail";
    remainingIds: string[];
    includedIds: string[];
    rejectedIds: string[];
    currentId?: string;
  };
  leadContext?: Partial<{
    quantity: number;
    brand: string;
    location: string;
    categoryKey: "equipos_radio" | "accesorio_radio" | "camara_corporal";
    portabilidadHint: "portatil" | "movil" | "repetidor";
    frequencyBand: "VHF" | "UHF";
    technologyHint: "DIGITAL" | "ANALOGO";
  }>;
  adviceContext?: {
    mode: "recommend" | "compare";
    lastInput: string;
    referencedNumbers?: number[];
    awaitingUsageContext?: boolean;
  };
};

type ProjectsState = {
  stage: "entry" | "browse";
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

type ContactFormKind =
  | "cl_compra_asesoria"
  | "cl_proyectos"
  | "cl_dealer"
  | "cl_servicio_tecnico"
  | "cl_arriendo_precio"
  | "uy_compra_asesoria"
  | "uy_proyectos"
  | "uy_servicio_tecnico";

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
    subtipo: string;
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
    mode?: "submenu" | "chat";
    requestType?: "mantencion_preventiva" | "reparacion";
    lastProducto?: string;
    lastQuestionHash?: string;
    lastQuestionAt?: number;
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

function getCambiumQuoteStep(data: CambiumQuote["data"]): CambiumQuoteStep {
  if (!data.nombre) return "nombre";
  if (!data.empresa) return "empresa";
  if (!data.telefono) return "telefono";
  if (!data.solucion) return "solucion";
  if (!data.email) return "email";
  if (!data.direccion) return "direccion";
  return "final";
}

function getCambiumStepPrompt(step: Exclude<CambiumQuoteStep, "final">) {
  if (step === "nombre") return "Indícame tu nombre y apellido.";
  if (step === "empresa") return "¿Para qué empresa es la solicitud?";
  if (step === "telefono") return buildPhonePrompt("UY", "¿Teléfono?");
  if (step === "solucion") {
    const opts = ["ePMP", "Punto a Punto", "Punto a multipunto", "Aplicaciones de Software", "Accesorios de Banda Ancha"];
    return ["¿Cuál de estas soluciones te interesa?", "", ...opts.map((o, i) => `${i + 1}) ${o}`)].join("\n");
  }
  if (step === "email") return buildEmailPrompt("UY", "¿Correo?");
  return "¿Cuál es tu dirección o referencia de ubicación?";
}

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
}

function getAiApiKey() {
  return process.env.AI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? process.env.MINIMAX_API_KEY ?? "";
}

function getAiBaseUrl() {
  return (
    process.env.AI_BASE_URL ??
    process.env.DEEPSEEK_BASE_URL ??
    process.env.MINIMAX_BASE_URL ??
    "https://opencode.ai/zen/go/v1/chat/completions"
  ).replace(/\/+$/, "");
}

function getAiChatCompletionsUrl() {
  const baseUrl = getAiBaseUrl();
  return /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
}

function getAiModel() {
  return process.env.AI_MODEL ?? process.env.DEEPSEEK_MODEL ?? "DeepSeek V4 Flash";
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

function sanitizeInboundWebsitePrefill(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  const normalized = normalizeText(raw)
    .replace(/[^a-z0-9\s:/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return raw;

  const hasGreeting =
    normalized.startsWith("hola") ||
    normalized.startsWith("buenas") ||
    normalized.startsWith("buen dia") ||
    normalized.startsWith("buenos dias") ||
    normalized.startsWith("buenas tardes") ||
    normalized.startsWith("buenas noches");
  const hasPrefillIntent =
    normalized.includes("necesito mas informacion") ||
    normalized.includes("quiero mas informacion") ||
    normalized.includes("deseo mas informacion") ||
    normalized.includes("mas informacion sobre");
  const hasSiteLink =
    /https?:\/\/\S+/i.test(raw) ||
    normalized.includes("www.interwins.cl") ||
    normalized.includes("interwins.cl") ||
    normalized.includes("interwins.com.uy");
  const looksLikeWidgetPrefill =
    hasGreeting &&
    hasPrefillIntent &&
    hasSiteLink &&
    (normalized.includes("interwins") || normalized.includes("motorola") || normalized.includes("equipos radiocomunicaciones"));

  if (looksLikeWidgetPrefill) return "Hola";

  const withoutLinks = raw.replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim();
  return withoutLinks || raw;
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

function isLocationSupportIntent(text: string, country: Country) {
  if (country === "UY") return false;
  const t = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  return (
    t.includes("donde estan") ||
    t.includes("donde queda") ||
    t.includes("ubicados") ||
    t.includes("ubicacion") ||
    t.includes("direccion") ||
    t.includes("direcciones") ||
    t.includes("atienden en") ||
    t.includes("atienden cerca") ||
    t.includes("punto de venta") ||
    t.includes("puntos de venta") ||
    t.includes("sucursal") ||
    t.includes("sucursales")
  );
}

const SUPPORTED_COMMERCIAL_HINTS = ["radio", "radios", "repetidor", "repetidores", "accesorio", "accesorios", "camara corporal", "bodycam"];
const COMMERCIAL_ROUTE_HINTS = [
  "compra",
  "comprar",
  "cotizacion",
  "cotización",
  "cotizar",
  "arriendo",
  "arrendar",
  "alquilar",
  "servicio tecnico",
  "servicio técnico",
  "soporte",
  "proyectos",
  "proyecto",
  "punto de venta",
  "puntos de venta",
  "dealer",
  "dealers",
  "direccion",
  "dirección",
  "ubicacion",
  "ubicación",
  "menu",
  "menú",
  "ayuda",
  "informacion",
  "información",
];

function cleanCommercialCandidateLabel(raw: string) {
  return String(raw ?? "")
    .trim()
    .replace(/^[¿?¡!.,;:()\[\]\-_\s]+|[¿?¡!.,;:()\[\]\-_\s]+$/g, "")
    .replace(/^(?:un|una|unos|unas|el|la|los|las)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCommercialCandidateLabel(raw: string) {
  return normalizeText(cleanCommercialCandidateLabel(raw))
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractGenericCommercialProductLabel(text: string) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const normalized = normalizeText(raw)
    .replace(/[^a-z0-9\s?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const patterns = [
    /^(?:tiene|tienes|tienen|venden|vende|ofrecen|ofrece|manejan|maneja|comercializan|comercializa|hay)\s+(.+?)\??$/,
    /^(?:trabajan con)\s+(.+?)\??$/,
    /^(?:quiero saber si\s+(?:tiene|tienes|tienen|venden|vende|ofrecen|ofrece|manejan|maneja|hay))\s+(.+?)\??$/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const label = cleanCommercialCandidateLabel(match[1]);
    const labelNorm = normalizeCommercialCandidateLabel(label);
    if (!labelNorm) continue;
    if (labelNorm.split(" ").length > 4) continue;
    if (SUPPORTED_COMMERCIAL_HINTS.some((hint) => labelNorm.includes(normalizeText(hint)))) return "";
    if (COMMERCIAL_ROUTE_HINTS.some((hint) => labelNorm.includes(normalizeText(hint)))) return "";
    return label;
  }

  return "";
}

function extractUnsupportedCommercialProduct(text: string) {
  const t = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  if (SUPPORTED_COMMERCIAL_HINTS.some((hint) => t.includes(hint))) return "";
  const unsupportedGroups = [
    { label: "teléfonos celulares", terms: ["celular", "celulares", "telefono celular", "telefonos celulares", "smartphone", "smartphones", "iphone"] },
    { label: "tablets", terms: ["tablet", "tablets", "ipad"] },
    { label: "notebooks o laptops", terms: ["notebook", "notebooks", "laptop", "laptops"] },
  ];
  const hasCommercialContext =
    detectQuoteIntent(text) ||
    isRentalIntent(text) ||
    t.includes("venden") ||
    t.includes("vende") ||
    t.includes("vender") ||
    t.includes("tienen") ||
    t.includes("tiene") ||
    t.includes("tienes") ||
    t.includes("hay") ||
    t.includes("disponible") ||
    t.includes("disponibilidad") ||
    t.includes("ofrecen") ||
    t.includes("ofrece") ||
    t.includes("manejan") ||
    t.includes("maneja") ||
    t.includes("comercializan") ||
    t.includes("comercializa") ||
    t.includes("trabajan con") ||
    t.includes("busco") ||
    t.includes("necesito") ||
    t.includes("quiero");

  const isQuestionLike =
    /\?\s*$/.test(String(text ?? "").trim()) ||
    t.startsWith("tiene ") ||
    t.startsWith("tienes ") ||
    t.startsWith("tienen ") ||
    t.startsWith("hay ");

  if (!(hasCommercialContext || isQuestionLike)) return "";

  const explicitLabel = unsupportedGroups.find((group) => group.terms.some((term) => t.includes(normalizeText(term))))?.label ?? "";
  if (explicitLabel) return explicitLabel;

  return extractGenericCommercialProductLabel(text);
}

function buildUnsupportedCommercialReply(country: Country, productLabel: string) {
  const introOptions =
    country === "UY"
      ? [
          `No, por ahora no trabajamos con ${productLabel}.`,
          `Actualmente no comercializamos ${productLabel}.`,
          `En este momento no manejamos ${productLabel}.`,
        ]
      : [
          `No, por ahora no trabajamos con ${productLabel}.`,
          `Actualmente no comercializamos ${productLabel}.`,
          `En este momento no manejamos ${productLabel}.`,
        ];
  const intro = introOptions[crypto.randomInt(0, introOptions.length)]!;
  const focus =
    country === "UY"
      ? "Nuestro portafolio en Uruguay está enfocado en radiocomunicación profesional, servicio técnico, proyectos y soluciones Cambium."
      : "Nuestro catálogo está enfocado en soluciones de radiocomunicación profesional, como radios portátiles, móviles, repetidores, accesorios, cámaras corporales y servicios asociados.";
  const guidance =
    country === "UY"
      ? "Si quieres, puedo orientarte con compra de equipos, servicio técnico, proyectos o soluciones Cambium."
      : "Si quieres, puedo orientarte con compra o arriendo de equipos, servicio técnico, proyectos o puntos de venta.";
  return [intro, focus, guidance].join("\n");
}

async function buildUnsupportedCommercialReplyDynamic(country: Country, productLabel: string, input: string) {
  const facts =
    country === "UY"
      ? [
          `No comercializamos ${productLabel}.`,
          "Nuestro portafolio en Uruguay está orientado a radiocomunicación profesional, servicio técnico, proyectos y soluciones Cambium.",
          "Si lo deseas, puedo orientarte con compra de equipos, servicio técnico, proyectos o soluciones Cambium.",
        ]
      : [
          `No comercializamos ${productLabel}.`,
          "Nuestro portafolio está orientado a radiocomunicación profesional, incluyendo radios portátiles, radios móviles, repetidores, accesorios, cámaras corporales y servicios asociados.",
          "Si lo deseas, puedo orientarte con compra o arriendo de equipos, servicio técnico, proyectos o puntos de venta.",
        ];
  const rewritten = await generateAiRewrite({
    kind: "fuera_menu",
    input,
    facts,
  });
  return rewritten || buildUnsupportedCommercialReply(country, productLabel);
}

type OpenBusinessOverviewKind = "productos" | "servicios" | "general" | "marca" | "empresa";

function isQuestionLikeCommercialText(text: string) {
  const raw = String(text ?? "").trim();
  const t = normalizeText(raw)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  return (
    /\?\s*$/.test(raw) ||
    t.startsWith("que ") ||
    t.startsWith("qué ") ||
    t.startsWith("como ") ||
    t.startsWith("cómo ") ||
    t.startsWith("tienen ") ||
    t.startsWith("tiene ") ||
    t.startsWith("trabajan ") ||
    t.startsWith("manejan ") ||
    t.startsWith("ofrecen ")
  );
}

function detectOpenBusinessOverviewIntent(text: string): OpenBusinessOverviewKind | null {
  const t = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;

  const asksProducts =
    t.includes("que productos") ||
    t.includes("qué productos") ||
    t.includes("tipo de productos") ||
    t.includes("tipos de productos") ||
    t.includes("que venden") ||
    t.includes("qué venden") ||
    t.includes("que manejan") ||
    t.includes("qué manejan") ||
    t.includes("que ofrecen") ||
    t.includes("qué ofrecen") ||
    t.includes("que equipos") ||
    t.includes("qué equipos") ||
    t.includes("catalogo") ||
    t.includes("catálogo");

  const asksServices =
    t.includes("que servicios") ||
    t.includes("qué servicios") ||
    t.includes("servicios tienen") ||
    t.includes("servicios ofrecen") ||
    t.includes("en que ayudan") ||
    t.includes("en qué ayudan") ||
    t.includes("que hacen") ||
    t.includes("qué hacen");

  const asksGeneral =
    t.includes("que tienen") ||
    t.includes("qué tienen") ||
    t.includes("a que se dedican") ||
    t.includes("a qué se dedican") ||
    t.includes("como me pueden ayudar") ||
    t.includes("cómo me pueden ayudar");
  const asksCompany =
    t.includes("que es interwins") ||
    t.includes("qué es interwins") ||
    t.includes("quien es interwins") ||
    t.includes("quién es interwins") ||
    t.includes("quienes son") ||
    t.includes("quiénes son") ||
    t.includes("informacion de interwins") ||
    t.includes("información de interwins") ||
    t.includes("sobre interwins") ||
    t.includes("empresa interwins") ||
    t.includes("interwins que hace") ||
    t.includes("interwins qué hace") ||
    t.includes("a que se dedica interwins") ||
    t.includes("a qué se dedica interwins");
  const asksBrand =
    Boolean(extractBrandHint(text)) &&
    (isQuestionLikeCommercialText(text) ||
      t.includes("trabajan con") ||
      t.includes("manejan") ||
      t.includes("tienen") ||
      t.includes("ofrecen"));

  if (asksCompany) return "empresa";
  if (asksBrand) return "marca";
  if (asksProducts) return "productos";
  if (asksServices) return "servicios";
  if (asksGeneral) return "general";
  return null;
}

function getOpenBusinessOverviewFacts(country: Country, kind: OpenBusinessOverviewKind, input: string) {
  const brand = extractBrandHint(input);
  if (country === "UY") {
    if (kind === "marca") {
      return [
        brand ? `Sí, podemos orientarte con soluciones asociadas a ${brand} dentro de nuestro portafolio.` : "Sí, trabajamos con distintas soluciones de radiocomunicación profesional.",
        "Podemos ayudarte con equipos de radio, accesorios y soluciones de conectividad empresarial.",
        "Si quieres avanzar ahora, responde Compra y te ayudo a cotizar según el equipo o modelo que necesitas.",
        "Si necesitas servicio técnico, proyectos o soluciones Cambium, también puedes escribir directamente esa opción y te llevo por esa ruta.",
      ];
    }
    if (kind === "productos") {
      return [
        "Sí, trabajamos con soluciones de radiocomunicación profesional.",
        "Podemos orientarte en equipos de radio, accesorios y soluciones de conectividad empresarial.",
        "Si quieres avanzar ahora, responde Compra y te ayudo a cotizar según el equipo o modelo que necesitas.",
        "Si necesitas servicio técnico, proyectos o soluciones Cambium, también puedes escribir directamente esa opción y te llevo por esa ruta.",
      ];
    }
    if (kind === "servicios") {
      return [
        "Podemos ayudarte con compra de equipos, servicio técnico, proyectos y soluciones Cambium en Uruguay.",
        "Si quieres avanzar ahora, escribe Compra, Servicio técnico, Proyectos o Cambium y continúo por esa ruta.",
      ];
    }
    return [
      "Podemos ayudarte con radiocomunicación profesional, servicio técnico, proyectos y soluciones Cambium en Uruguay.",
      "Si quieres avanzar ahora, escribe Compra, Servicio técnico, Proyectos o Cambium y continúo por esa ruta.",
    ];
  }

  if (kind === "marca") {
    return [
      brand ? `Sí, podemos orientarte con soluciones asociadas a ${brand} dentro de nuestro portafolio.` : "Sí, trabajamos con soluciones de radiocomunicación profesional.",
      "Contamos con radios portátiles, radios móviles, repetidores, accesorios y cámaras corporales.",
      "Si quieres avanzar ahora, responde Compra para cotizar o Arriendo para revisar disponibilidad temporal.",
      "Si necesitas servicio técnico, proyectos o puntos de venta, también puedes escribir directamente esa opción y te llevo por esa ruta.",
    ];
  }
  if (kind === "productos") {
    return [
      "Sí, contamos con soluciones de radiocomunicación profesional.",
      "Trabajamos con radios portátiles, radios móviles, repetidores, accesorios y cámaras corporales.",
      "Si quieres avanzar ahora, responde Compra para cotizar o Arriendo para revisar disponibilidad temporal.",
      "Si necesitas servicio técnico, proyectos o puntos de venta, también puedes escribir directamente esa opción y te llevo por esa ruta.",
    ];
  }
  if (kind === "servicios") {
    return [
      "Podemos ayudarte con compra de equipos, arriendo, servicio técnico, asesoría en proyectos y puntos de venta.",
      "Si quieres avanzar ahora, escribe Compra, Arriendo, Servicio técnico, Proyectos o Puntos de venta y continúo por esa ruta.",
    ];
  }
  return [
    "Podemos ayudarte con soluciones de radiocomunicación profesional y servicios asociados.",
    "Trabajamos con equipos, accesorios, cámaras corporales, servicio técnico, proyectos y puntos de venta.",
    "Si quieres avanzar ahora, escribe Compra, Arriendo, Servicio técnico, Proyectos o Puntos de venta y continúo por esa ruta.",
  ];
}

async function buildOpenBusinessOverviewReply(country: Country, input: string) {
  const kind = detectOpenBusinessOverviewIntent(input);
  if (!kind) return "";
  if (kind === "empresa") {
    const content = await loadManagedSectionContent("empresa", country);
    const knowledgeText = [content.openingText, normalizeInstitutionalKnowledgeText(content.knowledgeText)].filter(Boolean).join("\n\n");
    const ai = await generateKnowledgeAiAnswer({ role: "empresa", input, knowledgeText });
    if (ai) return ai;
    return [
      content.openingText,
      country === "UY"
        ? "Si quieres, también puedo orientarte con compra de equipos, proyectos, servicio técnico o soluciones Cambium."
        : "Si quieres, también puedo orientarte con compra o arriendo de equipos, proyectos, servicio técnico o puntos de venta.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  const facts = getOpenBusinessOverviewFacts(country, kind, input);
  return await generateAiRewrite({
    kind: "fuera_menu",
    input,
    facts,
  });
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

function escapeRegexLiteral(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CHOICE_NUMBER_WORDS: Record<number, string[]> = {
  1: ["uno", "primero", "primera"],
  2: ["dos", "segundo", "segunda"],
  3: ["tres", "tercero", "tercera"],
  4: ["cuatro", "cuarto", "cuarta"],
  5: ["cinco", "quinto", "quinta"],
  6: ["seis", "sexto", "sexta"],
  7: ["siete", "septimo", "septima"],
  8: ["ocho", "octavo", "octava"],
};

function extractChoiceNumberFromText(text: string, max: number) {
  if (!text) return null as number | null;
  const normalized = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  const m = normalized.match(/\b(\d{1,2})\b/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= max) return n;
  }
  const hasSelectionContext =
    /(?:^| )(?:opcion|numero|nro|alternativa|elijo|escojo|escogo|selecciono|seleccion|prefiero|quiero|voy con|me interesa|tomo|la)(?: |$)/.test(
      normalized,
    ) || normalized.split(" ").length <= 2;
  if (!hasSelectionContext) return null;
  for (let choice = 1; choice <= max; choice += 1) {
    const words = CHOICE_NUMBER_WORDS[choice] ?? [];
    if (!words.length) continue;
    if (words.some((word) => normalized === word)) return choice;
    const wordPattern = words.map(escapeRegexLiteral).join("|");
    if (new RegExp(`\\b(?:${wordPattern})\\b`).test(normalized)) return choice;
  }
  return null;
}

const CATALOG_MAX_LIST_ITEMS = 8;

function encodeIlikePattern(pattern: string) {
  return pattern
    .split("*")
    .map((part) => encodeURIComponent(part))
    .join("*");
}

function buildCatalogNameSearchPatterns(query: string) {
  const compact = normalizeText(query).replace(/[^a-z0-9]+/g, "");
  if (compact.length < 2) return [];
  const withStars = compact.replace(/([a-z])(\d)/g, "$1*$2").replace(/(\d)([a-z])/g, "$1*$2");
  const patterns = [`*${compact}*`];
  if (withStars !== compact) patterns.push(`*${withStars}*`);
  return Array.from(new Set(patterns));
}

function detectFrequencyBandsFromText(freq: string): Array<"VHF" | "UHF"> {
  const raw = toLooseText(freq);
  if (!raw) return [];
  const t = normalizeText(raw);
  const bands: Array<"VHF" | "UHF"> = [];
  if (t.includes("uhf")) bands.push("UHF");
  if (t.includes("vhf")) bands.push("VHF");
  if (bands.length) return Array.from(new Set(bands));
  const nums = raw.match(/\d{2,4}/g) || [];
  if (!nums.length) return [];
  const n = Number(nums[0]);
  if (!Number.isFinite(n)) return [];
  if (n >= 100 && n < 250) return ["VHF"];
  if (n >= 300 && n <= 900) return ["UHF"];
  return [];
}

function detectFrequencyBandFromText(freq: string) {
  const bands = detectFrequencyBandsFromText(freq);
  if (bands.length === 1) return bands[0]!;
  return "" as "" | "VHF" | "UHF";
}

function matchesSelectedFrequencyBand(value: string, selected?: string) {
  const wanted = normalizeText(selected ?? "");
  if (!wanted) return true;
  if (wanted === "vhf") return detectFrequencyBandsFromText(value).includes("VHF");
  if (wanted === "uhf") return detectFrequencyBandsFromText(value).includes("UHF");
  return normalizeText(value).includes(wanted);
}

function compactCatalogModelText(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function extractCatalogModelQuery(text: string) {
  const t = normalizeText(text);
  if (!t) return "";
  const tokens = t
    .split(/[^a-z0-9]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  const banned = new Set([
    "y",
    "no",
    "si",
    "sí",
    "tiene",
    "tienen",
    "tendran",
    "tendrán",
    "hay",
    "modelo",
    "equipo",
    "equipos",
    "radio",
    "arriendo",
    "arrendar",
    "cotizar",
    "cotizacion",
    "cotización",
    "precio",
    "stock",
    "finalizar",
    "finalizo",
    "terminar",
    "termino",
    "conversacion",
    "conversación",
    "menu",
    "menú",
    "volver",
    "lista",
  ]);
  const filtered = tokens.filter((x) => ((/\d/.test(x) && x.length >= 2) || x.length >= 3) && !banned.has(x));
  for (let i = 0; i < filtered.length - 1; i += 1) {
    const current = filtered[i]!;
    const next = filtered[i + 1]!;
    if (/^[a-z]{2,}$/.test(current) && /^\d{1,4}[a-z]?$/.test(next)) {
      return `${current}${next}`;
    }
  }
  const withDigits = filtered.find((x) => /\d/.test(x));
  if (withDigits) return withDigits;
  return "";
}

function isDirectCatalogLookupIntent(text: string) {
  const modelQuery = extractCatalogModelQuery(text);
  if (!modelQuery) return false;
  const t = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  const hasServiceContext =
    t.includes("repar") ||
    t.includes("falla") ||
    t.includes("mantencion") ||
    t.includes("mantención") ||
    t.includes("servicio tecnico") ||
    t.includes("servicio técnico") ||
    t.includes("soporte tecnico") ||
    t.includes("soporte técnico");
  if (hasServiceContext) return false;
  const hasAvailabilityContext =
    t.includes("tienen") ||
    t.includes("tiene") ||
    t.includes("hay") ||
    t.includes("manejan") ||
    t.includes("ofrecen") ||
    t.includes("disponible") ||
    t.includes("disponibilidad") ||
    t.includes("busco") ||
    t.includes("buscando") ||
    t.includes("necesito") ||
    t.includes("quiero") ||
    t.includes("me interesa");
  const compactText = compactCatalogModelText(t);
  const compactModel = compactCatalogModelText(modelQuery);
  const hasGreetingAndModel =
    (t.startsWith("hola ") || t.startsWith("buenas ") || t.startsWith("buen dia ") || t.startsWith("buenos dias ")) &&
    compactModel.length >= 4 &&
    compactText.includes(compactModel);
  return (
    detectQuoteIntent(text) ||
    isQuestionLikeCommercialText(text) ||
    hasAvailabilityContext ||
    hasGreetingAndModel ||
    t.includes("ficha") ||
    t.includes("detalle") ||
    t.includes("especificacion") ||
    t.includes("especificación") ||
    t.includes("caracteristica") ||
    t.includes("características") ||
    t.includes("caracteristicas") ||
    t.includes("informacion") ||
    t.includes("información") ||
    t.includes("producto") ||
    t.includes("modelo") ||
    t.includes("equipo") ||
    t.includes("equipos") ||
    t.includes("venden") ||
    t.includes("vende")
  );
}

type ProductDetail = {
  productId: string;
  nombre: string;
  shortFinal?: string;
  fullDescription?: string;
  imageUrl?: string;
  fichaUrl?: string;
  precio?: string;
};

function buildProductsListMessage(products: Array<{ product_id: string; nombre: string }>, example: string) {
  const lines = products
    .slice(0, CATALOG_MAX_LIST_ITEMS)
    .map((p, i) => `${i + 1}) ${cleanProductName(p.nombre)}`)
    .join("\n");
  return [
    `Estos son los que encontré (máx. ${CATALOG_MAX_LIST_ITEMS}):`,
    "",
    lines,
    "",
    `Indícame qué opción quieres para mostrarte su ficha. También puedes decir el nombre (ej: ${example}).`,
    "Si quieres, también puedo recomendarte una alternativa o resumirte las diferencias entre estos modelos.",
  ].join("\n");
}

function buildUnsupportedProductInActiveListReply(
  country: Country,
  productLabel: string,
  products: Array<{ product_id: string; nombre: string }>,
) {
  const intro =
    country === "UY"
      ? `No trabajamos con ese tipo de producto: ${productLabel}. Puedes continuar con este proceso y escoger alguna de las opciones que ya revisamos:`
      : `No trabajamos con ese tipo de producto: ${productLabel}. Puedes continuar con este proceso y escoger alguna de las opciones que ya revisamos:`;
  const example = country === "UY" ? "DEP250" : "Motorola DP250";
  return prependReplyContext(buildProductsListMessage(products, example), intro);
}

function formatFriendlyPrice(price: string, country: Country = "CL") {
  const raw = String(price || "").trim();
  if (!raw) return "";
  const locale = country === "UY" ? "es-UY" : "es-CL";
  const currency = country === "UY" ? "UYU" : "CLP";

  const numberParts = raw.match(/\d[\d.\s,]*/g) || [];
  const nums = numberParts
    .map((p) => Number(String(p).replace(/[^\d]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);

  const fmt = (amount: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  if (nums.length >= 2) {
    const min = Math.min(nums[0]!, nums[1]!);
    const max = Math.max(nums[0]!, nums[1]!);
    if (min === max) return `💰 Precio referencial: ${fmt(min)}`;
    return `💰 Precio referencial: Desde ${fmt(min)} hasta ${fmt(max)}`;
  }

  const numeric = raw.replace(/[^\d]/g, "");
  if (!numeric) return raw;
  const amount = Number(numeric);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return `💰 Precio referencial: ${fmt(amount)}`;
}

function buildProductFichaMessages(detail: ProductDetail | null, options?: { requestKind?: CatalogRequestKind; country?: Country }) {
  if (!detail) return [];
  const title = cleanProductName(detail.nombre || "");
  const header = title ? `*${title}*` : "*Producto*";
  const descriptionText = detail.fullDescription?.trim() || detail.shortFinal?.trim() || "";
  const descriptionChunks = descriptionText ? chunkText(descriptionText, 900) : [];
  const showPrice = options?.requestKind !== "arriendo";
  const priceLine = showPrice ? formatFriendlyPrice(detail.precio ?? "", options?.country ?? "CL") : "";
  const fallbackPriceLine = showPrice ? "💰 Precio referencial: Por confirmar" : "";
  const primaryAction = options?.requestKind === "arriendo" ? "Arrendar este equipo" : "Cotizar este equipo";
  const actions = [
    "¿Qué deseas hacer ahora?",
    "",
    `1) ${primaryAction}`,
    "2) Volver a la lista de productos",
    "3) Volver al menú",
    "4) Hacer una nueva búsqueda",
  ].join(
    "\n",
  );

  const out: Array<string | OutboundMessage> = [header];
  if (detail.imageUrl) out.push({ type: "image", imageUrl: detail.imageUrl });
  if (showPrice) out.push(priceLine || fallbackPriceLine);
  out.push(...descriptionChunks);
  if (detail.fichaUrl) out.push(`📄 Ficha técnica: ${detail.fichaUrl}`);
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

function isCatalogPriceRequest(text: string) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    t.includes("precio") ||
    t.includes("precios") ||
    t.includes("cuanto sale") ||
    t.includes("cuánto sale") ||
    t.includes("cuanto cuest") ||
    t.includes("cuánto cuest") ||
    t.includes("cuanto val") ||
    t.includes("cuánto val") ||
    t.includes("valor") ||
    t.includes("valen")
  );
}

function isRentalPriceIntent(text: string) {
  const t = normalizeText(text);
  if (!t) return false;

  const commercialHints =
    isCatalogPriceRequest(t) ||
    t.includes("tarifa") ||
    t.includes("tarifas") ||
    t.includes("costo") ||
    t.includes("costos") ||
    t.includes("detalle de precios") ||
    t.includes("detalle de precio") ||
    t.includes("detalle del arriendo") ||
    t.includes("precio del arriendo") ||
    t.includes("precios del arriendo") ||
    t.includes("precio de arriendo") ||
    t.includes("precios de arriendo") ||
    t.includes("valor del arriendo") ||
    t.includes("valores del arriendo") ||
    t.includes("cuanto es el arriendo") ||
    t.includes("cuánto es el arriendo") ||
    t.includes("cuanto cuesta arrendar") ||
    t.includes("cuánto cuesta arrendar") ||
    t.includes("cuanto sale arrendar") ||
    t.includes("cuánto sale arrendar");

  return isRentalIntent(t) && commercialHints;
}

function getArriendoPriceLeadIntro(productName?: string) {
  const cleanName = cleanProductName(toTrimmedString(productName));
  return [
    cleanName ? `Perfecto. Podemos ayudarte con el arriendo de ${cleanName}.` : "Perfecto. Podemos ayudarte con el arriendo del equipo que necesitas.",
    "Como los valores de nuestros sistemas y equipos varían según la configuración técnica y el alcance, un especialista de nuestra área comercial se encargará de preparar tu cotización.",
    "",
    "¿A qué número de teléfono o correo prefieres que te enviemos el detalle de precios? Déjanos tus datos de contacto y te responderemos a la brevedad.",
  ].join("\n");
}

function getPurchaseAdviceLeadIntro(country: Country) {
  return country === "UY"
    ? "Muy bien. Derivaré tu solicitud para que un asesor comercial te contacte y te oriente con la compra del equipo adecuado. Comencemos con tus datos."
    : "Muy bien. Derivaré tu solicitud para que un asesor comercial te contacte y te oriente con la compra del equipo adecuado. Comencemos con tus datos.";
}

async function loadProductPriceByCountry(country: Country, productId: string, nombre?: string) {
  if (!productId) return "";
  if (country === "UY") {
    const table = getUyProductsTable();
    const q = `${table}?select=precio&limit=1&product_id=eq.${encodeURIComponent(productId)}`;
    const res = await supabaseFetch(q, { method: "GET" });
    if (!res.ok || !Array.isArray(res.data)) return "";
    const row = (res.data as unknown[])[0];
    if (!row) return "";
    return toLooseText(getRecordValue(row, "precio"));
  }
  const commercial = await loadCatalogProductCommercialData({ productId, nombre: toTrimmedString(nombre) });
  if (commercial?.precio) return commercial.precio;
  const select = encodeURIComponent(`"Precio normal"`);
  const q = `inter_products_staging?select=${select}&ID=eq.${encodeURIComponent(productId)}&limit=1`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return "";
  const row = (res.data as unknown[])[0];
  if (!row) return "";
  return toTrimmedString(getRecordValue(row, "Precio normal"));
}

async function buildCatalogPriceListReply(args: { country: Country; list: Array<{ product_id: string; nombre: string }> }) {
  const max = Math.min(CATALOG_MAX_LIST_ITEMS, args.list.length);
  const head = args.list.slice(0, max);
  const rows = await Promise.all(
    head.map(async (p, i) => {
      const rawPrice = await loadProductPriceByCountry(args.country, p.product_id, p.nombre);
      const pretty = formatFriendlyPrice(rawPrice, args.country);
      const short = pretty ? pretty.replace(/^💰\s*Precio referencial:\s*/i, "").trim() : "Por confirmar";
      const name = cleanProductName(p.nombre);
      return `${i + 1}) ${name} — ${short}`;
    }),
  );
  return [
    "💰 Precios referenciales de la lista:",
    "",
    ...rows,
    "",
    `Si quieres ver la ficha, indícame el número (1–${max}) o el nombre del producto.`,
  ].join("\n");
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

function toLooseText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return value == null ? "" : String(value).trim();
}

function extractLikelyProductModel(text: string) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const m = raw.toUpperCase().match(/\b[A-Z]{1,6}\s?-?\s?\d{1,6}[A-Z]?\b/);
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

function shouldSkipHashDedupe(text: string) {
  const t = normalizeText(text);
  if (!t) return true;
  if (/^\d+$/.test(t)) return true;
  if (t.length <= 3) return true;
  return ["si", "sí", "no", "ok", "menu", "menú", "volver", "cancelar"].includes(t);
}

function shouldUseServiceTechOpeningPrompt(text: string) {
  const t = normalizeText(text);
  if (!t) return true;
  if (isServiceTechFormIntent(text)) return false;
  if (t === "2") return true;
  if (t === "4") return true;
  if (t === "servicio tecnico" || t === "servicio técnico") return true;
  if (t === "soporte tecnico" || t === "soporte técnico") return true;
  if (t === "tecnico" || t === "técnico") return true;
  if (t.includes("servicio tecnico") || t.includes("servicio técnico")) return t.length <= 28;
  if (t.includes("soporte tecnico") || t.includes("soporte técnico")) return t.length <= 26;
  return false;
}

function isServiceTechFormIntent(text: string) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    t.includes("solicit") ||
    t.includes("agendar") ||
    t.includes("formulario") ||
    t.includes("contact") ||
    t.includes("derivar") ||
    t.includes("ingresar solicitud") ||
    t.includes("ingresar una solicitud")
  );
}

function isRepeatedServiceTechQuestion(state: UserState, text: string, nowMs = Date.now()) {
  state.serviceTech ??= {};
  const normalized = normalizeText(text).replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  const repeated =
    state.serviceTech.lastQuestionHash === hash &&
    Number.isFinite(state.serviceTech.lastQuestionAt) &&
    nowMs - Number(state.serviceTech.lastQuestionAt) < 3 * 60 * 1000;
  state.serviceTech.lastQuestionHash = hash;
  state.serviceTech.lastQuestionAt = nowMs;
  return repeated;
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

function isExitConversationCommand(text: string) {
  const t = normalizeText(text);
  if (!t) return false;
  if (isMenuCommand(text)) return true;
  if (t.includes("finalizar")) return true;
  if (t.includes("salir")) return true;
  if (t.includes("cancel")) return true;
  if (t.includes("anular")) return true;
  if (t.includes("dejar hasta aqui") || t.includes("dejar hasta acá")) return true;
  if (t === "terminar") return true;
  if (t.includes("terminar") && (t.includes("convers") || t.includes("chat"))) return true;
  if (t.includes("final") && t.includes("convers")) return true;
  return false;
}

function isBackToProductsListCommand(text: string) {
  const t = normalizeText(text);
  if (!t) return false;
  if (t === "lista") return true;
  if (t.includes("ver lista")) return true;
  if (t === "volver") return true;
  if (t.includes("lista") && (t.includes("volver") || t.includes("volv") || t.includes("regresar") || t.includes("regresa"))) return true;
  return false;
}

function parseProductFichaActionChoice(text: string) {
  const t = normalizeText(text);
  if (!t) return null;
  if (t === "1") return 1 as const;
  if (t === "2") return 2 as const;
  if (t === "3") return 3 as const;
  if (t === "4") return 4 as const;
  return null;
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
  const mentionsDirectCatalogLookup = isDirectCatalogLookupIntent(text);
  const mentionsServicio = t.includes("servicio tecnico") || t.includes("servicio técnico") || t.includes("soporte tecnico") || t.includes("soporte técnico");
  const mentionsProjects = isProjectsIntentNormalized(t);
  const mentionsCambium = t.includes("cambium") || t.includes("cnmaestro") || t.includes("epmp") || t.includes("radioenlace") || t.includes("radioenlaces");
  const mentionsPoints = country !== "UY" && (isPuntosVentaIntentNormalized(t) || isLocationSupportIntent(text, country));

  if (mentionsServicio) return { branch: "servicio_tecnico", wantsMenu };
  if (mentionsProjects) return { branch: "proyectos", wantsMenu };
  if (mentionsCambium) return { branch: "cambium", wantsMenu };
  if (mentionsPoints) return { branch: "puntos_venta", wantsMenu };
  if (mentionsCatalog || mentionsDirectCatalogLookup) return { branch: "catalogo", wantsMenu };
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
  return (
    t.includes("arrend") ||
    t.includes("arriend") ||
    t.includes("alquil") ||
    t.includes("renta")
  );
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
    ["¿Qué opción prefieres para elegir?", "", "1. 📻 Equipos de radio", "2. 🎧 Accesorio de radio", "3. 📷 Cámara corporal", "4. 🤝 Arrendar directamente con un ejecutivo"].join(
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
    "Muy bien. Para avanzar con el arriendo, selecciona la opción que necesitas:",
    ["¿Qué opción prefieres para elegir?", "", "1. 📻 Equipos de radio", "2. 🎧 Accesorio de radio", "3. 📷 Cámara corporal", "4. 🤝 Arrendar directamente con un ejecutivo"].join(
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
  const intros = [
    "Para continuar con la compra, elige el tipo de producto que te interesa:",
    "Vamos paso a paso: selecciona el tipo de producto para seguir:",
    "Elige una categoría para mostrarte opciones del catálogo:",
    "Selecciona el tipo de producto y avanzamos:",
  ];
  const intro = intros[crypto.randomInt(0, intros.length)]!;
  return [
    intro,
    options.map((option, index) => `${index + 1}. ${option.label}`).join("\n"),
    "También puedes escribir el nombre del equipo (ej: DP50).",
  ];
}

function renderNumberedOptionLabels(options: CatalogPendingOption[]) {
  return options.map((option, index) => `${index + 1}. ${option.label}`);
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

type CatalogEntityHints = Partial<{
  quantity: number;
  brand: string;
  location: string;
  categoryKey: SuggestedCatalogTypeKey;
  portabilidadHint: "portatil" | "movil" | "repetidor";
  frequencyBand: "VHF" | "UHF";
  technologyHint: "DIGITAL" | "ANALOGO";
}>;

const COMMERCIAL_BRANDS = ["motorola", "hytera", "kenwood", "icom", "vertex", "cambium", "avigilon", "videobadge", "videotag"] as const;
const QUANTITY_WORD_VALUES: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  cien: 100,
};

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

function pickBestTipoProductoForCategory(key: SuggestedCatalogTypeKey, tipos: string[]) {
  const camera = (tp: string) => {
    const n = normalizeText(tp);
    return (n.includes("camara") || n.includes("cámara") || n.includes("body")) && (n.includes("corporal") || n.includes("camaras corporales") || n.includes("cámaras corporales"));
  };
  const accessory = (tp: string) => {
    const n = normalizeText(tp);
    return n.includes("accesor");
  };
  if (key === "camara_corporal") {
    const pure = tipos.filter((tp) => camera(tp) && !accessory(tp));
    const bestPure = findBestCatalogTypeByKeywords(pure, ["camara", "cámara", "camaras", "cámaras", "corporal", "bodycam", "body"]);
    if (bestPure) return bestPure;
    const best = findBestCatalogTypeByKeywords(tipos, ["camara", "cámara", "camaras", "cámaras", "corporal", "bodycam", "body"]);
    return best;
  }
  if (key === "accesorio_radio") {
    const pure = tipos.filter((tp) => accessory(tp) && !camera(tp));
    const bestPure = findBestCatalogTypeByKeywords(pure, ["accesorios", "accesorio", "bateria", "batería", "antena", "cargador", "auricular", "mic", "microfono", "micrófono"]);
    if (bestPure) return bestPure;
    return findBestCatalogTypeByKeywords(tipos, ["accesorios", "accesorio", "bateria", "batería", "antena", "cargador", "auricular", "mic", "microfono", "micrófono"]);
  }
  return findBestCatalogTypeByKeywords(tipos, ["equipos", "equipo", "radio", "radios", "handy", "portatil", "portátil", "movil", "móvil"]);
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
    const best = pickBestTipoProductoForCategory(w.key, tipos);
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

function extractBrandHint(text: string) {
  const tokens = normalizeText(text)
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
  const hit = tokens.find((token) => COMMERCIAL_BRANDS.includes(token as (typeof COMMERCIAL_BRANDS)[number]));
  return hit ? hit.charAt(0).toUpperCase() + hit.slice(1) : "";
}

function extractQuantityHint(text: string) {
  const normalized = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null as number | null;
  const direct = normalized.match(/\b(\d{1,3})\s+(?:equipos?|radios?|unidades?|repetidores?|accesorios?|camaras?|cámaras?)\b/);
  if (direct?.[1]) {
    const n = Number(direct[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const wordMatch = normalized.match(
    /\b(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|treinta|cuarenta|cincuenta|cien)\s+(?:equipos?|radios?|unidades?|repetidores?|accesorios?|camaras?|cámaras?)\b/,
  );
  if (!wordMatch?.[1]) return null;
  const value = QUANTITY_WORD_VALUES[wordMatch[1]];
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractLocationHint(text: string) {
  const parsed = parseCityRegionInput(text);
  if (parsed?.ciudad && parsed?.region) return `${parsed.ciudad}, ${parsed.region}`;
  const normalized = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  const stop = new Set([
    "un",
    "una",
    "el",
    "la",
    "los",
    "las",
    "interior",
    "exterior",
    "faena",
    "minera",
    "mineria",
    "mineriaa",
    "proyecto",
    "proyectos",
    "terreno",
    "vehiculo",
    "vehiculos",
    "base",
    "radio",
    "radios",
    "equipo",
    "equipos",
    "repetidor",
    "repetidores",
  ]);
  const matches = Array.from(normalized.matchAll(/\ben\s+([a-z0-9]+(?:\s+[a-z0-9]+){0,2})\b/g));
  for (const match of matches) {
    const candidate = String(match[1] ?? "").trim();
    if (!candidate) continue;
    const words = candidate.split(" ").filter(Boolean);
    if (!words.length) continue;
    if (stop.has(words[0] ?? "")) continue;
    if (words.every((word) => stop.has(word))) continue;
    return words.map((word) => (word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1))).join(" ");
  }
  return "";
}

function detectCatalogCategoryHint(text: string): SuggestedCatalogTypeKey | null {
  const t = normalizeText(text);
  if (!t) return null;
  if (t.includes("camara corporal") || t.includes("cámara corporal") || t.includes("bodycam") || t.includes("videobadge") || t.includes("videotag")) {
    return "camara_corporal";
  }
  if (
    t.includes("accesorio") ||
    t.includes("accesorios") ||
    t.includes("bateria") ||
    t.includes("batería") ||
    t.includes("antena") ||
    t.includes("cargador") ||
    t.includes("auricular") ||
    t.includes("microfono") ||
    t.includes("micrófono")
  ) {
    return "accesorio_radio";
  }
  if (
    t.includes("radio") ||
    t.includes("radios") ||
    t.includes("repetidor") ||
    t.includes("repetidores") ||
    t.includes("handy") ||
    t.includes("portatil") ||
    t.includes("portátil") ||
    t.includes("movil") ||
    t.includes("móvil")
  ) {
    return "equipos_radio";
  }
  return null;
}

function detectPortabilidadHint(text: string): "portatil" | "movil" | "repetidor" | null {
  const t = normalizeText(text);
  if (!t) return null;
  if (t.includes("repetidor")) return "repetidor";
  if (t.includes("portatil") || t.includes("portátil") || t.includes("handy")) return "portatil";
  if (t.includes("movil") || t.includes("móvil") || t.includes("vehiculo") || t.includes("vehículo") || t.includes("base fija") || t.includes("radio base")) {
    return "movil";
  }
  return null;
}

function detectTechnologyHint(text: string): "DIGITAL" | "ANALOGO" | null {
  const t = normalizeText(text);
  if (!t) return null;
  if (t.includes("digital")) return "DIGITAL";
  if (t.includes("analogo") || t.includes("análogo") || t.includes("analogico") || t.includes("analógico")) return "ANALOGO";
  return null;
}

function extractCatalogEntityHints(text: string): CatalogEntityHints {
  const input = String(text ?? "").trim();
  if (!input) return {};
  return {
    quantity: extractQuantityHint(input) ?? undefined,
    brand: extractBrandHint(input) || undefined,
    location: extractLocationHint(input) || undefined,
    categoryKey: detectCatalogCategoryHint(input) ?? undefined,
    portabilidadHint: detectPortabilidadHint(input) ?? undefined,
    frequencyBand: detectFrequencyBandFromText(input) || undefined,
    technologyHint: detectTechnologyHint(input) ?? undefined,
  };
}

function mergeCatalogLeadContext(current: CatalogState["leadContext"], hints: CatalogEntityHints) {
  const merged = {
    ...(current ?? {}),
    ...(hints.quantity ? { quantity: hints.quantity } : {}),
    ...(hints.brand ? { brand: hints.brand } : {}),
    ...(hints.location ? { location: hints.location } : {}),
    ...(hints.categoryKey ? { categoryKey: hints.categoryKey } : {}),
    ...(hints.portabilidadHint ? { portabilidadHint: hints.portabilidadHint } : {}),
    ...(hints.frequencyBand ? { frequencyBand: hints.frequencyBand } : {}),
    ...(hints.technologyHint ? { technologyHint: hints.technologyHint } : {}),
  };
  return Object.keys(merged).length ? merged : undefined;
}

function buildCatalogLeadContextSummary(context?: CatalogState["leadContext"]) {
  if (!context) return "";
  const productText = (() => {
    const category = context.categoryKey;
    const subtype = context.portabilidadHint;
    if (category === "camara_corporal") return context.quantity === 1 ? "cámara corporal" : "cámaras corporales";
    if (category === "accesorio_radio") return context.quantity === 1 ? "accesorio" : "accesorios";
    if (subtype === "repetidor") return context.quantity === 1 ? "repetidor" : "repetidores";
    if (subtype === "portatil") return context.quantity === 1 ? "radio portátil" : "radios portátiles";
    if (subtype === "movil") return context.quantity === 1 ? "radio móvil" : "radios móviles";
    if (category === "equipos_radio") return context.quantity === 1 ? "equipo de radio" : "equipos de radio";
    return context.quantity === 1 ? "equipo" : "equipos";
  })();
  const subject = context.quantity ? `${context.quantity} ${productText}` : productText;
  const details = [
    context.brand ? `marca ${context.brand}` : "",
    context.frequencyBand && context.technologyHint
      ? `${context.frequencyBand} ${context.technologyHint === "DIGITAL" ? "digital" : "analógico"}`
      : context.frequencyBand || "",
  ].filter(Boolean);
  const lead = [`Tomé nota de que buscas ${subject}`, details.length ? `, ${details.join(", ")}` : "", context.location ? ` en ${context.location}` : "", "."].join("");
  return lead.replace(/\s+,/g, ",").replace(/\s+\./g, ".").trim();
}

async function applyCatalogEntityHintsToState(
  state: UserState,
  country: Country,
  input: string,
  options?: { mode?: CatalogRequestKind },
) {
  const hints = extractCatalogEntityHints(input);
  state.catalog.leadContext = mergeCatalogLeadContext(state.catalog.leadContext, hints);
  let changed = false;
  const modalidad = state.catalog.filters.modalidad ?? (options?.mode === "arriendo" ? "Arriendo" : options?.mode === "cotizacion" ? "Venta" : undefined);

  if (!state.catalog.filters.tipo_producto && hints.categoryKey) {
    const suggested = await getSuggestedCatalogTypes(country, modalidad);
    const selected = suggested.find((item) => item.key === hints.categoryKey);
    if (selected?.tipo) {
      state.catalog.filters.tipo_producto = selected.tipo;
      changed = true;
    }
  }

  const currentTipo = state.catalog.filters.tipo_producto;
  const isRadioType = isRadioEquipmentTipoProducto(currentTipo) || hints.categoryKey === "equipos_radio";
  if (isRadioType && !state.catalog.filters.portabilidad && hints.portabilidadHint) {
    const radioOptions = await buildRadioSubtypeOptions(country, state.catalog.filters);
    const wanted =
      hints.portabilidadHint === "repetidor"
        ? "repetidor"
        : hints.portabilidadHint === "movil"
          ? "movil"
          : "portatil";
    const portabilidad = radioOptions.find((option) => normalizeText(option.value).includes(wanted))?.value;
    if (portabilidad) {
      state.catalog.filters.portabilidad = portabilidad;
      changed = true;
    }
  }

  if (isRadioType && !state.catalog.filters.frecuencia && hints.frequencyBand) {
    state.catalog.filters.frecuencia = hints.frequencyBand;
    changed = true;
  }
  if (isRadioType && !state.catalog.filters.tecnologia && hints.technologyHint) {
    state.catalog.filters.tecnologia = hints.technologyHint;
    changed = true;
  }

  if (changed) {
    state.catalog.pending = undefined;
  }
  return changed;
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
  state.catalog.arriendoPriceMenuActive = undefined;
  const isRental = args?.mode === "arriendo";
  state.catalog.filters.modalidad = args?.modalidad ?? (isRental ? "Arriendo" : "Venta");
  if (args?.seedText) {
    await applyCatalogEntityHintsToState(state, country, args.seedText, { mode: isRental ? "arriendo" : "cotizacion" });
  }

  if (args?.seedText && !state.catalog.quote && !state.catalog.pending && !state.catalog.selectedProductId) {
    const directModelReply = await tryDirectCatalogModelLookup(state, country, args.seedText);
    if (directModelReply) return directModelReply;
  }

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

  if (state.catalog.filters.tipo_producto) {
    return country === "UY" ? await handleCatalogUY(state, args?.seedText ?? "", userKey) : await handleCatalog(state, args?.seedText ?? "", userKey);
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
  return await startCatalogFlow(state, userKey, { mode: "arriendo" });
}

async function startArriendoFlowFromText(state: UserState, userKey: string, seedText?: string) {
  return await startCatalogFlow(state, userKey, { mode: "arriendo", seedText });
}

async function startRentalPriceLeadFlow(state: UserState, userPhone: string) {
  const country = state.country ?? "CL";
  const previousCatalog = state.catalog;
  const selectedProductId = previousCatalog.selectedProductId ?? "";
  const productDetail = selectedProductId ? await loadProductDetailByCountry(country, selectedProductId) : null;
  const productName = productDetail?.nombre ? cleanProductName(productDetail.nombre) : "";
  const savedLeadContext = previousCatalog.leadContext;
  const previous = state.activeBranch;
  state.activeBranch = "catalogo";
  resetBranchState(state, previous);
  resetBranchState(state, "catalogo");
  state.catalog.requestKind = "arriendo";
  state.catalog.filters.modalidad = "Arriendo";
  state.catalog.arriendoStage = undefined;
  state.catalog.optionalCompanyHandled = false;
  state.catalog.arriendoPriceMenuActive = undefined;
  state.catalog.leadContext = savedLeadContext;
  const contextLine = buildCatalogLeadContextSummary(savedLeadContext);
  return await startContactForm(state, userPhone, "cl_arriendo_precio", {
    intro: contextLine ? [contextLine, "", getArriendoPriceLeadIntro(productName)].join("\n") : getArriendoPriceLeadIntro(productName),
    presetData: {
      ...(productName ? { producto: productName } : {}),
    },
  });
}

async function startCatalogIntentFlow(state: UserState, userKey: string, text: string) {
  const country = state.country ?? "CL";
  if (text) {
    state.catalog.leadContext = mergeCatalogLeadContext(state.catalog.leadContext, extractCatalogEntityHints(text));
  }
  if (country === "CL" && isRentalPriceIntent(text)) {
    return await startRentalPriceLeadFlow(state, userKey);
  }
  if (country === "CL" && isRentalIntent(text)) {
    return await startArriendoFlowFromText(state, userKey, text);
  }
  return await startCotizarFlow(state, userKey, text);
}

function buildMainMenuText(country: Country, variant: "welcome" | "return" = "return") {
  const introsWelcomeCL = ["¡Hola! Bienvenido al asistente virtual de InterWins. ¿En qué te puedo ayudar hoy?"];
  const introsReturnCL = [
    "Volvimos al menú principal. Indica la opción que necesitas:",
    "Ya estoy aquí. ¿Con qué quieres continuar?",
    "Perfecto, volvamos al menú principal. ¿Qué necesitas ahora?",
    "Excelente. Elige una opción para continuar:",
  ];
  const introsWelcomeUY = ["¡Hola! Bienvenido al asistente virtual de InterWins. ¿En qué te puedo ayudar hoy?"];
  const introsReturnUY = [
    "Volvimos al menú principal. Indica la opción que necesitas:",
    "Ya estoy aquí. ¿Con qué quieres continuar?",
    "Perfecto, volvamos al menú principal. ¿Qué necesitas ahora?",
    "Excelente. Elige una opción para continuar:",
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
      variant === "welcome" ? "Selecciona una opción o escribe el número:" : "Selecciona una opción o escribe el número para continuar:",
      "",
      "1. 🛒 Comprar equipos o accesorios (Venta)",
      "",
      "2. 🔧 Servicio Técnico",
      "",
      "3. 📊 Asesoría en Proyectos",
      "",
      "4. 🌐 Soluciones Cambium Networks",
    ].join("\n");
  }

  return [
    intro,
    variant === "welcome" ? "Selecciona una opción o escribe el número:" : "Selecciona una opción o escribe el número para continuar:",
    "",
    "1. 🛒 Comprar equipos o accesorios (Venta)",
    "",
    "2. ⏱️ Arrendar equipos de radiocomunicación",
    "",
    "3. 📊 Asesoría en Proyectos",
    "",
    "4. 🔧 Servicio Técnico",
    "",
    "5. 📍 Direcciones y Puntos de Venta",
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
  const choice = extractChoiceNumberFromText(text, country === "UY" ? 4 : 5);
  if (choice === 1) return "catalogo";
  if (country !== "UY" && choice === 4) return "servicio_tecnico";
  if (country !== "UY" && choice === 5) return "puntos_venta";
  if (country === "UY" && choice === 2) return "servicio_tecnico";
  if (choice === 3) return "proyectos";
  if (country === "UY" && choice === 4) return "cambium";
  if (t === "1" || t.includes("catalogo") || t.includes("catálogo") || t.includes("cotizar") || t.includes("cotizacion") || t.includes("cotización"))
    return "catalogo";
  if ((country === "UY" && t === "2") || t.includes("servicio") || t.includes("tecnico") || t.includes("técnico")) return "servicio_tecnico";
  if (t === "3" || isProjectsIntentNormalized(t)) return "proyectos";
  if (t === "4") return country === "UY" ? "cambium" : "servicio_tecnico";
  if (country !== "UY" && (t === "5" || isPuntosVentaIntentNormalized(t) || isLocationSupportIntent(text, country))) return "puntos_venta";
  if (t.includes("cambium") || t.includes("cnmaestro")) return "cambium";
  return null;
}

type MainMenuAction = Branch | "arriendo";

function isLikelyMainMenuSelectionOnly(text: string, country: Country) {
  const t = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  if (/^\d+$/.test(t)) return true;
  const max = country === "UY" ? 4 : 5;
  const exactLabels =
    country === "UY"
      ? ["comprar equipos o accesorios", "venta", "servicio tecnico", "proyectos", "asesoria en proyectos", "cambium", "soluciones cambium networks"]
      : ["comprar equipos o accesorios", "venta", "arriendo", "arrendar equipos de radiocomunicacion", "proyectos", "asesoria en proyectos", "servicio tecnico", "direcciones y puntos de venta", "puntos de venta"];
  if (exactLabels.includes(t)) return true;
  const choice = extractChoiceNumberFromText(text, max);
  return Boolean(choice && t.split(" ").length <= 5);
}

function parseMainMenuAction(text: string, country: Country): MainMenuAction | null {
  const t = normalizeText(text);
  const choice = extractChoiceNumberFromText(text, country === "UY" ? 4 : 5);
  if (country !== "UY") {
    if (choice === 1 || t === "1") return "catalogo";
    if (choice === 2 || t === "2") return "arriendo";
    if (choice === 3 || t === "3") return "proyectos";
    if (choice === 4 || t === "4") return "servicio_tecnico";
    if (choice === 5 || t === "5") return "puntos_venta";
    if (isRentalIntent(text)) return "arriendo";
  } else {
    if (choice === 1 || t === "1") return "catalogo";
    if (choice === 2 || t === "2") return "servicio_tecnico";
    if (choice === 3 || t === "3") return "proyectos";
    if (choice === 4 || t === "4") return "cambium";
  }
  return parseMenuChoice(text, country) ?? classifyFreeText(text, country);
}

function prependReplyContext(reply: Reply, intro: string): Reply {
  const text = intro.trim();
  if (!text) return reply;
  if (typeof reply === "string") return `${text}\n\n${reply}`;
  if (Array.isArray(reply)) return [text, "", ...reply];
  if (reply.type === "text") return { ...reply, text: `${text}\n\n${reply.text}` };
  return [{ type: "text", text }, "", reply];
}

function buildMainMenuEntryIntro(action: MainMenuAction, country: Country) {
  if (action === "catalogo") {
    const options = [
      "Perfecto. Si ya tienes un modelo o producto en mente, escríbemelo y te comparto su información. Si prefieres explorar, también puedo guiarte por categorías.",
      "Muy bien. Puedo ayudarte a encontrar el equipo que buscas o, si aún lo estás definiendo, orientarte paso a paso.",
      "Excelente. Dime el modelo que necesitas o, si prefieres, elegimos juntos la categoría más conveniente.",
    ];
    return options[crypto.randomInt(0, options.length)]!;
  }
  if (action === "arriendo") {
    const options = [
      "Perfecto. Si ya sabes qué equipo quieres arrendar, escríbeme el modelo y revisamos la mejor forma de cotizarlo.",
      "Muy bien. Puedo orientarte con opciones de arriendo o, si ya tienes un equipo en mente, ayudarte a derivarlo de inmediato con el área comercial.",
      "Excelente. Cuéntame qué equipo necesitas arrendar y te ayudo a avanzar de la forma más directa.",
    ];
    return options[crypto.randomInt(0, options.length)]!;
  }
  if (action === "proyectos") {
    const options = [
      "Muy bien. Estás en Asesoría en Proyectos. Ahora te mostraré las opciones disponibles para continuar.",
      "Claro, vamos con Asesoría en Proyectos. Revisa las opciones disponibles y avanzamos.",
      "Excelente. Ya ingresaste a Asesoría en Proyectos. Ahora te mostraré el siguiente paso.",
    ];
    return options[crypto.randomInt(0, options.length)]!;
  }
  if (action === "servicio_tecnico") {
    return country === "UY"
      ? "Claro, vamos con Servicio Técnico en Uruguay. Indícame el equipo o la situación y te ayudo a revisarla."
      : "Claro, vamos con Servicio Técnico. Indícame el equipo o la situación y te ayudo a revisarla.";
  }
  if (action === "puntos_venta") {
    const options = [
      "Muy bien. Estás en Direcciones y Puntos de Venta. Ahora te ayudaré a encontrar la ubicación o el contacto que necesitas.",
      "Claro, vamos con Direcciones y Puntos de Venta. Indícame la zona y te ayudaré a ubicar el punto más adecuado.",
      "Excelente. Ya ingresaste a Direcciones y Puntos de Venta. Ahora busquemos la ubicación que necesitas.",
    ];
    return options[crypto.randomInt(0, options.length)]!;
  }
  if (country === "UY") {
    const options = [
      "Muy bien. Estás en Soluciones Cambium Networks. Ahora te mostraré las categorías disponibles para continuar.",
      "Claro, vamos con Soluciones Cambium Networks. Revisa las categorías disponibles para seguir.",
      "Excelente. Ya ingresaste a Soluciones Cambium Networks. Ahora elige la categoría que necesitas.",
    ];
    return options[crypto.randomInt(0, options.length)]!;
  }
  return "Muy bien. Ya ingresaste a esta sección. Ahora te mostraré las opciones disponibles para continuar.";
}

async function runMainMenuAction(state: UserState, userKey: string, action: MainMenuAction, text: string): Promise<Reply> {
  const country = state.country ?? "CL";
  let reply: Reply = "";
  const forwardInput = isLikelyMainMenuSelectionOnly(text, country) ? "" : text;
  const skipIntroForDirectLookup = (action === "catalogo" || action === "arriendo") && isDirectCatalogLookupIntent(text);

  if (action === "arriendo") {
    if (country === "CL" && isRentalPriceIntent(text)) {
      return await startRentalPriceLeadFlow(state, userKey);
    }
    reply = await startArriendoFlow(state, userKey);
    return skipIntroForDirectLookup ? reply : prependReplyContext(reply, buildMainMenuEntryIntro(action, country));
  }

  state.activeBranch = action;
  resetBranchState(state, action);

  if (!isBranchAvailable(country, action)) {
    state.activeBranch = "menu";
    markMenuShown(state);
    return buildMainMenuText(country, "return");
  }

  if (action === "catalogo") {
    const t = normalizeText(text);
    const looksLikeMainMenuChoice =
      t === "1" ||
      t.startsWith("1 ") ||
      t.startsWith("1.") ||
      t.includes("comprar equipos") ||
      t.includes("equipos o accesorios") ||
      t.includes("venta)");
    reply = await startCatalogIntentFlow(state, userKey, looksLikeMainMenuChoice ? "" : text);
  } else if (action === "servicio_tecnico") {
    const stInput = !forwardInput || shouldUseServiceTechOpeningPrompt(text) ? "" : text;
    reply = country === "UY" ? await handleServicioTecnicoUY(state, stInput, userKey) : await handleServicioTecnico(state, stInput, userKey);
  } else if (action === "proyectos") {
    reply = country === "UY" ? await handleProjectsUY(state, forwardInput, userKey) : await handleProjects(state, forwardInput, userKey);
  } else if (action === "cambium") {
    reply = await handleCambium(state, forwardInput, userKey);
  } else if (action === "puntos_venta") {
    reply = await handlePoints(state, forwardInput, userKey);
  } else {
    markMenuShown(state);
    reply = buildMainMenuText(country, "return");
  }

  return skipIntroForDirectLookup ? reply : prependReplyContext(reply, buildMainMenuEntryIntro(action, country));
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
    if (isPuntosVentaIntentNormalized(t) || isLocationSupportIntent(text, country)) return "puntos_venta";
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
    "arriendo",
    "venta",
    "cotizacion",
    "cotización",
    "cotizar",
    "equipos de radio",
    "equipo de radio",
    "equipo radio",
    "equipos radio",
    "equipo",
    "equipos",
    "radio",
    "analogo",
    "análogo",
    "analogico",
    "analógico",
    "digital",
    "portatil",
    "portátil",
    "movil",
    "móvil",
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
  const tokens = name.split(" ").filter(Boolean);
  const idx = tokens.findIndex((t) => COMMERCIAL_BRANDS.includes(normalizeText(t) as (typeof COMMERCIAL_BRANDS)[number]));
  if (idx > 0) {
    name = tokens.slice(idx).join(" ");
  }
  return name;
}

type CatalogProductCandidate = {
  product_id: string;
  nombre: string;
  tipo_producto?: string;
  modalidad?: string;
  tecnologia?: string;
  frecuencia?: string;
};

function isAccessoryTipoProducto(tipoProducto?: string) {
  return normalizeText(tipoProducto || "").includes("accesor");
}

function isAccessoryLikeProductName(name: string) {
  const t = normalizeText(name);
  if (!t) return false;
  return [
    "antena",
    "auricular",
    "microfono",
    "micrófono",
    "bateria",
    "batería",
    "cargador",
    "clip",
    "estuche",
    "correa",
    "repuesto",
    "adaptador",
    "cable",
    "kit",
    "tubo acustico",
    "tubo acústico",
    "ptt",
    "manos libres",
    "parlante microfono",
    "parlante micrófono",
    "audifono",
    "audífono",
    "base de carga",
  ].some((token) => t.includes(normalizeText(token)));
}

function isRadioEquipmentLikeProductName(name: string) {
  const t = normalizeText(name);
  if (!t) return false;
  if (isAccessoryLikeProductName(name)) return false;
  if (scoreBodycamCandidateName(name) > 0) return false;
  return (
    t.includes("equipo radio") ||
    t.includes("equipos radio") ||
    t.includes("radio portatil") ||
    t.includes("radio portátil") ||
    t.includes("radio movil") ||
    t.includes("radio móvil") ||
    t.includes("repetidor") ||
    ((t.includes("motorola") || t.includes("hytera") || t.includes("kenwood") || t.includes("icom") || t.includes("vertex")) && /\b[a-z]{1,6}\s?-?\s?\d{2,6}[a-z]?\b/i.test(name))
  );
}

function detectDirectCatalogTargetKind(input: string, filters: CatalogFilters, leadContext?: CatalogState["leadContext"]) {
  const t = normalizeText(input);
  if (leadContext?.categoryKey === "camara_corporal" || isBodycamTipoProducto(filters.tipo_producto)) return "bodycam" as const;
  if (
    leadContext?.categoryKey === "accesorio_radio" ||
    isAccessoryTipoProducto(filters.tipo_producto) ||
    [
      "accesorio",
      "accesorios",
      "antena",
      "bateria",
      "batería",
      "cargador",
      "auricular",
      "microfono",
      "micrófono",
      "manos libres",
    ].some((token) => t.includes(normalizeText(token)))
  ) {
    return "accessory" as const;
  }
  return "equipment" as const;
}

function dedupeCatalogCandidates(candidates: CatalogProductCandidate[]) {
  const seen = new Set<string>();
  const out: CatalogProductCandidate[] = [];
  for (const candidate of candidates) {
    const key = compactCatalogModelText(cleanProductName(candidate.nombre || "") || candidate.nombre || candidate.product_id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function scoreDirectCatalogCandidate(
  candidate: CatalogProductCandidate,
  modelQuery: string,
  filters: CatalogFilters,
  targetKind: "equipment" | "accessory" | "bodycam",
) {
  const compactQuery = compactCatalogModelText(modelQuery);
  const compactName = compactCatalogModelText(candidate.nombre);
  const compactCleanName = compactCatalogModelText(cleanProductName(candidate.nombre));
  const compactId = compactCatalogModelText(candidate.product_id);
  const nameNorm = normalizeText(candidate.nombre);
  const queryNorm = normalizeText(modelQuery);
  const isAccessory = isAccessoryTipoProducto(candidate.tipo_producto) || isAccessoryLikeProductName(candidate.nombre);
  const isBodycam = isBodycamTipoProducto(candidate.tipo_producto) || scoreBodycamCandidateName(candidate.nombre) > 0;
  const isRadioEquipment = isRadioEquipmentTipoProducto(candidate.tipo_producto) || isRadioEquipmentLikeProductName(candidate.nombre);
  let score = 0;

  if (compactId === compactQuery) score += 140;
  if (compactCleanName === compactQuery || compactName === compactQuery) score += 160;
  if (compactCleanName.startsWith(compactQuery) || compactName.startsWith(compactQuery)) score += 95;
  if (compactCleanName.includes(compactQuery) || compactName.includes(compactQuery) || compactId.includes(compactQuery)) score += 60;
  if (queryNorm && new RegExp(`\\b${escapeRegexLiteral(queryNorm).replace(/\s+/g, "\\s+")}\\b`).test(nameNorm)) score += 40;

  if (targetKind === "equipment") {
    if (isRadioEquipment) score += 70;
    if (isAccessory) score -= 140;
    if (isBodycam) score -= 60;
    if (/\bcompatibilidad\b/.test(nameNorm)) score -= 40;
  } else if (targetKind === "accessory") {
    if (isAccessory) score += 80;
    if (isRadioEquipment) score -= 20;
  } else {
    if (isBodycam) score += 90;
    if (isAccessory) score -= 60;
  }

  if (filters.frecuencia) {
    score += matchesSelectedFrequencyBand(candidate.frecuencia || candidate.nombre, filters.frecuencia) ? 28 : -28;
  }
  if (filters.tecnologia) {
    score += matchesSelectedTechnology(candidate.tecnologia || candidate.nombre, filters.tecnologia) ? 24 : -24;
  }
  if (filters.modalidad && candidate.modalidad) {
    const wanted = normalizeText(filters.modalidad);
    const actual = normalizeText(candidate.modalidad);
    score += actual.includes(wanted) || (wanted === "venta" && !actual) ? 8 : -12;
  }

  return score;
}

function matchesDirectCatalogKind(candidate: CatalogProductCandidate, targetKind: "equipment" | "accessory" | "bodycam") {
  const isAccessory = isAccessoryTipoProducto(candidate.tipo_producto) || isAccessoryLikeProductName(candidate.nombre);
  const isBodycam = isBodycamTipoProducto(candidate.tipo_producto) || scoreBodycamCandidateName(candidate.nombre) > 0;
  const isRadioEquipment = isRadioEquipmentTipoProducto(candidate.tipo_producto) || isRadioEquipmentLikeProductName(candidate.nombre);
  if (targetKind === "equipment") return isRadioEquipment && !isAccessory && !isBodycam;
  if (targetKind === "accessory") return isAccessory;
  return isBodycam && !isAccessory;
}

function matchesExplicitDirectCatalogHints(
  candidate: CatalogProductCandidate,
  hints: Pick<CatalogEntityHints, "frequencyBand" | "technologyHint">,
  targetKind: "equipment" | "accessory" | "bodycam",
) {
  if (!matchesDirectCatalogKind(candidate, targetKind)) return false;
  if (hints.frequencyBand && !matchesSelectedFrequencyBand(candidate.frecuencia || candidate.nombre, hints.frequencyBand)) return false;
  if (hints.technologyHint && !matchesSelectedTechnology(candidate.tecnologia || candidate.nombre, hints.technologyHint)) return false;
  return true;
}

function buildDirectCatalogMissReply(args: {
  modelQuery: string;
  targetKind: "equipment" | "accessory" | "bodycam";
  requestKind?: CatalogRequestKind;
  accessoryMatches?: number;
}) {
  const model = args.modelQuery.toUpperCase();
  if (args.targetKind === "equipment" && (args.accessoryMatches ?? 0) > 0) {
    return [
      `No encontré ${model} como equipo disponible en el catálogo actual de ${args.requestKind === "arriendo" ? "arriendo" : "venta"}.`,
      `Sí veo accesorios compatibles asociados a ese modelo, pero no corresponde mostrarte solo eso si estás buscando el equipo.`,
      args.requestKind === "arriendo"
        ? "Si quieres, te ayudo a buscar un equipo equivalente para arriendo."
        : "Si quieres, te ayudo a buscar una alternativa vigente o, si en realidad necesitas accesorios, te los muestro por categoría.",
    ].join("\n");
  }
  return [`No encontré "${model}" en el catálogo.`, "Si quieres, dime otro modelo o hago una nueva búsqueda contigo."].join("\n");
}

function isRadioEquipmentTipoProducto(tipoProducto?: string) {
  const t = normalizeText(tipoProducto || "");
  if (!t) return false;
  if (isAccessoryTipoProducto(tipoProducto) || isBodycamTipoProducto(tipoProducto)) return false;
  return (
    (t.includes("equipo") && t.includes("radio")) ||
    t.includes("equipos radio") ||
    t.includes("radios") ||
    t.includes("radio movil") ||
    t.includes("radio móvil") ||
    t.includes("radio portatil") ||
    t.includes("radio portátil") ||
    t.includes("portatil") ||
    t.includes("portátil") ||
    t.includes("movil") ||
    t.includes("móvil") ||
    t.includes("repetidor") ||
    t.includes("base")
  );
}

function isBodycamTipoProducto(tipoProducto?: string) {
  const t = normalizeText(tipoProducto || "");
  const isCam = t.includes("camara") || t.includes("cámara") || t.includes("body");
  if (!isCam) return false;
  return t.includes("corporal") || t.includes("camaras corporales") || t.includes("cámaras corporales") || t.includes("videobadge") || t.includes("videotag");
}

function scoreBodycamCandidateName(name: string) {
  const t = normalizeText(name || "");
  if (!t) return 0;
  let s = 0;
  if (t.includes("camara corporal") || t.includes("cámara corporal") || t.includes("bodycam") || t.includes("videobadge") || t.includes("videotag")) s += 6;
  if (/\bvb\s?-?\d{3}\b/.test(t) || t.includes("vb440") || t.includes("vb-440")) s += 5;
  if (/\bvt\s?-?100\b/.test(t) || t.includes("vt100") || t.includes("vt-100")) s += 5;
  if (t.includes("v500")) s += 5;
  const accessoryTokens = [
    "dock",
    "dc-",
    "dockcontroller",
    "base de acoplamiento",
    "acoplamiento",
    "arnes",
    "arnés",
    "harn",
    "klick",
    "fast",
    "clip",
    "pinza",
    "soporte",
    "mount",
    "cable",
    "usb",
    "cargador",
    "carga",
    "kit",
    "correa",
  ];
  let accessoryHits = 0;
  for (const token of accessoryTokens) {
    if (t.includes(token)) {
      s -= 4;
      accessoryHits += 1;
    }
  }
  const isDeviceNamed = t.includes("camara corporal") || t.includes("cámara corporal") || t.includes("videobadge") || t.includes("videotag");
  if (accessoryHits > 0 && !isDeviceNamed) s -= 6 * accessoryHits;
  return s;
}

async function pickBestBodycamList(country: Country, candidates: Array<{ product_id: string; nombre: string }>) {
  const prelim = candidates
    .map((p) => ({ ...p, score: scoreBodycamCandidateName(p.nombre) }))
    .sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre, "es"));
  const head = prelim.slice(0, 15);
  const rest = prelim.slice(15);
  const enriched = await Promise.all(
    head.map(async (p) => {
      const d = await loadProductDetailByCountry(country, p.product_id);
      const nombre = d?.nombre ? d.nombre : p.nombre;
      return { product_id: p.product_id, nombre, score: scoreBodycamCandidateName(nombre) };
    }),
  );
  const all = [...enriched, ...rest].sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre, "es"));
  const good = all.filter((p) => p.score > 0);
  const pool = (good.length >= 3 ? good : all)
    .slice(0, CATALOG_MAX_LIST_ITEMS)
    .map((p) => ({ product_id: p.product_id, nombre: p.nombre }));
  return pool.filter((p) => p.product_id && p.nombre);
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
      label: "No estoy seguro / Contactar con un asesor",
      value: "No estoy seguro / Contactar con un asesor",
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
    state.catalog.returnList = undefined;
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

function removeWordpressShortcodesRaw(text: string) {
  return text.replace(/\[(?:\/)?[a-zA-Z_][^\]]*\]/g, " ");
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
  const raw = removeWordpressShortcodesRaw(removeNectarShortcodesRaw(html || ""));
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

type ManagedSectionKey = "proyectos" | "servicio_tecnico" | "empresa";

function getDefaultCompanyOpeningText(country: Country) {
  return [
    "InterWins es una empresa que diseña e implementa soluciones para operaciones críticas, orientadas a impactar positivamente la continuidad operativa, la seguridad en terreno y la eficiencia productiva de sus clientes.",
    "",
    country === "UY"
      ? "En Uruguay, además de radiocomunicación profesional, también orientamos proyectos de conectividad y soluciones empresariales especializadas."
      : "En Chile, acompañamos a empresas con soluciones de radiocomunicación profesional, conectividad, soporte técnico y proyectos tecnológicos especializados.",
  ].join("\n");
}

function getDefaultCompanyKnowledgeText(country: Country) {
  return [
    "Diseñamos e implementamos soluciones para mejorar la operación de nuestros clientes.",
    "Nos enfocamos en operaciones críticas, donde la comunicación, la seguridad y la continuidad operacional son factores clave.",
    "InterWins puede apoyar con radiocomunicación profesional, conectividad empresarial, infraestructura de telecomunicaciones, automatización, ciberseguridad y redes IP según el contexto del proyecto.",
    country === "UY"
      ? "También orientamos requerimientos vinculados a compra, proyectos, servicio técnico y soluciones Cambium."
      : "También orientamos requerimientos vinculados a compra, arriendo, proyectos, servicio técnico y puntos de venta.",
  ].join("\n");
}

function normalizeInstitutionalKnowledgeText(text: string) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^la respuesta debe sonar\b/i.test(line))
    .filter((line) => !/^si el cliente quiere avanzar\b/i.test(line))
    .filter((line) => !/^si quieres usar este contenido\b/i.test(line))
    .join("\n");
}

function getDefaultProjectsOpeningText() {
  return [
    "En Interwins diseñamos e implementamos proyectos tecnológicos bajo la metodología SOEM, respaldados por más de 50 implementaciones exitosas en Chile y Uruguay.",
    "",
    "Nos especializamos en soluciones para operaciones críticas, ayudando a tu empresa a:",
    "",
    "- Garantizar la continuidad operativa mediante contratos de soporte dedicados.",
    "- Aumentar la seguridad de tu personal en terreno.",
    "- Optimizar la eficiencia productiva de toda la organización.",
    "",
    "¿Quieres implementar o mejorar tu sistema de comunicación?",
  ].join("\n");
}

async function loadManagedSectionContent(section: ManagedSectionKey, country: Country) {
  const defaultOpeningText =
    section === "proyectos"
      ? getDefaultProjectsOpeningText()
      : section === "empresa"
        ? getDefaultCompanyOpeningText(country)
        : country === "UY"
          ? buildServicioTecnicoInfoMessageUY()
          : buildServicioTecnicoInfoMessage();
  const defaultKnowledgeText =
    section === "proyectos"
      ? country === "UY"
        ? loadUyProjectsData().bankText
        : ""
      : section === "empresa"
        ? getDefaultCompanyKnowledgeText(country)
        : country === "UY"
          ? loadUyServicioTecnicoText()
          : "";
  const q = `assistant_section_content?select=opening_text,knowledge_text&limit=1&section_key=eq.${section}&country=eq.${country}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) {
    return { openingText: defaultOpeningText, knowledgeText: defaultKnowledgeText };
  }
  const row = (res.data as unknown[])[0];
  return {
    openingText: toTrimmedString(getRecordValue(row, "opening_text")) || defaultOpeningText,
    knowledgeText: toTrimmedString(getRecordValue(row, "knowledge_text")) || defaultKnowledgeText,
  };
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

async function generateAiRewrite(args: { kind: "saludo" | "fuera_menu" | "cierre" | "empatia"; input?: string; facts: string[] }) {
  const key = getAiApiKey();
  if (!key) {
    return args.facts.filter(Boolean).join("\n");
  }

  const completionsUrl = getAiChatCompletionsUrl();
  const system = [
    "Eres un asesor humano de ventas y soporte para una empresa chilena de telecomunicaciones y radiocomunicación.",
    "Hablas en español chileno, tono cordial, profesional y claro.",
    "Sé breve, claro y sin redundancias.",
    "Evita modismos o expresiones demasiado coloquiales como 'bacán', 'cachai', 'al tiro', 'altiro', 'dale', 'te leo' o similares.",
    "Prefiere un vocabulario profesional, natural y respetuoso.",
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

  const res = await fetch(completionsUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
        model: getAiModel(),
      messages: [
        { role: "system", content: system },
        { role: "user", content: userParts },
      ],
      temperature: 0.1,
      max_tokens: 900,
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
    const cleaned = sanitizeAiOutput(content);
    if (cleaned) return cleaned;
  }
  return args.facts.filter(Boolean).join("\n");
}

async function generateServiceTechAiAnswer(args: { input: string; knowledge: Array<{ tema: string; info: string }> }) {
  const input = (args.input || "").trim();
  const knowledge = args.knowledge ?? [];

  const fallback = () => {
    if (knowledge.length) {
      const blocks = knowledge
        .slice(0, 2)
        .map((k) => [`*${k.tema}*`, k.info].filter(Boolean).join("\n"))
        .join("\n\n");
      return blocks.trim() ? blocks : "¿Podrías darme un poco más de contexto para orientarte mejor?";
    }
    return [
      "🔧 Con gusto te ayudo. Para orientarte mejor:",
      "1) ¿Qué equipo/modelo es?",
      "2) ¿Qué está pasando exactamente y desde cuándo?",
      "",
      "Si el equipo se calienta mucho, huele a quemado o la batería está hinchada, mejor deja de usarlo y te derivamos.",
    ].join("\n");
  };

  const key = getAiApiKey();
  if (!key) return fallback();

  const completionsUrl = getAiChatCompletionsUrl();
  const system = [
    "Eres un asesor humano de soporte técnico para una empresa de radiocomunicación.",
    "Hablas en español chileno, tono cordial, profesional y claro.",
    "Entrega una respuesta útil y concreta.",
    "Evita modismos o expresiones demasiado coloquiales como 'bacán', 'cachai', 'al tiro', 'altiro', 'dale', 'te leo' o similares.",
    "Prefiere un vocabulario profesional, natural y respetuoso.",
    "Puedes dar orientación técnica general (por ejemplo: conceptos como IP, temperatura, golpes, buenas prácticas).",
    "No afirmes características específicas de un modelo si no están en la base de conocimiento.",
    "No inventes datos de la empresa ni procedimientos internos.",
    "Si no hay un dato exacto del modelo, responde con orientación general útil sin decir que no tienes información, sin mencionar base de datos ni falta de datos internos.",
    "Si falta contexto del caso, haz 1 pregunta breve para afinar la recomendación.",
    "Nunca menciones que eres una IA.",
    "Nunca uses etiquetas como <think> ni expliques tu razonamiento.",
    "Entrega solo el mensaje final listo para WhatsApp, sin encabezados ni meta-explicaciones.",
  ].join(" ");

  const knowledgeLines =
    knowledge.length > 0
      ? knowledge.map((k) => `- ${k.tema}: ${k.info}`).join("\n")
      : "- Entrega orientación técnica general y recomendaciones de cuidado/validación aplicables.";

  const user = [
    `Mensaje del cliente: ${input}`,
    "",
    "Base de conocimiento (servicio_tecnico):",
    knowledgeLines,
    "",
    "Responde con una recomendación/ayuda en un único mensaje.",
  ].join("\n");

  try {
    const res = await fetch(completionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getAiModel(),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 900,
      }),
    });
    if (!res.ok) return fallback();
    const data = (await res.json()) as unknown;
    const choices = isRecord(data) ? getRecordValue(data, "choices") : undefined;
    const first = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
    const message = isRecord(first) ? getRecordValue(first, "message") : undefined;
    const content = isRecord(message) ? getRecordValue(message, "content") : undefined;
    if (typeof content === "string" && content.trim()) {
      const cleaned = sanitizeServiceTechAiOutput(sanitizeAiOutput(content));
      if (cleaned) return cleaned;
    }
    return fallback();
  } catch {
    return fallback();
  }
}

function isCatalogAdviceRequest(text: string) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    t.includes("recomi") ||
    t.includes("cual recomi") ||
    t.includes("cual me recomi") ||
    t.includes("que opcion me recomi") ||
    t.includes("que opcion recomi") ||
    t.includes("propon") ||
    t.includes("propoc") ||
    t.includes("cual es mejor") ||
    t.includes("cual me conviene") ||
    t.includes("cuál es mejor") ||
    t.includes("cuál me conviene") ||
    t.includes("no conozco ninguno") ||
    t.includes("no conozco") ||
    t.includes("no se cual") ||
    t.includes("no sé cual") ||
    t.includes("no se cuál") ||
    t.includes("no sé cuál") ||
    t.includes("que me sugieres") ||
    t.includes("qué me sugieres") ||
    t.includes("que me aconsejas") ||
    t.includes("qué me aconsejas") ||
    t.includes("me orientas") ||
    t.includes("me ayudas a elegir") ||
    t.includes("ayudame a elegir") ||
    t.includes("ayúdame a elegir") ||
    t.includes("explic") ||
    t.includes("explica") ||
    t.includes("explicame") ||
    t.includes("explícame") ||
    t.includes("cuales son") ||
    t.includes("cuáles son") ||
    t.includes("diferencia") ||
    t.includes("diferencias") ||
    t.includes("compar")
  );
}

function isCatalogComparisonRequest(text: string) {
  const t = normalizeText(text);
  if (!t) return false;
  return t.includes("diferencia") || t.includes("diferencias") || t.includes("compar") || t.includes("versus") || t.includes("vs");
}

function extractCatalogUsageContext(text: string) {
  const t = normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  const signals: string[] = [];
  if (t.includes("terreno") || t.includes("faena") || t.includes("exterior") || t.includes("campo")) signals.push("uso en terreno/exterior");
  if (t.includes("interior") || t.includes("urbano") || t.includes("edificio") || t.includes("oficina")) signals.push("uso en interior/urbano");
  if (t.includes("vehiculo") || t.includes("vehículos") || t.includes("movil") || t.includes("móvil")) signals.push("uso en vehículo");
  if (t.includes("base fija") || t.includes("base") || t.includes("puesto fijo")) signals.push("uso en base fija");
  if (t.includes("repetidor") || t.includes("repeticion") || t.includes("repetición") || t.includes("cobertura")) signals.push("uso como repetición/cobertura");
  if (!signals.length) return "";
  return Array.from(new Set(signals)).join(", ");
}

function shouldKeepCatalogAdviceThread(text: string) {
  const t = normalizeText(text);
  if (!t) return false;
  return Boolean(
    extractCatalogUsageContext(text) ||
      t.includes("no conozco") ||
      t.includes("no se cual") ||
      t.includes("no sé cual") ||
      t.includes("cual me recomiendas") ||
      t.includes("cuál me recomiendas") ||
      t.includes("cual conviene") ||
      t.includes("cuál conviene") ||
      t.includes("para terreno") ||
      t.includes("para vehiculo") ||
      t.includes("para vehículo") ||
      t.includes("para base") ||
      t.includes("para interior") ||
      t.includes("para exterior")
  );
}

async function buildCatalogAdviceFollowUpReply(args: {
  input: string;
  country: Country;
  requestKind?: CatalogRequestKind;
  list: Array<{ product_id: string; nombre: string }>;
  mode: "recommend" | "compare";
  referencedNumbers?: number[];
  usageContext: string;
}): Promise<Reply> {
  const max = Math.min(CATALOG_MAX_LIST_ITEMS, args.list.length);
  const picked = (args.referencedNumbers?.length
    ? args.referencedNumbers.map((n) => args.list[n - 1]).filter(Boolean)
    : args.list.slice(0, Math.min(4, max))) as Array<{ product_id: string; nombre: string }>;

  const details = (
    await Promise.all(
      picked.map(async (item) => {
        if (!item?.product_id) return null;
        const detail = await loadProductDetailByCountry(args.country, item.product_id);
        if (detail) return { ...detail, nombre: detail.nombre || item.nombre };
        return null;
      }),
    )
  ).filter((detail): detail is ProductDetail => Boolean(detail));

  if (!details.length) return "";

  const preface = `Perfecto. Consideraré ${args.usageContext} para orientarte mejor.`;
  const footer =
    args.mode === "compare"
      ? ""
      : `Si quieres ver la ficha completa, indícame el número (${args.referencedNumbers?.length ? args.referencedNumbers.join(", ") : `1–${max}`}) o el nombre del producto.`;
  const augmentedInput = `${args.input}\nContexto adicional del cliente: ${args.usageContext}.`;
  const advice = await generateCatalogAiAnswer({
    input: augmentedInput,
    country: args.country,
    requestKind: args.requestKind,
    products: details,
    mode: args.mode,
  });
  const adviceText = String(advice || "").trim();
  const footerSignal = "si quieres ver la ficha completa";
  const hasFooterAlready = normalizeText(adviceText).includes(footerSignal);
  return [preface, "", adviceText, ...(hasFooterAlready ? [] : ["", footer])].filter(Boolean).join("\n");
}

function buildCatalogPendingAdviceReply(args: { country: Country; pending: CatalogPendingOptions }) {
  const n = args.pending.options.length;
  const attr = String(args.pending.attr || "");
  const explain = (() => {
    if (attr === "portabilidad") {
      return [
        "Diferencias rápidas:",
        "",
        "1) 📻 Portátiles (Handy): para uso personal en terreno. Más compactos y fáciles de transportar.",
        "2) 🚗 Móviles (vehículo/base): se instalan en vehículos o puestos fijos. Mayor potencia y mejor desempeño con antena externa.",
        "3) 📡 Repetidores: amplían la cobertura y ayudan a comunicar a mayor distancia (infraestructura).",
      ].join("\n");
    }
    if (attr === "frecuencia") {
      return [
        "Diferencias rápidas:",
        "",
        "- UHF: suele rendir mejor dentro de edificios y zonas urbanas.",
        "- VHF: suele rendir mejor en espacios abiertos y largas distancias con menos obstáculos.",
        "- ANÁLOGO: más simple, compatible y generalmente más económico.",
        "- DIGITAL: mejor calidad/alcance percibido, funciones como llamadas privadas y mejor manejo de ruido (según estándar).",
      ].join("\n");
    }
    if (attr === "tecnologia") {
      return [
        "Diferencias rápidas:",
        "",
        "- ANÁLOGO: simple y muy compatible, ideal si ya tienes una flota analógica.",
        "- DIGITAL: mejor gestión de audio y funciones avanzadas (según estándar).",
        "Si ya tienes equipos, dime el modelo o la tecnología actual y te guío para elegir compatible.",
      ].join("\n");
    }
    if (attr === "modalidad") {
      return [
        "Diferencias rápidas:",
        "",
        "- Venta: compras el equipo, queda en propiedad.",
        "- Arriendo: pago periódico y soporte según el plan; ideal para eventos o necesidades temporales.",
      ].join("\n");
    }
    if (attr === "tipo_producto") {
      return [
        "Diferencias rápidas:",
        "",
        "- Equipos radio: radios portátiles o móviles para comunicación.",
        "- Accesorios: baterías, cargadores, antenas, micrófonos, etc.",
        "- Repetidores / infraestructura: para ampliar cobertura.",
        "- Cámaras corporales: registro de video para seguridad/operación.",
      ].join("\n");
    }
    return "Puedo explicarte las diferencias entre estas opciones antes de que elijas.";
  })();

  return [
    explain,
    "",
    "Para continuar, elige una opción:",
    "",
    ...renderNumberedOptionLabels(args.pending.options),
    "",
    `Responde con un número (1–${n}) o escribe la opción.`,
  ].join("\n");
}

function extractReferencedChoiceNumbers(input: string, max: number) {
  const matches = Array.from(input.matchAll(/\b([1-9])\b/g))
    .map((m) => Number(m[1]))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= max);
  return Array.from(new Set(matches)).slice(0, 4);
}

async function generateCatalogAiAnswer(args: {
  input: string;
  country: Country;
  requestKind?: CatalogRequestKind;
  products: ProductDetail[];
  mode: "recommend" | "compare";
}) {
  const fallback = () => {
    const top = args.products.slice(0, 3);
    const pick = (p: ProductDetail) => {
      const shortSummary = buildProductExecutiveSummary(p, 220);
      const price = formatFriendlyPrice(p.precio ?? "", args.country);
      return {
        name: cleanProductName(p.nombre),
        price,
        summary: shortSummary || "Sin detalle suficiente para resumir en este momento.",
      };
    };
    const bullets = top.map(pick);
    if (args.mode === "compare") {
      const compared = bullets.slice(0, 3).map((b, idx) => {
        const head = `${idx + 1}) ${b.name}`;
        const price = b.price ? `- ${b.price}` : "";
        const reason = `- Diferencia principal: ${b.summary}`;
        return [head, price, reason].filter(Boolean).join("\n");
      });
      const closing =
        bullets.length >= 2
          ? `En términos generales, ${bullets[0]?.name} conviene si buscas una alternativa más estándar, mientras que ${bullets[1]?.name} apunta a un uso más exigente o con mayores prestaciones dentro de la misma familia.`
          : "Con la información disponible, esa es la diferencia principal entre los modelos consultados.";
      return [
        "Estas son las diferencias más relevantes entre los modelos consultados:",
        "",
        ...compared,
        "",
        closing,
      ]
        .filter(Boolean)
        .join("\n");
    }
    const recommended = bullets.slice(0, 2);
    const recLines = recommended.map((b, idx) => {
      const head = `✅ Recomendación ${idx + 1}: ${b.name}`;
      const reason = `- Por qué: ${b.summary}`;
      const price = b.price ? `- ${b.price}` : "";
      return [head, reason, price].filter(Boolean).join("\n");
    });
    const alt = bullets[2] ? [`Alternativa adicional: ${bullets[2].name}`, `- ${bullets[2].summary}`].join("\n") : "";
    const context = args.requestKind === "arriendo" ? "📌 Contexto: arriendo" : "📌 Contexto: compra/cotización";
    return [context, ...recLines, alt].filter(Boolean).join("\n\n");
  };

  const key = getAiApiKey();
  if (!key) return fallback();

  const completionsUrl = getAiChatCompletionsUrl();
  const system = [
    "Eres un asesor humano de ventas para una empresa de radiocomunicación.",
    "Hablas en español, tono profesional, claro y cercano.",
    "Tu tarea es orientar al cliente entre varios productos del catálogo.",
    "Usa solo la información entregada en los productos disponibles.",
    "No inventes características, certificaciones, stock ni precios.",
    "Si hay precio disponible, puedes mencionarlo como precio referencial.",
    "Si el cliente pide recomendación, sugiere 1 o 2 opciones y explica brevemente por qué.",
    "Si el cliente pide diferencias, entrega una comparación final redactada como asesor comercial, no como ficha técnica pegada.",
    "Analiza la descripción de cada producto y sintetiza la información; no copies bloques largos ni concatines frases sin procesarlas.",
    "Prioriza en tu respuesta: uso recomendado, capacidades clave y diferencias reales entre modelos.",
    "Cuando compares, explica en lenguaje natural qué aporta cada modelo y para qué escenario conviene más.",
    "Evita encabezados rígidos como 'Resumen ejecutivo', 'Perfil técnico', 'Lectura rápida' o listados plantilla salvo que sean realmente necesarios.",
    "No cierres con preguntas ni solicites más datos si el cliente solo pidió diferencias o recomendación general.",
    "Para comparaciones, ordena la respuesta con un encabezado breve y luego bloques numerados: 1), 2), 3).",
    "Cada bloque debe comenzar con el nombre del modelo y luego continuar en líneas separadas con precio referencial y diferencia principal.",
    "Después de los bloques numerados, puedes cerrar con una conclusión breve en un párrafo aparte.",
    "No uses tablas ni markdown complejo; la respuesta debe quedar lista para WhatsApp.",
    "No incluyas instrucciones de navegación como 'elige un número' o 'indícame el número'; eso lo agrega el sistema.",
    "Nunca menciones que eres una IA.",
    args.requestKind === "arriendo"
      ? "Si el contexto es arriendo, orienta la comparación hacia continuidad operativa, facilidad de uso, robustez y conveniencia para operación temporal. No inventes ni entregues precios de arriendo."
      : "Si el contexto es compra/cotización, orienta la comparación hacia conveniencia técnica y operativa para una decisión comercial.",
  ].join(" ");

  const productsBlock = args.products
    .map((product, index) =>
      [
        `${index + 1}. ${cleanProductName(product.nombre)}`,
        product.precio ? `Precio: ${formatFriendlyPrice(product.precio, args.country).replace(/^💰\s*/, "")}` : "",
        `Resumen ejecutivo: ${buildProductExecutiveSummary(product, 520)}`,
        product.fullDescription ? `Descripción base: ${getProductDescriptionText(product)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

  const user = [
    `Mensaje del cliente: ${args.input}`,
    `Modo: ${args.mode === "compare" ? "comparar opciones" : "recomendar una opción"}`,
    args.requestKind === "arriendo" ? "Contexto: el cliente está consultando por arriendo." : "Contexto: el cliente está consultando por compra/cotización.",
    "",
    "Productos disponibles:",
    productsBlock,
    "",
    args.mode === "compare"
      ? [
          "Responde en un solo mensaje final, natural y útil.",
          "Compara solo las diferencias más relevantes entre 2 o 3 modelos, orienta cuál conviene según el escenario y evita repetir texto del catálogo.",
          "Usa este orden de salida:",
          "Estas son las diferencias más relevantes entre los modelos consultados:",
          "1) [Modelo]",
          "- Precio referencial: ...",
          "- Diferencia principal: ...",
          "2) [Modelo]",
          "- Precio referencial: ...",
          "- Diferencia principal: ...",
          "Conclusión general: ...",
          "Cierra con una conclusión breve en un párrafo aparte.",
        ].join("\n")
      : "Responde en un solo mensaje breve, útil y orientado a decisión.",
  ].join("\n");

  try {
    const res = await fetch(completionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getAiModel(),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 1800,
      }),
    });
    if (!res.ok) return fallback();
    const data = (await res.json()) as unknown;
    const choices = isRecord(data) ? getRecordValue(data, "choices") : undefined;
    const first = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
    const message = isRecord(first) ? getRecordValue(first, "message") : undefined;
    const content = isRecord(message) ? getRecordValue(message, "content") : undefined;
    if (typeof content === "string" && content.trim()) {
      const cleanedBase = sanitizeAiOutput(content);
      const cleaned = args.mode === "compare" ? formatCatalogComparisonOutput(cleanedBase) : cleanedBase;
      if (cleaned) return cleaned;
    }
    return fallback();
  } catch {
    return fallback();
  }
}

async function generateKnowledgeAiAnswer(args: { role: "proyectos" | "cambium" | "empresa"; input: string; knowledgeText: string }) {
  const input = (args.input || "").trim();
  const knowledgeText = (args.knowledgeText || "").trim();
  if (!input) return "";

  const key = getAiApiKey();
  if (!key || !knowledgeText) return "";

  const completionsUrl = getAiChatCompletionsUrl();
  const systemBase = [
    "Eres un asesor humano para una empresa de telecomunicaciones y radiocomunicación.",
    "Hablas en español, tono cordial, profesional y claro.",
    "Sé breve, claro y sin redundancias.",
    "Evita modismos o expresiones demasiado coloquiales como 'bacán', 'cachai', 'al tiro', 'altiro', 'dale', 'te leo' o similares.",
    "Prefiere un vocabulario profesional, natural y respetuoso.",
    "No inventes datos: si no está en la base, dilo y pide un dato.",
    "Nunca menciones que eres una IA.",
    "Nunca uses etiquetas como <think> ni expliques tu razonamiento.",
    "Entrega solo el mensaje final listo para WhatsApp, sin encabezados ni meta-explicaciones.",
  ];
  const systemExtra =
    args.role === "proyectos"
      ? ["Enfócate en explicar proyectos, capacidades, certificaciones y enfoque de trabajo."]
      : args.role === "empresa"
        ? [
            "Enfócate en responder consultas institucionales sobre la empresa, su enfoque, capacidades y tipo de soluciones.",
            "Si el usuario pregunta qué es la empresa o a qué se dedica, sintetiza la respuesta en lenguaje natural, sin pegar frases literales una detrás de otra.",
            "Si el usuario hace una pregunta específica sobre la empresa, responde esa consulta usando la base disponible.",
            "No uses frases internas o indirectas como 'si el cliente quiere avanzar', 'la respuesta debe sonar' o similares.",
            "Si corresponde cerrar, usa una sola invitación breve y natural, orientada directamente al usuario.",
          ]
        : ["Enfócate en explicar Cambium Networks, sus soluciones y orientar la elección de categoría/producto."];
  const system = [...systemBase, ...systemExtra].join(" ");

  const user = [
    `Mensaje del cliente: ${input}`,
    "",
    "Base de conocimiento:",
    knowledgeText,
    "",
    "Responde con una orientación útil y concreta en un único mensaje.",
  ].join("\n");

  try {
    const res = await fetch(completionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getAiModel(),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 1200,
      }),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as unknown;
    const choices = isRecord(data) ? getRecordValue(data, "choices") : undefined;
    const first = Array.isArray(choices) ? (choices[0] as unknown) : undefined;
    const message = isRecord(first) ? getRecordValue(first, "message") : undefined;
    const content = isRecord(message) ? getRecordValue(message, "content") : undefined;
    if (typeof content === "string" && content.trim()) {
      const cleaned = sanitizeAiOutput(content);
      return cleaned || "";
    }
    return "";
  } catch {
    return "";
  }
}

function sanitizeAiOutput(raw: string) {
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

  const merged = safeLines
    .join("\n")
    .replace(/\b[Bb]acán\b/g, "excelente")
    .replace(/\b[Cc]achai\b/g, "comprendes")
    .replace(/\b[Aa]l\s+tiro\b/g, "de inmediato")
    .replace(/\b[Aa]ltiro\b/g, "de inmediato")
    .replace(/\b[Tt]e leo\b/g, "Quedo atento")
    .replace(/\b[Dd]ale\b/g, "Muy bien")
    .replace(/\b[Pp]erfecto\b/g, "Muy bien")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!merged) return "";
  return merged;
}

function formatCatalogComparisonOutput(raw: string) {
  const compact = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";

  const header = "Estas son las diferencias más relevantes entre los modelos consultados:";
  const body = compact
    .replace(/^estas son las diferencias mas relevantes entre los modelos consultados:\s*/i, "")
    .replace(/^estas son las diferencias más relevantes entre los modelos consultados:\s*/i, "")
    .trim();

  const sectionRegex = /(\d+\)\s+[\s\S]*?)(?=\s+\d+\)\s+|\s+Conclusión general:|\s+En términos generales,|$)/gi;
  const rawSections = Array.from(body.matchAll(sectionRegex))
    .map((match) => String(match[1] || "").trim())
    .filter(Boolean)
    .slice(0, 3);

  const formattedSections = rawSections.map((section) =>
    section
      .replace(/\s+[💰]?\s*Precio referencial:/i, "\n- Precio referencial:")
      .replace(/\s+-?\s*Diferencia principal:/i, "\n- Diferencia principal:")
      .replace(/\s+-?\s*Lo principal:/i, "\n- Lo principal:")
      .replace(/\s+-\s+/g, "\n- ")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );

  const conclusionMatch = body.match(/(?:Conclusión general:|En términos generales,)\s+([\s\S]+)$/i);
  const extractedConclusion = conclusionMatch?.[1]?.trim() ?? "";
  const modelNames = formattedSections
    .map((section) => section.match(/^\d+\)\s+([^\n-]+)/)?.[1]?.trim() ?? "")
    .filter(Boolean);

  const fallbackConclusion =
    modelNames.length >= 2
      ? `${modelNames[0]} y ${modelNames[1]} cubren necesidades similares, pero con diferencias de prestaciones y enfoque de uso. La mejor elección depende del nivel de exigencia operativa y de las funciones que se prioricen.`
      : "Los modelos consultados presentan diferencias de enfoque y prestaciones. La elección más conveniente depende del nivel de exigencia operativa y del tipo de uso previsto.";

  const conclusion = extractedConclusion || fallbackConclusion;

  if (!formattedSections.length) {
    return [header, "", `Conclusión general: ${conclusion}`].join("\n");
  }

  return [header, "", ...formattedSections, "", `Conclusión general: ${conclusion}`].join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeServiceTechAiOutput(raw: string) {
  return raw
    .replace(/(?:^|\n)\s*(?:hola[!,. ]*)?(?:gracias por (?:tu consulta|escribirnos)[^.:\n]*[.:]?)\s*/gim, "")
    .replace(/no (?:cuento|tengo) con la informacion[^.]*\.\s*/gim, "")
    .replace(/no tengo la informacion especifica[^.]*\.\s*/gim, "")
    .replace(/no (?:cuento|tengo) con la informacion tecnica exacta[^.]*\.\s*/gim, "")
    .replace(/en nuestra base de datos[^.]*\.\s*/gim, "")
    .replace(/para confirmartelo[^.]*\.\s*/gim, "")
    .replace(/lo que si te puedo decir(?:\s+en terminos generales)?\s+es\s+que\s*/gim, "")
    .replace(/lo que puedo decirte(?:\s+en terminos generales)?\s+es\s+que\s*/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function initState(): UserState {
  return {
    v: 1,
    greeted: false,
    activeBranch: "menu",
    recentInboundIds: [],
    recentInboundHashes: [],
    catalog: { filters: {}, status: "idle" },
    projects: { offset: 0, stage: "entry" },
    points: {},
    cambium: {},
  };
}

function resetBranchState(state: UserState, branch: Branch) {
  if (branch === "catalogo") {
    const forceAskAll = state.catalog.forceAskAll;
    state.catalog = { filters: {}, status: "idle", ...(forceAskAll ? { forceAskAll } : {}) };
  }
  if (branch === "servicio_tecnico") state.serviceTech = {};
  if (branch === "proyectos") state.projects = { offset: 0, stage: "entry" };
  if (branch === "puntos_venta") state.points = {};
  if (branch === "cambium") state.cambium = {};
}

function returnToCasualState(state: UserState) {
  state.activeBranch = "menu";
  resetBranchState(state, "catalogo");
  resetBranchState(state, "servicio_tecnico");
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
  const isBodycam = normalizeText(filters.tipo_producto || "").includes("camara") || normalizeText(filters.tipo_producto || "").includes("cámara") || normalizeText(filters.tipo_producto || "").includes("body");
  const queryLimit = isBodycam ? 50 : filters.tecnologia ? 40 : 10;
  const params: string[] = [
    `select=product_id,nombre,tecnologia,frecuencia`,
    `tipo_producto=ilike.${encodeURIComponent(filters.tipo_producto)}`,
    `limit=${queryLimit}`,
    `order=nombre.asc`,
  ];
  if (filters.modalidad) {
    const m = filters.modalidad.trim();
    if (normalizeText(m) === "venta") {
      params.push(`or=(modalidad.is.null,modalidad.ilike.*${encodeURIComponent(m)}*)`);
    } else {
      params.push(`modalidad=ilike.*${encodeURIComponent(m)}*`);
    }
  }
  if (filters.portabilidad) params.push(`portabilidad=eq.${encodeURIComponent(filters.portabilidad)}`);
  const freqWanted = (filters.frecuencia ?? "").trim();
  const freqNorm = normalizeText(freqWanted);
  const isBand = freqNorm === "uhf" || freqNorm === "vhf";
  if (filters.frecuencia && !isBand) params.push(`frecuencia=ilike.*${encodeURIComponent(filters.frecuencia)}*`);
  const q = `inter_products?${params.join("&")}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[])
    .map((r) => ({
      product_id: toTrimmedString(getRecordValue(r, "product_id")),
      nombre: toTrimmedString(getRecordValue(r, "nombre")),
      tecnologia: toTrimmedString(getRecordValue(r, "tecnologia")),
      frecuencia: toLooseText(getRecordValue(r, "frecuencia")),
    }))
    .filter((r) => r.product_id && r.nombre)
    .filter((r) => matchesSelectedTechnology(r.tecnologia, filters.tecnologia))
    .filter((r) => (isBand ? matchesSelectedFrequencyBand(r.frecuencia, filters.frecuencia) : true))
    .map((r) => ({ product_id: r.product_id, nombre: r.nombre }))
    .slice(0, 25)
    .filter((r) => r.product_id && r.nombre);
}

async function queryRadioTechFrequencyPairsCL(filters: CatalogFilters) {
  if (!filters.tipo_producto) return [] as Array<{ tecnologia: string; frecuencia: string }>;
  const params: string[] = [
    `select=tecnologia,frecuencia`,
    `tipo_producto=ilike.${encodeURIComponent(filters.tipo_producto)}`,
    `limit=200`,
  ];
  if (filters.modalidad) {
    const m = filters.modalidad.trim();
    if (normalizeText(m) === "venta") {
      params.push(`or=(modalidad.is.null,modalidad.ilike.*${encodeURIComponent(m)}*)`);
    } else {
      params.push(`modalidad=ilike.*${encodeURIComponent(m)}*`);
    }
  }
  if (filters.portabilidad) params.push(`portabilidad=eq.${encodeURIComponent(filters.portabilidad)}`);
  const q = `inter_products?${params.join("&")}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[])
    .map((r) => ({
      tecnologia: toLooseText(getRecordValue(r, "tecnologia")),
      frecuencia: toLooseText(getRecordValue(r, "frecuencia")),
    }))
    .filter((r) => r.tecnologia && r.frecuencia);
}

async function buildAvailableRadioFrequencyTechnologyOptionsCL(filters: CatalogFilters): Promise<CatalogPendingOption[]> {
  const base: CatalogFilters = {
    ...filters,
    tecnologia: undefined,
    frecuencia: undefined,
  };
  const pairs = await queryRadioTechFrequencyPairsCL(base);
  const has = new Set<string>();
  for (const p of pairs) {
    const tech = hasDigitalTechnology(p.tecnologia) ? "DIGITAL" : hasAnalogTechnology(p.tecnologia) ? "ANÁLOGO" : "";
    if (!tech) continue;
    const bands = detectFrequencyBandsFromText(p.frecuencia);
    for (const band of bands) {
      has.add(`${band}|${tech}`);
    }
  }

  const out: CatalogPendingOption[] = [];
  const push = (band: "UHF" | "VHF", tech: "ANÁLOGO" | "DIGITAL") => {
    if (!has.has(`${band}|${tech}`)) return;
    out.push({
      label: `${band} - ${tech}`,
      value: `${band} - ${tech}`,
      applyFilters: { frecuencia: band, tecnologia: tech },
    });
  };
  push("UHF", "ANÁLOGO");
  push("UHF", "DIGITAL");
  push("VHF", "ANÁLOGO");
  push("VHF", "DIGITAL");

  out.push({
    label: "No estoy seguro / Contactar con un asesor",
    value: "No estoy seguro / Contactar con un asesor",
    skipRadioTechFrequency: true,
  });

  return out.length > 1 ? out : buildRadioFrequencyTechnologyOptions();
}

async function queryProductsByName(filters: CatalogFilters, query: string): Promise<Array<{ product_id: string; nombre: string }>> {
  if (!filters.tipo_producto) return [];
  const patterns = buildCatalogNameSearchPatterns(query);
  if (!patterns.length) return [];
  const pattern = patterns[patterns.length - 1]!;
  const isBodycam = normalizeText(filters.tipo_producto || "").includes("camara") || normalizeText(filters.tipo_producto || "").includes("cámara") || normalizeText(filters.tipo_producto || "").includes("body");
  const queryLimit = isBodycam ? 60 : filters.tecnologia ? 60 : 25;
  const params: string[] = [
    `select=product_id,nombre,tecnologia,frecuencia`,
    `tipo_producto=ilike.${encodeURIComponent(filters.tipo_producto)}`,
    `nombre=ilike.${encodeIlikePattern(pattern)}`,
    `limit=${queryLimit}`,
    `order=nombre.asc`,
  ];
  if (filters.modalidad) {
    const m = filters.modalidad.trim();
    if (normalizeText(m) === "venta") {
      params.push(`or=(modalidad.is.null,modalidad.ilike.*${encodeURIComponent(m)}*)`);
    } else {
      params.push(`modalidad=ilike.*${encodeURIComponent(m)}*`);
    }
  }
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
    .slice(0, 25)
    .filter((r) => r.product_id && r.nombre);
}

async function queryProductsByNameBroad(
  country: Country,
  modalidad: string | undefined,
  query: string,
): Promise<Array<{ product_id: string; nombre: string }>> {
  const patterns = buildCatalogNameSearchPatterns(query);
  if (!patterns.length) return [];
  const pattern = patterns[patterns.length - 1]!;
  const table = country === "UY" ? getUyProductsTable() : "inter_products";
  const params: string[] = [
    `select=product_id,nombre`,
    `nombre=ilike.${encodeIlikePattern(pattern)}`,
    `limit=25`,
    `order=nombre.asc`,
  ];
  if (modalidad) {
    const m = modalidad.trim();
    if (normalizeText(m) === "venta") {
      params.push(`or=(modalidad.is.null,modalidad.ilike.*${encodeURIComponent(m)}*)`);
    } else {
      params.push(`modalidad=ilike.*${encodeURIComponent(m)}*`);
    }
  }
  const q = `${table}?${params.join("&")}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[])
    .map((r) => ({
      product_id: toTrimmedString(getRecordValue(r, "product_id")),
      nombre: toTrimmedString(getRecordValue(r, "nombre")),
    }))
    .filter((r) => r.product_id && r.nombre)
    .slice(0, 25);
}

async function queryDirectCatalogCandidatesBroad(
  country: Country,
  filters: CatalogFilters,
  query: string,
): Promise<CatalogProductCandidate[]> {
  const patterns = buildCatalogNameSearchPatterns(query);
  if (!patterns.length) return [];
  const pattern = patterns[patterns.length - 1]!;
  const table = country === "UY" ? getUyProductsTable() : "inter_products";
  const params: string[] = [
    `select=product_id,nombre,tipo_producto,modalidad,tecnologia,frecuencia`,
    `nombre=ilike.${encodeIlikePattern(pattern)}`,
    `limit=40`,
    `order=nombre.asc`,
  ];
  if (filters.modalidad) {
    const m = filters.modalidad.trim();
    if (normalizeText(m) === "venta") {
      params.push(`or=(modalidad.is.null,modalidad.ilike.*${encodeURIComponent(m)}*)`);
    } else {
      params.push(`modalidad=ilike.*${encodeURIComponent(m)}*`);
    }
  }
  const q = `${table}?${params.join("&")}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return [];
  return (res.data as unknown[])
    .map((r) => ({
      product_id: toTrimmedString(getRecordValue(r, "product_id")),
      nombre: toTrimmedString(getRecordValue(r, "nombre")),
      tipo_producto: toTrimmedString(getRecordValue(r, "tipo_producto")),
      modalidad: toTrimmedString(getRecordValue(r, "modalidad")),
      tecnologia: toTrimmedString(getRecordValue(r, "tecnologia")),
      frecuencia: toTrimmedString(getRecordValue(r, "frecuencia")),
    }))
    .filter((r) => r.product_id && r.nombre);
}

async function tryDirectCatalogModelLookup(state: UserState, country: Country, input: string): Promise<Reply | null> {
  const modelQuery = extractCatalogModelQuery(input);
  if (!modelQuery) return null;
  const inputHints = extractCatalogEntityHints(input);

  const strictFound = state.catalog.filters.tipo_producto ? await (country === "UY" ? queryProductsByNameUY(state.catalog.filters, modelQuery) : queryProductsByName(state.catalog.filters, modelQuery)) : [];
  const relaxedFound =
    strictFound.length || !state.catalog.filters.tipo_producto
      ? strictFound
      : await (country === "UY"
          ? queryProductsByNameUY({ ...state.catalog.filters, frecuencia: undefined, tecnologia: undefined, portabilidad: undefined }, modelQuery)
          : queryProductsByName({ ...state.catalog.filters, frecuencia: undefined, tecnologia: undefined, portabilidad: undefined }, modelQuery));
  const broadCandidates = relaxedFound.length ? [] : await queryDirectCatalogCandidatesBroad(country, state.catalog.filters, modelQuery);
  const searchBase: CatalogProductCandidate[] = relaxedFound.length
    ? relaxedFound.map((item) => ({ ...item }))
    : broadCandidates;

  if (!searchBase.length) {
    return buildDirectCatalogMissReply({
      modelQuery,
      targetKind: detectDirectCatalogTargetKind(input, state.catalog.filters, state.catalog.leadContext),
      requestKind: state.catalog.requestKind,
    });
  }

  const targetKind = detectDirectCatalogTargetKind(input, state.catalog.filters, state.catalog.leadContext);
  const ranked = dedupeCatalogCandidates(searchBase)
    .map((candidate) => ({
      candidate,
      score: scoreDirectCatalogCandidate(candidate, modelQuery, state.catalog.filters, targetKind),
    }))
    .sort((a, b) => b.score - a.score || a.candidate.nombre.localeCompare(b.candidate.nombre, "es"));

  const topScore = ranked[0]?.score ?? 0;
  const accessoryMatches = searchBase.filter((candidate) => isAccessoryTipoProducto(candidate.tipo_producto) || isAccessoryLikeProductName(candidate.nombre)).length;
  if (!ranked.length || topScore < 35) {
    return buildDirectCatalogMissReply({
      modelQuery,
      targetKind,
      requestKind: state.catalog.requestKind,
      accessoryMatches,
    });
  }

  const prioritized = ranked.map((entry) => ({ product_id: entry.candidate.product_id, nombre: entry.candidate.nombre }));
  const shown =
    targetKind === "bodycam" && state.catalog.filters.tipo_producto && isBodycamTipoProducto(state.catalog.filters.tipo_producto)
      ? await pickBestBodycamList(country, prioritized)
      : prioritized.slice(0, CATALOG_MAX_LIST_ITEMS);
  const top = ranked[0];
  const second = ranked[1];
  const explicitVariantMatches = ranked.filter((entry) =>
    matchesExplicitDirectCatalogHints(
      entry.candidate,
      {
        frequencyBand: inputHints.frequencyBand,
        technologyHint: inputHints.technologyHint,
      },
      targetKind,
    ),
  );
  const chosen =
    shown.length === 1
      ? shown[0]!
      : explicitVariantMatches.length === 1
        ? { product_id: explicitVariantMatches[0]!.candidate.product_id, nombre: explicitVariantMatches[0]!.candidate.nombre }
      : top && top.score >= 110 && (!second || top.score - second.score >= 18)
        ? { product_id: top.candidate.product_id, nombre: top.candidate.nombre }
        : null;

  if (chosen) {
    const previousList = state.catalog.lastList?.length ? state.catalog.lastList : undefined;
    state.catalog.pending = undefined;
    state.catalog.adviceContext = undefined;
    state.catalog.selectedProductId = chosen.product_id;
    state.catalog.lastList = shown;
    state.catalog.returnList = previousList?.length ? previousList : undefined;
    const detail = await loadProductDetailByCountry(country, chosen.product_id, chosen.nombre);
    if (!detail) return "No pude cargar la ficha de ese producto. Indícame otra opción o escribe Nueva búsqueda.";
    return buildProductFichaMessages(detail, { requestKind: state.catalog.requestKind, country });
  }

  state.catalog.pending = undefined;
  state.catalog.selectedProductId = undefined;
  state.catalog.adviceContext = undefined;
  state.catalog.lastList = shown;
  state.catalog.returnList = undefined;
  const lines = shown.map((p, i) => `${i + 1}) ${cleanProductName(p.nombre)}`).join("\n");
  return [
    `Encontré estas opciones para "${modelQuery.toUpperCase()}":`,
    "",
    lines,
    "",
    "Indícame qué opción quieres para mostrarte su ficha. También puedes escribir: Nueva búsqueda o Menú.",
    "Si quieres, también puedo recomendarte una alternativa o explicarte las diferencias entre estos modelos.",
  ].join("\n");
}

async function queryProductsUY(filters: CatalogFilters): Promise<Array<{ product_id: string; nombre: string }>> {
  if (!filters.tipo_producto) return [];
  const table = getUyProductsTable();
  const isBodycam = normalizeText(filters.tipo_producto || "").includes("camara") || normalizeText(filters.tipo_producto || "").includes("cámara") || normalizeText(filters.tipo_producto || "").includes("body");
  const queryLimit = isBodycam ? 50 : filters.tecnologia ? 40 : 10;
  const params: string[] = [
    `select=product_id,nombre,tecnologia,frecuencia`,
    `tipo_producto=ilike.${encodeURIComponent(filters.tipo_producto)}`,
    `limit=${queryLimit}`,
    `order=nombre.asc`,
  ];
  if (filters.modalidad) {
    const m = filters.modalidad.trim();
    if (normalizeText(m) === "venta") {
      params.push(`or=(modalidad.is.null,modalidad.ilike.*${encodeURIComponent(m)}*)`);
    } else {
      params.push(`modalidad=ilike.*${encodeURIComponent(m)}*`);
    }
  }
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
    .slice(0, 25)
    .filter((r) => r.product_id && r.nombre);
}

async function queryProductsByNameUY(filters: CatalogFilters, query: string): Promise<Array<{ product_id: string; nombre: string }>> {
  if (!filters.tipo_producto) return [];
  const patterns = buildCatalogNameSearchPatterns(query);
  if (!patterns.length) return [];
  const pattern = patterns[patterns.length - 1]!;
  const table = getUyProductsTable();
  const isBodycam = normalizeText(filters.tipo_producto || "").includes("camara") || normalizeText(filters.tipo_producto || "").includes("cámara") || normalizeText(filters.tipo_producto || "").includes("body");
  const queryLimit = isBodycam ? 60 : filters.tecnologia ? 60 : 25;
  const params: string[] = [
    `select=product_id,nombre,tecnologia,frecuencia`,
    `tipo_producto=ilike.${encodeURIComponent(filters.tipo_producto)}`,
    `nombre=ilike.${encodeIlikePattern(pattern)}`,
    `limit=${queryLimit}`,
    `order=nombre.asc`,
  ];
  if (filters.modalidad) {
    const m = filters.modalidad.trim();
    if (normalizeText(m) === "venta") {
      params.push(`or=(modalidad.is.null,modalidad.ilike.*${encodeURIComponent(m)}*)`);
    } else {
      params.push(`modalidad=ilike.*${encodeURIComponent(m)}*`);
    }
  }
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
    .slice(0, 25)
    .filter((r) => r.product_id && r.nombre);
}
async function loadProductDetail(productId: string) {
  const select = encodeURIComponent(`ID,Tipo,Nombre,"Descripción corta","Descripción","Imágenes","Precio normal"`);
  const q = `inter_products_staging?select=${select}&ID=eq.${encodeURIComponent(productId)}&limit=1`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return null;
  const row = (res.data as unknown[])[0];
  if (!row) return null;
  const tipo = toTrimmedString(getRecordValue(row, "Tipo"));
  const nombre = toTrimmedString(getRecordValue(row, "Nombre"));
  const descCorta = toTrimmedString(getRecordValue(row, "Descripción corta"));
  const desc = toTrimmedString(getRecordValue(row, "Descripción"));
  const imagenes = toTrimmedString(getRecordValue(row, "Imágenes"));
  const precio = toTrimmedString(getRecordValue(row, "Precio normal"));
  const imageUrl = imagenes
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean)[0];
  const parentDescription = tipo.toLowerCase() === "variation" ? await loadParentStagingDescription(nombre) : "";
  const fichaUrl = extractFichaTecnicaUrl(`${parentDescription}\n${descCorta}\n${desc}`);
  const descCompleta = htmlToParagraphText([parentDescription, desc, descCorta].filter(Boolean).join("\n"));
  const descPlano = htmlToParagraphText(parentDescription || desc || descCorta);
  const shortSource = parentDescription || desc || descCorta;
  const shortText = htmlToParagraphText(shortSource).slice(0, 600).trim();
  const shortFinal = shortText.length >= 590 ? shortText.slice(0, 590).trim() : shortText;

  return { productId, nombre, shortFinal, fullDescription: descCompleta, imageUrl, fichaUrl, precio };
}

async function buildProductDetailFromStagingRow(
  row: unknown,
  preferredName?: string,
): Promise<ProductDetail | null> {
  if (!row) return null;
  const productId = toTrimmedString(getRecordValue(row, "ID")) || toTrimmedString(getRecordValue(row, "product_id"));
  const tipo = toTrimmedString(getRecordValue(row, "Tipo"));
  const nombre = toTrimmedString(getRecordValue(row, "Nombre")) || toTrimmedString(getRecordValue(row, "nombre"));
  if (!productId && !nombre) return null;
  const descCorta = toTrimmedString(getRecordValue(row, "Descripción corta")) || toTrimmedString(getRecordValue(row, "descripcion_corta"));
  const desc = toTrimmedString(getRecordValue(row, "Descripción")) || toTrimmedString(getRecordValue(row, "descripcion"));
  const imagenes = toTrimmedString(getRecordValue(row, "Imágenes")) || toTrimmedString(getRecordValue(row, "image_url"));
  const precio = toTrimmedString(getRecordValue(row, "Precio normal")) || toTrimmedString(getRecordValue(row, "precio"));
  const imageUrl = imagenes
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean)[0];
  const parentDescription = tipo.toLowerCase() === "variation" ? await loadParentStagingDescription(nombre) : "";
  const fichaUrl = extractFichaTecnicaUrl(`${parentDescription}\n${descCorta}\n${desc}`);
  const descCompleta = htmlToParagraphText([parentDescription, desc, descCorta].filter(Boolean).join("\n"));
  const shortSource = parentDescription || desc || descCorta;
  const shortText = htmlToParagraphText(shortSource).slice(0, 600).trim();
  const shortFinal = shortText.length >= 590 ? shortText.slice(0, 590).trim() : shortText;
  return {
    productId: productId || extractLikelyProductModel(preferredName || nombre) || "",
    nombre: preferredName || nombre,
    shortFinal,
    fullDescription: descCompleta,
    imageUrl,
    fichaUrl,
    precio,
  };
}

async function loadBestStagingProductDetailByName(nombre: string): Promise<ProductDetail | null> {
  const sourceName = toTrimmedString(nombre);
  if (!sourceName) return null;
  const model = extractLikelyProductModel(sourceName);
  const patterns = Array.from(
    new Set(
      [model, sourceName, cleanProductName(sourceName)]
        .filter(Boolean)
        .flatMap((seed) => buildCatalogNameSearchPatterns(seed))
        .slice(0, 6),
    ),
  );
  if (!patterns.length) return null;

  const rows: unknown[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const select = encodeURIComponent(`ID,Tipo,Nombre,"Descripción corta","Descripción","Imágenes","Precio normal"`);
    const q = `inter_products_staging?select=${select}&Nombre=ilike.${encodeIlikePattern(pattern)}&limit=20`;
    const res = await supabaseFetch(q, { method: "GET" });
    if (!res.ok || !Array.isArray(res.data)) continue;
    for (const row of res.data as unknown[]) {
      const id = toTrimmedString(getRecordValue(row, "ID")) || toTrimmedString(getRecordValue(row, "product_id"));
      const key = id || toTrimmedString(getRecordValue(row, "Nombre")) || toTrimmedString(getRecordValue(row, "nombre"));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  if (!rows.length) return null;

  const wantedModel = extractLikelyProductModel(sourceName);
  const wantedBand = detectFrequencyBandFromText(sourceName);
  const wantedTech = detectTechnologyHint(sourceName);

  const ranked = rows
    .map((row) => {
      const candidateName = toTrimmedString(getRecordValue(row, "Nombre")) || toTrimmedString(getRecordValue(row, "nombre"));
      const candidateTipo = toTrimmedString(getRecordValue(row, "Tipo"));
      const candidateDesc = `${toTrimmedString(getRecordValue(row, "Descripción corta"))}\n${toTrimmedString(getRecordValue(row, "Descripción"))}`;
      const candidateImages = toTrimmedString(getRecordValue(row, "Imágenes")) || toTrimmedString(getRecordValue(row, "image_url"));
      const candidatePrice = toTrimmedString(getRecordValue(row, "Precio normal")) || toTrimmedString(getRecordValue(row, "precio"));
      let score = 0;
      if (wantedModel && extractLikelyProductModel(candidateName) === wantedModel) score += 120;
      if (compactCatalogModelText(cleanProductName(candidateName)) === compactCatalogModelText(cleanProductName(sourceName))) score += 60;
      if (wantedBand) score += matchesSelectedFrequencyBand(candidateName, wantedBand) ? 30 : -15;
      if (wantedTech) score += matchesSelectedTechnology(candidateName, wantedTech) ? 28 : -12;
      if (candidateTipo && normalizeText(candidateTipo) !== "variation") score += 15;
      if (candidateImages) score += 24;
      if (candidatePrice) score += 18;
      if (htmlToParagraphText(candidateDesc).length >= 180) score += 20;
      return { row, score };
    })
    .sort((a, b) => b.score - a.score);

  return await buildProductDetailFromStagingRow(ranked[0]?.row, sourceName);
}

function buildStagingParentNameCandidates(nombre: string) {
  const raw = toTrimmedString(nombre);
  if (!raw) return [] as string[];
  const parts = raw.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const candidates: string[] = [];
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    candidates.push(parts.slice(0, i).join(" - "));
  }
  return Array.from(new Set([raw, ...candidates].filter(Boolean)));
}

async function loadParentStagingDescription(nombre: string) {
  const candidates = buildStagingParentNameCandidates(nombre).slice(1);
  for (const candidate of candidates) {
    const select = encodeURIComponent(`ID,Tipo,Nombre,"Descripción"`);
    const q = `inter_products_staging?select=${select}&Nombre=eq.${encodeURIComponent(candidate)}&Tipo=neq.variation&limit=1`;
    const res = await supabaseFetch(q, { method: "GET" });
    if (!res.ok || !Array.isArray(res.data)) continue;
    const row = (res.data as unknown[])[0];
    if (!row) continue;
    const description = toTrimmedString(getRecordValue(row, "Descripción"));
    if (description) return description;
  }
  return "";
}

async function loadCatalogProductCommercialData(args: { productId?: string; nombre?: string }) {
  const productId = toTrimmedString(args.productId);
  const nombre = toTrimmedString(args.nombre);
  const modelFromName = extractLikelyProductModel(nombre);
  const modelFromId = extractLikelyProductModel(productId);
  const candidate = modelFromName || modelFromId || nombre;
  if (!candidate) return null;

  const rawSeeds = [modelFromName, modelFromId, candidate].map((s) => toTrimmedString(s)).filter(Boolean);
  const seeds = Array.from(new Set(rawSeeds.filter((s) => /[a-z]/i.test(s))));
  const patterns = Array.from(new Set(seeds.flatMap((s) => buildCatalogNameSearchPatterns(s)))).slice(0, 4);
  if (!patterns.length) return null;
  const cols = ["producto", "nombre_modelo_especial", "modelo"] as const;
  const conditions = patterns.flatMap((p) => {
    const like = encodeIlikePattern(p);
    return cols.map((c) => `${c}.ilike.${like}`);
  });

  const select = encodeURIComponent(
    `id,producto,nombre_modelo_especial,modelo,precio_lista_clp,precio_lista_raw,descripcion,caracteristicas,recomendados`,
  );
  const q = `catalogo_productos?select=${select}&limit=1&or=(${conditions.join(",")})`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (!res.ok || !Array.isArray(res.data)) return null;
  const row = (res.data as unknown[])[0];
  if (!row) return null;
  const precioRaw = toLooseText(getRecordValue(row, "precio_lista_raw"));
  const precioClp = toLooseText(getRecordValue(row, "precio_lista_clp"));
  let precio = precioRaw || precioClp;

  if (!precio) {
    const parent = toTrimmedString(getRecordValue(row, "producto")) || toTrimmedString(candidate);
    if (parent) {
      const vSelect = encodeURIComponent(`precio_lista_clp,precio_lista_raw`);
      const vq = `catalogo_productos?select=${vSelect}&producto=eq.${encodeURIComponent(parent)}&record_type=eq.variant&precio_lista_clp=not.is.null&limit=100`;
      const vres = await supabaseFetch(vq, { method: "GET" });
      const variants = vres.ok && Array.isArray(vres.data) ? (vres.data as unknown[]) : [];
      const prices = variants
        .map((v) => toLooseText(getRecordValue(v, "precio_lista_clp")))
        .map((p) => Number(String(p).replace(/[^\d]/g, "")))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (prices.length) {
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        precio = min === max ? String(min) : `${min}-${max}`;
      }
    }
  }
  return {
    precio,
    descripcionCorta: toTrimmedString(getRecordValue(row, "caracteristicas")),
    descripcion: (await loadParentStagingDescription(nombre)) || toTrimmedString(getRecordValue(row, "descripcion")),
    imageUrl: "",
    recomendados: getRecordValue(row, "recomendados"),
  };
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
  const descCompleta = htmlToParagraphText(`${descCorta}\n${desc}`);
  const descPlano = htmlToParagraphText(desc || descCorta);
  const shortText = descCorta.trim() ? htmlToParagraphText(descCorta).slice(0, 600).trim() : descPlano.slice(0, 600).trim();
  const shortFinal = shortText.length >= 590 ? shortText.slice(0, 590).trim() : shortText;
  return { productId, nombre, shortFinal, fullDescription: descCompleta, imageUrl, fichaUrl, precio };
}

async function loadProductDetailByCountry(country: Country, productId: string, preferredName?: string): Promise<ProductDetail | null> {
  if (!productId) return null;
  if (country === "UY") return (await loadProductDetailUY(productId)) as ProductDetail | null;
  const base = (await loadProductDetail(productId)) as ProductDetail | null;
  const sourceName = toTrimmedString(preferredName) || base?.nombre || "";
  const commercial = await loadCatalogProductCommercialData({ productId, nombre: sourceName || base?.nombre || "" });
  const stagingByName =
    !base || !base.imageUrl || !base.precio || !((base.fullDescription || base.shortFinal || "").trim())
      ? await loadBestStagingProductDetailByName(sourceName || commercial?.descripcionCorta || commercial?.descripcion || "")
      : null;
  if (!base && !commercial) return null;
  const fallbackDescription = htmlToParagraphText(`${commercial?.descripcionCorta ?? ""}\n${commercial?.descripcion ?? ""}`.trim());
  const fallbackShort = fallbackDescription ? fallbackDescription.slice(0, 590).trim() : "";
  const baseText = htmlToParagraphText(`${base?.fullDescription || ""}\n${base?.shortFinal || ""}`.trim());
  const stagingText = htmlToParagraphText(`${stagingByName?.fullDescription || ""}\n${stagingByName?.shortFinal || ""}`.trim());
  const useStagingText = stagingText.length > baseText.length + 80;
  return {
    productId,
    nombre: sourceName || base?.nombre || stagingByName?.nombre || productId,
    shortFinal: (useStagingText ? stagingByName?.shortFinal : base?.shortFinal) || base?.shortFinal || stagingByName?.shortFinal || fallbackShort,
    fullDescription:
      (useStagingText ? stagingByName?.fullDescription : base?.fullDescription) || base?.fullDescription || stagingByName?.fullDescription || fallbackDescription,
    imageUrl: base?.imageUrl || stagingByName?.imageUrl || commercial?.imageUrl,
    fichaUrl: base?.fichaUrl || stagingByName?.fichaUrl,
    precio: commercial?.precio || base?.precio || stagingByName?.precio,
  };
}

function splitForWhatsapp(text: string, chunkSize = 900, maxParts = 3) {
  const source = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!source) return [] as string[];

  const paragraphs = source
    .split(/\n{2,}/g)
    .map((block) => block.trim())
    .filter(Boolean);

  const out: string[] = [];
  let current = "";

  const flush = () => {
    const value = current.trim();
    if (value) out.push(value);
    current = "";
  };

  const splitBlockPreservingLines = (block: string) => {
    const lines = block.split("\n");
    let local = "";

    const flushLocal = () => {
      const value = local.trim();
      if (value) out.push(value);
      local = "";
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) continue;
      const candidate = local ? `${local}\n${line}` : line;
      if (candidate.length <= chunkSize) {
        local = candidate;
        continue;
      }
      if (local) flushLocal();
      if (line.length <= chunkSize) {
        local = line;
        continue;
      }
      out.push(...splitLongText(line, chunkSize));
    }

    flushLocal();
  };

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= chunkSize) {
      current = candidate;
      continue;
    }
    if (current) flush();
    if (paragraph.length <= chunkSize) {
      current = paragraph;
      continue;
    }
    splitBlockPreservingLines(paragraph);
  }

  flush();
  if (out.length <= maxParts) return out;
  return out;
}

function getProductDescriptionText(detail: ProductDetail) {
  return htmlToParagraphText(`${detail.fullDescription || ""}\n${detail.shortFinal || ""}`.trim()).replace(/\s+/g, " ").trim();
}

function cleanProductSummarySentence(text: string) {
  return text
    .replace(/^[-•\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .replace(/\b(ver|revisa|descarga)\s+ficha\s+tecnica\b/gi, "")
    .replace(/\bSKU\b[:\s-]*[A-Z0-9-]+/gi, "")
    .trim();
}

function scoreProductSummarySentence(sentence: string, productName: string) {
  const s = cleanProductSummarySentence(sentence);
  if (!s) return -100;
  const norm = normalizeText(s);
  const nameNorm = normalizeText(cleanProductName(productName));
  let score = 0;
  if (s.length >= 45 && s.length <= 220) score += 3;
  if (s.length > 220 && s.length <= 320) score += 1;
  if (norm.includes("ideal para") || norm.includes("disenado para") || norm.includes("diseñado para")) score += 4;
  if (norm.includes("incluye") || norm.includes("permite") || norm.includes("ofrece") || norm.includes("cuenta con")) score += 3;
  if (norm.includes("audio") || norm.includes("cobertura") || norm.includes("alcance")) score += 3;
  if (norm.includes("bateria") || norm.includes("batería") || norm.includes("autonomia") || norm.includes("autonomía")) score += 2;
  if (norm.includes("bluetooth") || norm.includes("gps") || norm.includes("wifi") || norm.includes("lte")) score += 2;
  if (norm.includes("vehiculo") || norm.includes("vehículo") || norm.includes("base fija")) score += 3;
  if (norm.includes("terreno") || norm.includes("faena") || norm.includes("exterior") || norm.includes("interior")) score += 3;
  if (norm.includes("resistente") || norm.includes("duradero") || norm.includes("rugged") || /\bip\d{2}\b/i.test(s)) score += 2;
  if (norm.includes(nameNorm) && norm.length <= Math.max(20, nameNorm.length + 12)) score -= 4;
  if (/^\d+\)$/.test(s)) score -= 10;
  return score;
}

function extractProductSummarySentences(detail: ProductDetail, maxItems = 2) {
  const text = getProductDescriptionText(detail);
  if (!text) return [] as string[];
  const rawSentences = text
    .split(/(?<=[.!?])\s+|\n+/g)
    .map((sentence) => cleanProductSummarySentence(sentence))
    .filter(Boolean);
  const seen = new Set<string>();
  const ranked = rawSentences
    .map((sentence, idx) => ({
      sentence,
      idx,
      score: scoreProductSummarySentence(sentence, detail.nombre),
    }))
    .filter((item) => item.score > -20)
    .sort((a, b) => (b.score === a.score ? a.idx - b.idx : b.score - a.score));

  const picked: string[] = [];
  for (const item of ranked) {
    const norm = normalizeText(item.sentence).replace(/[^\w]+/g, " ").trim();
    if (!norm || seen.has(norm)) continue;
    if (picked.some((existing) => norm.includes(normalizeText(existing)) || normalizeText(existing).includes(norm))) continue;
    seen.add(norm);
    picked.push(item.sentence);
    if (picked.length >= maxItems) break;
  }
  return picked;
}

function buildProductExecutiveSummary(detail: ProductDetail, maxLen = 260) {
  const sentences = extractProductSummarySentences(detail, 2);
  if (!sentences.length) {
    const fallback = getProductDescriptionText(detail);
    if (!fallback) return "Sin detalle suficiente para resumir este modelo con precisión en este momento.";
    const chunks = splitLongText(fallback, maxLen);
    return chunks[0] || fallback;
  }
  const summary = sentences.join(" ");
  if (summary.length <= maxLen) return summary;
  const chunks = splitLongText(summary, maxLen);
  return chunks[0] || summary;
}

function extractCatalogComparisonTags(detail: ProductDetail) {
  const hay = normalizeText([detail.nombre, detail.shortFinal, detail.fullDescription].filter(Boolean).join(" "));
  if (!hay) return [] as string[];

  const tags: string[] = [];
  const push = (t: string) => {
    if (!t) return;
    if (!tags.includes(t)) tags.push(t);
  };

  if (hay.includes("vhf")) push("VHF");
  if (hay.includes("uhf")) push("UHF");
  if (hay.includes("analog") || hay.includes("análogo") || hay.includes("analogo")) push("Análogo");
  if (hay.includes("digital")) push("Digital");
  if (hay.includes("dmr")) push("DMR");
  if (hay.includes("tetra")) push("TETRA");
  if (hay.includes("p25")) push("P25");
  if (hay.includes("lte")) push("LTE");
  if (hay.includes("poc") || hay.includes("push to talk")) push("PoC");
  if (hay.includes("gps")) push("GPS");
  if (hay.includes("bluetooth") || hay.includes("bt")) push("Bluetooth");
  if (hay.includes("wifi") || hay.includes("wi-fi")) push("Wi‑Fi");

  const ip = (detail.fullDescription || detail.shortFinal || "").match(/\bip\s?-?\s?([0-9]{2})\b/i);
  if (ip?.[1]) push(`IP${ip[1]}`);
  const mah = (detail.fullDescription || detail.shortFinal || "").match(/\b(\d{4,5})\s?mah\b/i);
  if (mah?.[1]) push(`${mah[1]}mAh`);

  return tags.slice(0, 5);
}

function summarizeForComparison(detail: ProductDetail) {
  return buildProductExecutiveSummary(detail, 240);
}

function buildCatalogComparisonDiffLines(products: ProductDetail[]) {
  const picked = products.slice(0, 3);
  if (!picked.length) return [] as string[];
  const items = picked.map((product) => ({
    name: cleanProductName(product.nombre),
    tags: extractCatalogComparisonTags(product),
    summary: summarizeForComparison(product),
    price: product.precio,
  }));
  const diffLines: string[] = [];
  const uniqueTags = items.map((item, idx) => ({
    idx,
    values: item.tags.filter((tag) => items.every((other, otherIdx) => otherIdx === idx || !other.tags.includes(tag))),
  }));

  for (const item of uniqueTags) {
    if (!item.values.length) continue;
    diffLines.push(`- ${items[item.idx]!.name}: destaca por ${item.values.slice(0, 3).join(", ")}.`);
  }

  if (!diffLines.length && items.length >= 2) {
    diffLines.push(`- ${items[0]!.name}: ${items[0]!.summary}`);
    diffLines.push(`- ${items[1]!.name}: ${items[1]!.summary}`);
  }

  return diffLines.slice(0, 3);
}

function buildCatalogComparisonReply(args: {
  country: Country;
  requestKind?: CatalogRequestKind;
  max: number;
  selectedNumbers: number[];
  products: ProductDetail[];
}) {
  const picked = args.products.slice(0, 3);
  const intro = "Revisé los modelos que estás viendo y estas son las diferencias más relevantes:";
  const blocks = picked.map((p, idx) => {
    const n = idx + 1;
    const name = cleanProductName(p.nombre);
    const price = formatFriendlyPrice(p.precio ?? "", args.country);
    const tags = extractCatalogComparisonTags(p);
    const summary = summarizeForComparison(p);
    const tagLine = tags.length ? `- Perfil técnico: ${tags.join(" · ")}` : "";
    return [
      `${n}) ${name}`,
      price ? `- ${price.replace(/^💰\s*/, "")}` : "- Precio referencial: Por confirmar",
      tagLine,
      `- Resumen ejecutivo: ${summary}`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  const diffLines = buildCatalogComparisonDiffLines(picked);
  const guidance = [
    "Lectura rápida:",
    ...diffLines,
    "Si quieres afinar la recomendación, basta con un dato: indícame si el uso será en terreno, vehículo o base fija.",
  ].join("\n");
  return [[intro, "", ...blocks].join("\n"), guidance].filter((x) => x.trim());
}

async function buildCatalogAdviceReply(args: {
  input: string;
  country: Country;
  requestKind?: CatalogRequestKind;
  list: Array<{ product_id: string; nombre: string }>;
}): Promise<Reply> {
  const max = Math.min(CATALOG_MAX_LIST_ITEMS, args.list.length);
  const referencedNumbers = extractReferencedChoiceNumbers(args.input, max);
  const picked = referencedNumbers.length
    ? referencedNumbers.map((n) => args.list[n - 1]).filter(Boolean)
    : args.list.slice(0, Math.min(4, max));

  const details = (
    await Promise.all(
      picked.map(async (item) => {
        if (!item?.product_id) return null;
        const detail = await loadProductDetailByCountry(args.country, item.product_id);
        if (detail) return { ...detail, nombre: detail.nombre || item.nombre };
        const commercial = await loadCatalogProductCommercialData({ productId: item.product_id, nombre: item.nombre });
        const fallbackDescription = htmlToParagraphText(`${commercial?.descripcionCorta ?? ""}\n${commercial?.descripcion ?? ""}`.trim());
        return {
          productId: item.product_id,
          nombre: item.nombre,
          shortFinal: fallbackDescription.slice(0, 590).trim(),
          fullDescription: fallbackDescription,
          imageUrl: commercial?.imageUrl,
          fichaUrl: "",
          precio: commercial?.precio || "",
        } as ProductDetail;
      }),
    )
  )
    .filter((detail): detail is ProductDetail => Boolean(detail))
    .map((detail) => ({
      ...detail,
      nombre: detail.nombre || picked.find((item) => item.product_id === detail.productId)?.nombre || detail.productId,
    }));

  const describedDetails = details.filter((detail) => (detail.shortFinal || detail.fullDescription || detail.precio || "").trim());

  if (!describedDetails.length) {
    const visibleOptions = picked.map((item, index) => `${index + 1}. ${cleanProductName(item.nombre)}`);
    return splitForWhatsapp(
      [
      "Puedo orientarte con la lista activa sin obligarte a elegir a ciegas.",
      "En este momento no tengo suficiente detalle técnico cargado para comparar esos modelos con precisión.",
      "",
      "Estas son las opciones que estás viendo:",
      ...visibleOptions,
      "",
      "Si me dices el uso que necesitas, por ejemplo terreno, vehículo, base fija, repetición o presupuesto, te propongo las alternativas más convenientes.",
      ].join("\n"),
    );
  }

  const isComparison = isCatalogComparisonRequest(args.input);
  const advice = await generateCatalogAiAnswer({
    input: args.input,
    country: args.country,
    requestKind: args.requestKind,
    products: describedDetails,
    mode: isComparison ? "compare" : "recommend",
  });

  const footer = isComparison
    ? ""
    : `Si quieres ver el detalle completo, indícame el número (${referencedNumbers.length ? referencedNumbers.join(", ") : `1–${max}`}) o el nombre del producto.`;
  const adviceText = String(advice || "").trim();
  const parts = splitForWhatsapp(adviceText, 650, 4);
  const footerSignal = "si quieres ver el detalle completo";
  const hasFooterAlready =
    normalizeText(adviceText).includes(footerSignal) || parts.some((part) => normalizeText(String(part)).includes(footerSignal));
  return [...(parts.length ? parts : [adviceText || ""]), ...(hasFooterAlready ? [] : [footer])].filter((x) => String(x).trim());
}

async function listProjectsByCountry(country: Country, offset: number) {
  const q = `proyectos?select=id,titulo&order=id.asc&limit=5&offset=${offset}&country=eq.${country}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (res.ok && Array.isArray(res.data)) {
    return (res.data as unknown[])
      .map((r) => ({ id: Number(getRecordValue(r, "id")), titulo: toTrimmedString(getRecordValue(r, "titulo")) }))
      .filter((r) => Number.isFinite(r.id) && r.titulo);
  }
  if (country === "CL") {
    const fallback = await supabaseFetch(`proyectos?select=id,titulo&order=id.asc&limit=5&offset=${offset}`, { method: "GET" });
    if (!fallback.ok || !Array.isArray(fallback.data)) return [];
    return (fallback.data as unknown[])
      .map((r) => ({ id: Number(getRecordValue(r, "id")), titulo: toTrimmedString(getRecordValue(r, "titulo")) }))
      .filter((r) => Number.isFinite(r.id) && r.titulo);
  }
  return loadUyProjectsData().projects.slice(offset, offset + 5).map((r) => ({ id: r.id, titulo: r.titulo }));
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

async function answerStructuredServiceKnowledge(country: Country, query: string) {
  const q = query.trim();
  if (!q) return null;
  const like = encodeURIComponent(`*${q}*`);
  const tokens = normalizeText(q)
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 6);

  const orParts = [`tema.ilike.${like}`, `informacion.ilike.${like}`];
  for (const t of tokens) {
    const arrayExpr = encodeURIComponent(`{${t}}`);
    orParts.push(`palabras_clave.cs.${arrayExpr}`);
  }

  const params = [
    "select=tema,informacion,palabras_clave,prioridad",
    `country=eq.${country}`,
    "activo=eq.true",
    `or=(${orParts.join(",")})`,
    "order=prioridad.asc,id.asc",
    "limit=5",
  ].join("&");
  const res = await supabaseFetch(`assistant_service_knowledge?${params}`, { method: "GET" });
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

function extractEmailCandidate(input: string) {
  const match = String(input || "")
    .trim()
    .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim() || "";
}

function looksLikePhoneInput(input: string) {
  const digits = String(input || "").replace(/[^\d]/g, "");
  return digits.length >= 7;
}

function normalizePhoneForCountry(input: string, country: Country) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  let digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (country === "CL") {
    if (digits.startsWith("56") && digits.length >= 10) return `+${digits}`;
    if (digits.startsWith("9") && digits.length === 9) return `+56${digits}`;
    if (digits.length === 8) return `+56${digits}`;
  }

  if (country === "UY") {
    if (digits.startsWith("598") && digits.length >= 10) return `+${digits}`;
    if (digits.length === 8 || digits.length === 9) return `+598${digits}`;
  }

  if (raw.startsWith("+")) return `+${digits}`;
  return digits.length >= (country === "UY" ? 7 : 8) ? `+${digits}` : "";
}

function getPhoneExample(country: Country) {
  return country === "UY" ? "+59891234567" : "+56912345678";
}

function buildPhonePrompt(country: Country, lead = "Ahora indícame tu teléfono.") {
  return `${lead} Puedes escribirlo con o sin espacios. Ej: ${getPhoneExample(country)}`;
}

function buildPhoneValidationMessage(country: Country) {
  return country === "UY"
    ? `Disculpa, necesito el número completo. Puedes escribirlo con o sin espacios. Ej: ${getPhoneExample(country)}.`
    : `Disculpa, necesito el número completo para contactarte. Puedes escribirlo con o sin espacios. Ej: ${getPhoneExample(country)}.`;
}

function resolvePhoneInput(input: string, country: Country) {
  const email = extractEmailCandidate(input);
  if (email && !looksLikePhoneInput(input)) {
    return { phone: "", error: `Veo que compartiste un correo. En este paso necesito tu teléfono. ${buildPhonePrompt(country, "Compárteme tu teléfono.")}` };
  }
  const phone = normalizePhoneForCountry(input, country);
  const digits = phone.replace(/[^\d]/g, "");
  const minDigits = country === "UY" ? 7 : 8;
  if (digits.length < minDigits) {
    return { phone: "", error: buildPhoneValidationMessage(country) };
  }
  return { phone, error: "" };
}

function buildEmailPrompt(country: Country, lead = "¿Cuál es tu correo electrónico?") {
  return `${lead} (Ej: ${country === "UY" ? "nombre@empresa.com" : "nombre@empresa.cl"})`;
}

function resolveEmailInput(input: string, country: Country) {
  const email = extractEmailCandidate(input);
  if (email && validateEmail(email)) return { email, error: "" };
  if (looksLikePhoneInput(input) && !email) {
    return {
      email: "",
      error:
        country === "UY"
          ? "Veo que compartiste un teléfono. En este paso necesito tu correo electrónico. Ej: nombre@empresa.com"
          : "Veo que compartiste un teléfono. En este paso necesito tu correo electrónico. Ej: nombre@empresa.cl",
    };
  }
  return {
    email: "",
    error:
      country === "UY"
        ? "Necesito un correo válido. Puedes escribirlo tal como aparece, por ejemplo: nombre@empresa.com"
        : "Necesito un correo válido. Puedes escribirlo tal como aparece, por ejemplo: nombre@empresa.cl",
  };
}

function buildProfileReuseGuidance(
  profile: CatalogQuote["data"] | null | undefined,
  kind: "solicitud" | "cotizacion" | "arriendo" | "cambium",
  nextStep?: CatalogQuoteStep | ContactFormStep,
) {
  const hasProfile = Boolean(profile && Object.values(profile).some(Boolean));
  if (!hasProfile) {
    if (kind === "arriendo" || kind === "cotizacion") {
      return "Te pediré solo los datos necesarios y, antes de enviar, podrás revisar todo y editar cualquier dato si lo necesitas.";
    }
    return "Te pediré los datos paso a paso. Antes de enviar podrás revisar todo y editar cualquier dato si lo necesitas.";
  }

  const savedLabels = [
    profile?.nombre ? "nombre" : "",
    profile?.telefono ? "teléfono" : "",
    profile?.email ? "correo" : "",
    profile?.empresa ? "empresa" : "",
    profile?.ciudad && profile?.region ? "ciudad y región" : "",
  ].filter(Boolean);

  const savedSummary =
    savedLabels.length >= 3
      ? `${savedLabels.slice(0, -1).join(", ")} y ${savedLabels[savedLabels.length - 1]}`
      : savedLabels.length === 2
        ? `${savedLabels[0]} y ${savedLabels[1]}`
        : savedLabels[0] || "algunos datos";

  if (kind === "arriendo") {
    if (nextStep === "empresa" && profile?.nombre && profile?.telefono && profile?.email) {
      return "Ya tengo tu nombre, teléfono y correo. Si quieres, puedes indicarme la empresa o escribir Omitir. Antes de enviar podrás revisar todo.";
    }
    return `Ya encontré ${savedSummary} y completaré contigo solo lo que falte. Antes de enviar podrás revisar y editar todo si lo necesitas.`;
  }

  return `Ya encontré ${savedSummary} y completaré contigo solo lo que falte. Antes de enviar podrás revisar y editar todo si lo necesitas.`;
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
  if (step === "nombre") return "Muy bien. Ahora indícame tu nombre completo.";
  if (step === "telefono") return buildPhonePrompt(country, country === "UY" ? "Ahora indícame tu teléfono." : "Ahora indícame tu número de teléfono.");
  if (step === "email") {
    return buildEmailPrompt(country);
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
    const review = await buildArriendoProfileReviewMessage(state);
    const contextLine = buildCatalogLeadContextSummary(state.catalog.leadContext);
    return contextLine ? [contextLine, "", review].join("\n") : review;
  }

  const intro =
    intent === "mas_informacion"
      ? "Con gusto. Te ayudo con más información sobre arriendo."
      : "Muy bien. Te ayudo con la cotización de arriendo.";
  const prompt = getRentalPromptForStep(next, state.country ?? "CL");
  const contextLine = buildCatalogLeadContextSummary(state.catalog.leadContext);
  return [intro, contextLine ? `\n${contextLine}` : "", "", buildProfileReuseGuidance(profile, "arriendo", next), "", prompt].filter(Boolean).join("\n");
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
    const review = await buildArriendoProfileReviewMessage(state);
    const contextLine = buildCatalogLeadContextSummary(state.catalog.leadContext);
    return contextLine ? [contextLine, "", review].join("\n") : review;
  }
  if (!isRentalFlow && profile && next === "final") {
    state.catalog.reviewMode = "cotizacion";
    const review = await buildCotizacionProfileReviewMessage(state);
    const contextLine = buildCatalogLeadContextSummary(state.catalog.leadContext);
    return contextLine ? [contextLine, "", review].join("\n") : review;
  }
  if (next === "final") {
    return await completeCatalogQuote(state, userPhone, options?.intro ?? "");
  }

  const prompt = isRentalFlow
    ? getRentalPromptForStep(next, country)
    : next === "telefono"
      ? buildPhonePrompt(country, "Muy bien. Ahora indícame tu teléfono.")
      : next === "email"
        ? buildEmailPrompt(country, "¿Cuál es tu correo electrónico empresarial o personal?")
        : next === "empresa"
          ? "¿Para qué empresa es la cotización? Si es para ti, escribe: Particular"
          : next === "ciudad_region"
            ? country === "UY"
              ? "Por último, indícame la Ciudad y Región. Ej: Montevideo, Montevideo"
              : "Por último, indícame la Ciudad y Región. Ej: Santiago, Región Metropolitana"
            : "Muy bien. Para generar tu cotización, indícame tu nombre y apellido.";

  const intro =
    options?.intro ??
    (isRentalFlow
      ? "Muy bien. Avancemos con la cotización de arriendo para revisar disponibilidad y tiempos."
      : "Muy bien. Avancemos con la cotización para revisar stock y tiempos de entrega.");
  const contextLine = buildCatalogLeadContextSummary(state.catalog.leadContext);
  return [intro, contextLine ? `\n${contextLine}` : "", "", buildProfileReuseGuidance(profile, isRentalFlow ? "arriendo" : "cotizacion", next), "", prompt]
    .filter(Boolean)
    .join("\n");
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
  if (field === "nombre") return "Muy bien. Para continuar, indícame tu nombre y apellido.";
  if (field === "telefono") return buildPhonePrompt(country, "Indícame tu teléfono.");
  if (field === "email") return buildEmailPrompt(country, "¿Cuál es tu correo electrónico empresarial o personal?");
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
    const { phone, error } = resolvePhoneInput(input, country);
    if (error) return error;
    q.data.telefono = phone;
    return null;
  }
  if (field === "email") {
    const { email, error } = resolveEmailInput(input, country);
    if (error) return error;
    q.data.email = email;
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
    "Muy bien. Este es el resumen de tu solicitud:",
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
    "Si todo está correcto, escribe: Confirmar solicitud",
    "Si necesitas ajustar un dato, puedes decir por ejemplo: cambiar teléfono",
    getCancelMenuHintText(),
  ].filter(Boolean);
  return lines.join("\n");
}

async function buildCotizacionProfileReviewMessage(state: UserState) {
  const q = state.catalog.quote?.data ?? {};
  const country = state.country ?? "CL";
  const detail = await loadProductDetailByCountry(country, state.catalog.selectedProductId ?? "");
  const ubicacion = [q.ciudad, q.region].filter(Boolean).join(", ");
  const lines = [
    "Muy bien. Este es el resumen de tu solicitud:",
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
    "Si todo está correcto, escribe: Confirmar cotización",
    "Si necesitas ajustar un dato, puedes decir por ejemplo: cambiar teléfono",
    getCancelMenuHintText(),
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
      return await generateAiRewrite({
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
  try {
    const country = state.country ?? "CL";
    const detail = await loadProductDetailByCountry(country, state.catalog.selectedProductId ?? "");
    const q = state.catalog.quote?.data ?? {};
    const sheetRow: SheetsLeadRow = {
      fecha: new Date().toISOString(),
      country,
      flowKey: isRentalFlow ? "arriendo" : "cotizacion",
      flowLabel: isRentalFlow ? "Arriendo" : "Cotización",
      userPhone,
      nombre: q.nombre ?? "",
      empresa: q.empresa ?? "",
      telefono: q.telefono ?? "",
      email: q.email ?? "",
      direccion: [q.direccion, q.ciudad, q.region].filter(Boolean).join(", "),
      producto: detail?.nombre ? cleanProductName(detail.nombre) : state.catalog.selectedProductId ?? "",
      mensaje: (q as Record<string, unknown>)?.mensaje ? String((q as Record<string, unknown>).mensaje ?? "") : "",
      ciudad: q.ciudad ?? "",
    };
    void withTimeout(appendLeadToGoogleSheet(sheetRow), 2500);
  } catch {}
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
  const unsupportedCommercialProduct = extractUnsupportedCommercialProduct(input);

  if (state.catalog.status === "wait_finish_cotizacion") {
    if (t.includes("cancel")) {
      state.catalog = { filters: {}, status: "idle" };
      state.activeBranch = "menu";
      const msg = await generateAiRewrite({
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
      return await generateAiRewrite({
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
      return await generateAiRewrite({
        kind: "empatia",
        input,
        facts: ["Muy bien, dejamos los recomendados fuera.", "¿Quieres terminar o cancelar la cotización?", "Responde: Terminar / Cancelar."],
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
        const base = buildProductFichaMessages(d, { requestKind: state.catalog.requestKind, country: state.country ?? "CL" });
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
          return await generateAiRewrite({
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
          return await generateAiRewrite({
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

  if (rentalRequest) {
    if (state.catalog.arriendoPriceMenuActive) {
      state.catalog.arriendoPriceMenuActive = undefined;
      return await startContactForm(state, userPhone, "cl_arriendo_precio", {
        intro: getArriendoPriceLeadIntro(),
      });
    }

    if (isCatalogPriceRequest(input)) {
      state.catalog.arriendoPriceMenuActive = undefined;
      return await startContactForm(state, userPhone, "cl_arriendo_precio", {
        intro: getArriendoPriceLeadIntro(),
      });
    }
  }

  if (isExitConversationCommand(input)) {
    returnToCasualState(state);
    markMenuShown(state);
    const lead = [
      "Entendido. Volvamos al menú principal.",
      "De acuerdo. Te dejo nuevamente el menú principal.",
      "Perfecto. Volvamos al menú principal para que elijas la opción que necesitas.",
    ][crypto.randomInt(0, 3)];
    return [lead, "", buildMainMenuText(state.country ?? "CL", "return")].join("\n");
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

  if (unsupportedCommercialProduct && state.catalog.lastList?.length && !state.catalog.selectedProductId) {
    return buildUnsupportedProductInActiveListReply("CL", unsupportedCommercialProduct, state.catalog.lastList);
  }

  if (unsupportedCommercialProduct) {
    const unsupportedReply = await buildUnsupportedCommercialReplyDynamic("CL", unsupportedCommercialProduct, input);
    return prependReplyContext(
      buildCotizarProductMenuMessage([
        { label: "📻 Equipos Radio", value: "equipos-radio" },
        { label: "🎧 Accesorios", value: "accesorios" },
        { label: "📷 Cámaras Corporales", value: "camaras-corporales" },
      ]),
      unsupportedReply,
    );
  }

  if (!state.catalog.quote && !state.catalog.pending && !state.catalog.selectedProductId && input) {
    await applyCatalogEntityHintsToState(state, "CL", input, { mode: rentalRequest ? "arriendo" : "cotizacion" });
  }

  if (!state.catalog.quote) {
    const directModelReply = await tryDirectCatalogModelLookup(state, "CL", input);
    if (directModelReply) return directModelReply;
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
    return "Indícame si deseas cotizar arriendo de radios o si prefieres más información.";
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
          return `Para arriendo no necesito ciudad ni región. Si todo está correcto, escribe: Confirmar solicitud. ${getCancelMenuHintText()}`;
        }
        state.catalog.reviewEditField = fieldToEdit;
        return fieldToEdit === "empresa" ? getRentalPromptForStep("empresa", "CL") : getRentalPromptForStep(fieldToEdit, "CL");
      }
      if (isStockQuestion(input)) {
        return "Para confirmar stock inmediato y tiempos de entrega del arriendo, avancemos con la cotización y un ejecutivo te validará el inventario en minutos.";
      }
      return `Si todo está correcto, escribe: Confirmar solicitud. Si necesitas ajustar un dato, puedes decir por ejemplo: cambiar teléfono. ${getCancelMenuHintText()}`;
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
      return `Si todo está correcto, escribe: Confirmar cotización. Si necesitas ajustar un dato, puedes decir por ejemplo: cambiar teléfono. ${getCancelMenuHintText()}`;
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
      if (input.length < 3) return rentalRequest ? "Necesito tu nombre completo para continuar." : "Muy bien. Para generar tu cotización, indícame tu nombre y apellido.";
      setAndNext("nombre", input, "telefono");
      state.userName = input.split(" ")[0]?.trim() || state.userName;
      return rentalRequest ? getRentalPromptForStep("telefono", "CL") : buildPhonePrompt("CL", "Muy bien. Ahora indícame tu teléfono.");
    }
    if (q.step === "telefono") {
      const { phone, error } = resolvePhoneInput(input, "CL");
      if (error) return error;
      setAndNext("telefono", phone, "email");
      return rentalRequest ? getRentalPromptForStep("email", "CL") : buildEmailPrompt("CL", "¿Cuál es tu correo electrónico empresarial o personal?");
    }
    if (q.step === "email") {
      const { email, error } = resolveEmailInput(input, "CL");
      if (error) return error;
      if (rentalRequest) {
        q.data.email = email;
        q.step = "final";
        state.catalog.quote = q;
        await upsertUserProfile(userPhone, q.data);
        state.catalog.reviewMode = "arriendo";
        return await buildArriendoProfileReviewMessage(state);
      }
      setAndNext("email", email, "empresa");
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
      await upsertUserProfile(userPhone, q.data);
      state.catalog.reviewMode = "cotizacion";
      return await buildCotizacionProfileReviewMessage(state);
    }
  }

  if (state.catalog.lastList?.length && state.catalog.pending && !state.catalog.selectedProductId) {
    state.catalog.pending = undefined;
  }

  if (state.catalog.pending) {
    const pending = state.catalog.pending;
    if (isCatalogAdviceRequest(input) || isCatalogComparisonRequest(input)) {
      return buildCatalogPendingAdviceReply({ country: "CL", pending });
    }
    const n = isNumericChoice(t, pending.options.length) ?? extractChoiceNumberFromText(input, pending.options.length);
    if (n) {
      selectedPendingOption = pending.options[n - 1]!;
      applyCatalogPendingSelection(state, pending, selectedPendingOption);
    } else {
      const match = matchPendingOption(input, pending.options);
      if (match.value) {
        const selected = pending.options.find((o) => o.value === match.value);
        if (!selected) return `Por favor, responde con un número (1–${pending.options.length}) o escribe la opción tal como aparece en la lista.`;
        selectedPendingOption = selected;
        applyCatalogPendingSelection(state, pending, selected);
      } else {
        if (match.ambiguous) {
          return `Me quedaron 2 opciones parecidas. ¿Me respondes con el número (1–${pending.options.length}) para elegir bien?`;
        }
        return `Por favor, responde con un número (1–${pending.options.length}) o escribe la opción tal como aparece en la lista.`;
      }
    }
  }

  if (selectedPendingOption?.skipRadioTechFrequency) {
    state.catalog.skipRadioTechFrequency = undefined;
    state.catalog.pending = undefined;
    if (state.catalog.requestKind === "arriendo") {
      return await startContactForm(state, userPhone, "cl_arriendo_precio", {
        intro: getArriendoPriceLeadIntro(),
      });
    }
    return await startContactForm(state, userPhone, "cl_compra_asesoria", {
      intro: getPurchaseAdviceLeadIntro("CL"),
      presetData: {
        mensaje: "Solicitud de asesoría de compra desde selección de frecuencia.",
      },
    });
  }

  if (state.catalog.selectedProductId) {
    const choice = parseProductFichaActionChoice(input);
    if (t.includes("arrend")) {
      return await startRentalPriceLeadFlow(state, userPhone);
    }
    if (choice === 1 || t.includes("cotiz")) {
      return await startCatalogQuoteForm(state, userPhone, "CL");
    }
    if (choice === 3 || isMenuCommand(input)) {
      returnToCasualState(state);
      markMenuShown(state);
      return buildMainMenuText("CL", "return");
    }
    if (choice === 2 || isBackToProductsListCommand(input)) {
      const sourceList = state.catalog.returnList?.length ? state.catalog.returnList : state.catalog.lastList;
      state.catalog.selectedProductId = undefined;
      state.catalog.returnList = undefined;
      if (sourceList?.length) {
        state.catalog.lastList = sourceList;
        return buildProductsListMessage(sourceList, "Motorola DP250");
      }
      return "Indícame el número del producto que quieres ver o escribe: Nueva búsqueda.";
    }
    if (isStockQuestion(input)) {
      return await startCatalogQuoteForm(state, userPhone, "CL", {
        intro: "Para confirmar stock inmediato y tiempos de entrega, avancemos con la cotización y un ejecutivo te validará el inventario en minutos.",
      });
    }
    if (choice === 4 || t.includes("nueva busqueda") || t.includes("nueva búsqueda")) {
      const keepRental = normalizeText(state.catalog.filters.modalidad || "").includes("arriendo");
      state.catalog.selectedProductId = undefined;
      state.catalog.lastList = undefined;
      state.catalog.returnList = undefined;
      state.catalog.adviceContext = undefined;
      state.catalog.filters = { modalidad: keepRental ? "Arriendo" : "Venta" };
      state.catalog.pending = undefined;
      state.catalog.skipRadioTechFrequency = undefined;
      return keepRental
        ? "Muy bien. Hagamos una nueva búsqueda de arriendo. ¿Qué tipo de equipo necesitas?"
        : "Muy bien. Hagamos una nueva búsqueda. ¿Qué tipo de producto necesitas?";
    }
    if (t.includes("volver")) {
      state.catalog.selectedProductId = undefined;
    } else {
      return "Puedo ayudarte con eso. Si quieres validar stock y tiempos de entrega, lo mejor es avanzar con la cotización. También puedes volver al menú o hacer una nueva búsqueda.";
    }
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
        ? ["¿Qué formato necesitas?", "Responde con el número o escribe la opción.", "", ...renderNumberedOptionLabels(state.catalog.pending.options)].join(
            "\n",
          )
        : ["¿Portátil o móvil?", "Responde con el número o escribe la opción.", "", ...renderNumberedOptionLabels(state.catalog.pending.options)].join(
            "\n",
          );
    }
  }

  if (isRadioEquipment && !state.catalog.skipRadioTechFrequency && (!state.catalog.filters.frecuencia || !state.catalog.filters.tecnologia)) {
    const options = await buildAvailableRadioFrequencyTechnologyOptionsCL(state.catalog.filters);
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

  if (state.catalog.lastList && state.catalog.lastList.length) {
    const max = Math.min(CATALOG_MAX_LIST_ITEMS, state.catalog.lastList.length);
    const usageContext = extractCatalogUsageContext(input);
    if (state.catalog.adviceContext?.awaitingUsageContext && usageContext) {
      const followUp = await buildCatalogAdviceFollowUpReply({
        input: state.catalog.adviceContext.lastInput,
        country: "CL",
        requestKind: state.catalog.requestKind,
        list: state.catalog.lastList,
        mode: state.catalog.adviceContext.mode,
        referencedNumbers: state.catalog.adviceContext.referencedNumbers,
        usageContext,
      });
      if (followUp) {
        state.catalog.adviceContext.awaitingUsageContext = false;
        return followUp;
      }
    }
    if (isCatalogPriceRequest(input)) {
      state.catalog.adviceContext = undefined;
      return await buildCatalogPriceListReply({ country: "CL", list: state.catalog.lastList });
    }
    if (isCatalogAdviceRequest(input) || isCatalogComparisonRequest(input)) {
      state.catalog.adviceContext = {
        mode: isCatalogComparisonRequest(input) ? "compare" : "recommend",
        lastInput: input,
        referencedNumbers: extractReferencedChoiceNumbers(input, max),
        awaitingUsageContext: true,
      };
      return await buildCatalogAdviceReply({
        input,
        country: "CL",
        requestKind: state.catalog.requestKind,
        list: state.catalog.lastList,
      });
    }
    const n = isNumericChoice(t, max) ?? extractChoiceNumberFromText(input, max);
    if (n) {
      state.catalog.adviceContext = undefined;
      const chosen = state.catalog.lastList[n - 1];
      state.catalog.selectedProductId = chosen.product_id;
      const detail = await loadProductDetailByCountry("CL", chosen.product_id, chosen.nombre);
      if (!detail) return "No pude cargar la ficha de ese producto. Indícame otra opción o escribe Nueva búsqueda.";
      return buildProductFichaMessages(detail, { requestKind: state.catalog.requestKind, country: "CL" });
    }

    const productOptions: CatalogPendingOption[] = state.catalog.lastList.map((p) => ({
      label: cleanProductName(p.nombre),
      value: p.product_id,
    }));
    const match = matchPendingOption(input, productOptions);
    if (match.value) {
      state.catalog.adviceContext = undefined;
      state.catalog.selectedProductId = match.value;
      const detail = await loadProductDetailByCountry("CL", match.value, productOptions.find((p) => p.value === match.value)?.label);
      if (!detail) return "No pude cargar la ficha de ese producto. Indícame otra opción o escribe Nueva búsqueda.";
      return buildProductFichaMessages(detail, { requestKind: state.catalog.requestKind, country: "CL" });
    }
    if (match.ambiguous) {
      return `Me quedaron 2 opciones parecidas. ¿Me dices el número (1–${max}) para elegir bien?`;
    }

    const modelQuery = extractCatalogModelQuery(input);
    if (modelQuery) {
      state.catalog.adviceContext = undefined;
      const directReply = await tryDirectCatalogModelLookup(state, "CL", input);
      if (directReply) return directReply;
    }

    if (state.catalog.adviceContext?.awaitingUsageContext && shouldKeepCatalogAdviceThread(input)) {
      return "Perfecto. Si me indicas si será para terreno, vehículo, base fija, interior o exterior, continúo la recomendación sobre estos mismos modelos.";
    }

    return `Indícame el número (1–${max}) o el nombre del producto/modelo (ej: TLK100).`;
  }

  const products = await queryProducts(state.catalog.filters);

  if (!products.length) {
    if (isRadioEquipment && !state.catalog.skipRadioTechFrequency) {
      const keepRental = normalizeText(state.catalog.filters.modalidad || "").includes("arriendo");
      const nextFilters: CatalogFilters = {
        ...state.catalog.filters,
        modalidad: keepRental ? "Arriendo" : "Venta",
        frecuencia: undefined,
        tecnologia: undefined,
      };
      const options = await buildAvailableRadioFrequencyTechnologyOptionsCL(nextFilters);
      state.catalog.filters = nextFilters;
      state.catalog.pending = { attr: "frecuencia", options };
      if (!options.length) {
        state.catalog.pending = undefined;
        return [
          "Con esa combinación no tengo equipos disponibles.",
          "Para ayudarte mejor, dime:",
          "- ¿Los usarás principalmente en interior (edificio) o exterior (terreno)?",
          "- ¿Cuántos equipos necesitas y para qué tipo de uso (portátil/vehículo/repetidor)?",
        ].join("\n");
      }
      return [
        "Con esa combinación no tengo equipos disponibles.",
        "Probemos con una alternativa:",
        "",
        ...options.map((o, i) => `${i + 1}) ${o.label}`),
      ].join("\n");
    }
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
        const shown = isBodycamTipoProducto(state.catalog.filters.tipo_producto) ? await pickBestBodycamList("CL", retry) : retry.slice(0, CATALOG_MAX_LIST_ITEMS);
        state.catalog.lastList = shown;
        state.catalog.returnList = undefined;
        const lines = shown.map((p, i) => `${i + 1}) ${cleanProductName(p.nombre)}`).join("\n");
        return [
          `Estos son los que encontré (máx. ${CATALOG_MAX_LIST_ITEMS}):`,
          "",
          lines,
          "",
          "Indícame qué opción quieres para mostrarte su ficha. También puedes decir el nombre.",
          "Si quieres, también puedo compararlos brevemente o sugerirte la opción más conveniente según tu uso.",
        ].join("\n");
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
      return [intro, "", renderNumberedOptionLabels(top).join("\n"), "También puedes escribir el nombre del producto (ej: DP50)."].join("\n");
    }
    return keepRental
      ? "No encontré equipos de arriendo con esos filtros. Probemos otra vez y te ayudo a encontrar una alternativa."
      : isRadioEquipment
      ? "No encontré productos con esa combinación. Probemos otra vez desde la modalidad del equipo."
      : "Por ahora no encontré productos con esos filtros. ¿Quieres hacer una nueva búsqueda o volver al menú?";
  }

  const shown = isBodycamTipoProducto(state.catalog.filters.tipo_producto)
    ? await pickBestBodycamList("CL", products)
    : products.slice(0, CATALOG_MAX_LIST_ITEMS);
  state.catalog.lastList = shown;
  state.catalog.returnList = undefined;
  state.catalog.adviceContext = undefined;
  const lines = shown.map((p, i) => `${i + 1}) ${cleanProductName(p.nombre)}`).join("\n");
  return [
    `Estos son los que encontré (máx. ${CATALOG_MAX_LIST_ITEMS}):`,
    "",
    lines,
    "",
    "Indícame qué opción quieres para mostrarte su ficha. También puedes decir el nombre (ej: Motorola DP250).",
    "Si quieres, también puedo compararlos brevemente o sugerirte la opción más conveniente según tu uso.",
  ].join("\n");
}

async function handleCatalogUY(state: UserState, text: string, userPhone: string): Promise<Reply> {
  const input = text.trim();
  const t = normalizeText(input);
  let selectedPendingOption: CatalogPendingOption | null = null;
  const unsupportedCommercialProduct = extractUnsupportedCommercialProduct(input);

  if (state.catalog.status === "wait_finish_cotizacion") {
    if (t.includes("cancel")) {
      state.catalog = { filters: {}, status: "idle" };
      state.activeBranch = "menu";
      const msg = await generateAiRewrite({
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

  if (isExitConversationCommand(input)) {
    returnToCasualState(state);
    markMenuShown(state);
    const lead = [
      "Entendido. Volvamos al menú principal.",
      "De acuerdo. Te dejo nuevamente el menú principal.",
      "Perfecto. Volvamos al menú principal para que elijas la opción que necesitas.",
    ][crypto.randomInt(0, 3)];
    return [lead, "", buildMainMenuText(state.country ?? "UY", "return")].join("\n");
  }

  if (unsupportedCommercialProduct && state.catalog.lastList?.length && !state.catalog.selectedProductId) {
    return buildUnsupportedProductInActiveListReply("UY", unsupportedCommercialProduct, state.catalog.lastList);
  }

  if (unsupportedCommercialProduct) {
    const unsupportedReply = await buildUnsupportedCommercialReplyDynamic("UY", unsupportedCommercialProduct, input);
    return prependReplyContext(
      buildCotizarProductMenuMessage([
        { label: "📻 Equipos Radio", value: "equipos-radio" },
        { label: "🎧 Accesorios", value: "accesorios" },
        { label: "📷 Cámaras Corporales", value: "camaras-corporales" },
      ]),
      unsupportedReply,
    );
  }

  if (!state.catalog.quote && !state.catalog.pending && !state.catalog.selectedProductId && input) {
    await applyCatalogEntityHintsToState(state, "UY", input, { mode: "cotizacion" });
  }

  if (t.includes("nueva busqueda") || t.includes("nueva búsqueda") || t === "reiniciar") {
    state.catalog = { filters: { modalidad: "Venta" }, status: "idle" };
    return buildCotizarProductMenuMessage([
      { label: "📻 Equipos Radio", value: "equipos-radio" },
      { label: "🎧 Accesorios", value: "accesorios" },
      { label: "📷 Cámaras Corporales", value: "camaras-corporales" },
    ]);
  }

  if (!state.catalog.quote) {
    const directModelReply = await tryDirectCatalogModelLookup(state, "UY", input);
    if (directModelReply) return directModelReply;
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
      return `Si todo está correcto, escribe: Confirmar cotización. Si necesitas ajustar un dato, puedes decir por ejemplo: cambiar correo. ${getCancelMenuHintText()}`;
    }

    const setAndNext = (key: keyof CatalogQuote["data"], value: string, next: CatalogQuoteStep) => {
      q.data[key] = value;
      q.step = next;
    };

    if (q.step === "nombre") {
      if (input.length < 3) return "Muy bien. Para generar tu cotización, indícame tu nombre y apellido.";
      setAndNext("nombre", input, "telefono");
      state.catalog.quote = q;
      return buildPhonePrompt("UY", "Muy bien. Ahora indícame tu teléfono.");
    }
    if (q.step === "telefono") {
      const { phone, error } = resolvePhoneInput(input, "UY");
      if (error) return error;
      setAndNext("telefono", phone, "email");
      state.catalog.quote = q;
      return buildEmailPrompt("UY", "¿Cuál es tu correo electrónico empresarial o personal?");
    }
    if (q.step === "email") {
      const { email, error } = resolveEmailInput(input, "UY");
      if (error) return error;
      setAndNext("email", email, "empresa");
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
      state.catalog.quote = q;
      if (q.data.nombre) state.userName = q.data.nombre.split(" ")[0]?.trim() || state.userName;
      await upsertUserProfile(userPhone, q.data);
      state.catalog.reviewMode = "cotizacion";
      return await buildCotizacionProfileReviewMessage(state);
    }
  }

  if (state.catalog.lastList?.length && state.catalog.pending && !state.catalog.selectedProductId) {
    state.catalog.pending = undefined;
  }

  if (state.catalog.pending) {
    const pending = state.catalog.pending;
    if (isCatalogAdviceRequest(input) || isCatalogComparisonRequest(input)) {
      return buildCatalogPendingAdviceReply({ country: "UY", pending });
    }
    const n = isNumericChoice(t, pending.options.length) ?? extractChoiceNumberFromText(input, pending.options.length);
    if (n) {
      selectedPendingOption = pending.options[n - 1]!;
      applyCatalogPendingSelection(state, pending, selectedPendingOption);
    } else {
      const match = matchPendingOption(input, pending.options);
      if (match.value) {
        const selected = pending.options.find((o) => o.value === match.value);
        if (!selected) return `Por favor, responde con un número (1–${pending.options.length}) o escribe la opción tal como aparece en la lista.`;
        selectedPendingOption = selected;
        applyCatalogPendingSelection(state, pending, selected);
      } else {
        if (match.ambiguous) {
          return `Me quedaron 2 opciones parecidas. ¿Me respondes con el número (1–${pending.options.length}) para elegir bien?`;
        }
        return `Por favor, responde con un número (1–${pending.options.length}) o escribe la opción tal como aparece en la lista.`;
      }
    }
  }

  if (selectedPendingOption?.skipRadioTechFrequency) {
    state.catalog.skipRadioTechFrequency = undefined;
    state.catalog.pending = undefined;
    return await startContactForm(state, userPhone, "uy_compra_asesoria", {
      intro: getPurchaseAdviceLeadIntro("UY"),
      presetData: {
        mensaje: "Solicitud de asesoría de compra desde selección de frecuencia.",
      },
    });
  }

  if (state.catalog.selectedProductId) {
    const choice = parseProductFichaActionChoice(input);
    if (choice === 1 || t.includes("cotiz")) {
      return await startCatalogQuoteForm(state, userPhone, "UY");
    }
    if (choice === 3 || isMenuCommand(input)) {
      returnToCasualState(state);
      markMenuShown(state);
      return buildMainMenuText("UY", "return");
    }
    if (choice === 2 || isBackToProductsListCommand(input)) {
      const sourceList = state.catalog.returnList?.length ? state.catalog.returnList : state.catalog.lastList;
      state.catalog.selectedProductId = undefined;
      state.catalog.returnList = undefined;
      if (sourceList?.length) {
        state.catalog.lastList = sourceList;
        return buildProductsListMessage(sourceList, "DEP250");
      }
      return "Indícame el número del producto que quieres ver o escribe: Nueva búsqueda.";
    }
    if (isStockQuestion(input)) {
      return await startCatalogQuoteForm(state, userPhone, "UY", {
        intro: "Para confirmar stock inmediato y tiempos de entrega, avancemos con la cotización y un ejecutivo te validará el inventario en minutos.",
      });
    }
    if (choice === 4 || t.includes("nueva busqueda") || t.includes("nueva búsqueda")) {
      state.catalog.selectedProductId = undefined;
      state.catalog.lastList = undefined;
      state.catalog.returnList = undefined;
      state.catalog.adviceContext = undefined;
      state.catalog.filters = { modalidad: "Venta" };
      state.catalog.pending = undefined;
      state.catalog.skipRadioTechFrequency = undefined;
      return "Muy bien. Hagamos una nueva búsqueda. ¿Qué tipo de producto necesitas?";
    }
    if (t.includes("volver")) {
      state.catalog.selectedProductId = undefined;
    } else {
      return "Puedo ayudarte con eso. Si quieres validar stock y tiempos de entrega, lo mejor es avanzar con la cotización. También puedes volver al menú o hacer una nueva búsqueda.";
    }
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
        ? ["¿Qué formato necesitas?", "Responde con el número o escribe la opción.", "", ...renderNumberedOptionLabels(state.catalog.pending.options)].join(
            "\n",
          )
        : ["¿Portátil o móvil?", "Responde con el número o escribe la opción.", "", ...renderNumberedOptionLabels(state.catalog.pending.options)].join(
            "\n",
          );
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

  if (state.catalog.lastList?.length) {
    const max = Math.min(CATALOG_MAX_LIST_ITEMS, state.catalog.lastList.length);
    const usageContext = extractCatalogUsageContext(input);
    if (state.catalog.adviceContext?.awaitingUsageContext && usageContext) {
      const followUp = await buildCatalogAdviceFollowUpReply({
        input: state.catalog.adviceContext.lastInput,
        country: "UY",
        requestKind: state.catalog.requestKind,
        list: state.catalog.lastList,
        mode: state.catalog.adviceContext.mode,
        referencedNumbers: state.catalog.adviceContext.referencedNumbers,
        usageContext,
      });
      if (followUp) {
        state.catalog.adviceContext.awaitingUsageContext = false;
        return followUp;
      }
    }
    if (isCatalogPriceRequest(input)) {
      state.catalog.adviceContext = undefined;
      return await buildCatalogPriceListReply({ country: "UY", list: state.catalog.lastList });
    }
    if (isCatalogAdviceRequest(input) || isCatalogComparisonRequest(input)) {
      state.catalog.adviceContext = {
        mode: isCatalogComparisonRequest(input) ? "compare" : "recommend",
        lastInput: input,
        referencedNumbers: extractReferencedChoiceNumbers(input, max),
        awaitingUsageContext: true,
      };
      return await buildCatalogAdviceReply({
        input,
        country: "UY",
        requestKind: state.catalog.requestKind,
        list: state.catalog.lastList,
      });
    }
    const n = isNumericChoice(t, max) ?? extractChoiceNumberFromText(input, max);
    if (n) {
      state.catalog.adviceContext = undefined;
      const chosen = state.catalog.lastList[n - 1];
      state.catalog.selectedProductId = chosen.product_id;
      const detail = await loadProductDetailByCountry("UY", chosen.product_id, chosen.nombre);
      if (!detail) return "No pude cargar la ficha de ese producto. Indícame otra opción o escribe Nueva búsqueda.";
      return buildProductFichaMessages(detail, { country: "UY", requestKind: state.catalog.requestKind });
    }

    const productOptions: CatalogPendingOption[] = state.catalog.lastList.map((p) => ({
      label: cleanProductName(p.nombre),
      value: p.product_id,
    }));
    const match = matchPendingOption(input, productOptions);
    if (match.value) {
      state.catalog.adviceContext = undefined;
      state.catalog.selectedProductId = match.value;
      const detail = await loadProductDetailByCountry("UY", match.value, productOptions.find((p) => p.value === match.value)?.label);
      if (!detail) return "No pude cargar la ficha de ese producto. Indícame otra opción o escribe Nueva búsqueda.";
      return buildProductFichaMessages(detail, { country: "UY", requestKind: state.catalog.requestKind });
    }
    if (match.ambiguous) {
      return `Me quedaron 2 opciones parecidas. ¿Me dices el número (1–${max}) para elegir bien?`;
    }

    const modelQuery = extractCatalogModelQuery(input);
    if (modelQuery) {
      state.catalog.adviceContext = undefined;
      const directReply = await tryDirectCatalogModelLookup(state, "UY", input);
      if (directReply) return directReply;
    }

    if (state.catalog.adviceContext?.awaitingUsageContext && shouldKeepCatalogAdviceThread(input)) {
      return "Perfecto. Si me indicas si será para terreno, vehículo, base fija, interior o exterior, continúo la recomendación sobre estos mismos modelos.";
    }

    return `Indícame el número (1–${max}) o el nombre del producto/modelo (ej: TLK100).`;
  }

  const products = await queryProductsUY(state.catalog.filters);

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
        const shown = isBodycamTipoProducto(state.catalog.filters.tipo_producto) ? await pickBestBodycamList("UY", retry) : retry.slice(0, CATALOG_MAX_LIST_ITEMS);
        state.catalog.lastList = shown;
        state.catalog.returnList = undefined;
        const lines = shown.map((p, i) => `${i + 1}) ${cleanProductName(p.nombre)}`).join("\n");
        return [
          `Estos son los que encontré (máx. ${CATALOG_MAX_LIST_ITEMS}):`,
          "",
          lines,
          "",
          "Indícame qué opción quieres para mostrarte su ficha. También puedes decir el nombre.",
          "Si quieres, también puedo compararlos brevemente o sugerirte la opción más conveniente según tu uso.",
        ].join("\n");
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
      return [intro, "", renderNumberedOptionLabels(top).join("\n"), "También puedes escribir el nombre del producto."].join("\n");
    }
    return keepRental
      ? "No encontré equipos de arriendo con esos filtros. Probemos otra vez y te ayudo a encontrar una alternativa."
      : isRadioEquipment
      ? "No encontré productos con esa combinación. Probemos otra vez desde la modalidad del equipo."
      : "Por ahora no encontré productos con esos filtros. ¿Quieres hacer una nueva búsqueda o volver al menú?";
  }

  const shown = isBodycamTipoProducto(state.catalog.filters.tipo_producto)
    ? await pickBestBodycamList("UY", products)
    : products.slice(0, CATALOG_MAX_LIST_ITEMS);
  state.catalog.lastList = shown;
  state.catalog.returnList = undefined;
  state.catalog.adviceContext = undefined;
  const lines = shown.map((p, i) => `${i + 1}) ${cleanProductName(p.nombre)}`).join("\n");
  return [
    `Estos son los que encontré (máx. ${CATALOG_MAX_LIST_ITEMS}):`,
    "",
    lines,
    "",
    "Indícame qué opción quieres para mostrarte su ficha. También puedes decir el nombre (ej: DEP250).",
    "Si quieres, también puedo compararlos brevemente o sugerirte la opción más conveniente según tu uso.",
  ].join("\n");
}

async function tryLoadRecommendedIds(productId?: string) {
  if (!productId) return [];
  const commercial = await loadCatalogProductCommercialData({ productId, nombre: "" });
  const raw = commercial?.recomendados;
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
  const input = text.trim();
  const t = normalizeText(input);
  const wantsDetail = t.includes("detalle") || t.includes("completo") || t.includes("texto completo") || t.includes("ver completo");
  const wantsMoreProjects = t.includes("ver mas proyectos") || t.includes("ver más proyectos");
  const knowledgeHints = ["certificacion", "certificación", "certificaciones", "enfoque", "banco", "informativo", "capacidad", "soluciones"];

  if (state.projects.stage === "entry") {
    if (!input) return await buildProjectsLandingMessage("CL");
    const entryChoice = parseProjectsEntryChoice(input);
    if (entryChoice === 3 || isMenuCommand(input)) {
      returnToCasualState(state);
      markMenuShown(state);
      return buildMainMenuText(state.country ?? "CL", "return");
    }
    if (entryChoice === 1 || t.includes("solicit") || t.includes("asesoria") || t.includes("asesoría") || t.includes("formulario") || t.includes("contact")) {
      return await startContactForm(state, userPhone, "cl_proyectos", { intro: getProjectsContactIntro() });
    }
    if (entryChoice !== 2) return await buildProjectsLandingMessage("CL");
    state.projects.stage = "browse";
    state.projects.offset = 0;
    state.projects.lastList = undefined;
    state.projects.reading = undefined;
  }

  let list = state.projects.lastList ?? [];
  let noMoreProjects = false;

  if (wantsDetail && state.projects.reading?.id) {
    const detail = await loadProjectContentByCountry("CL", state.projects.reading.id);
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
    const nextList = await listProjectsByCountry("CL", nextOffset);
    if (nextList.length) {
      state.projects.offset = nextOffset;
      list = nextList;
    } else if (state.projects.offset === 0 && !list.length) {
      list = await listProjectsByCountry("CL", 0);
      noMoreProjects = true;
    } else {
      noMoreProjects = true;
    }
  } else if (t.includes("ver mas") || t.includes("ver más")) {
    state.projects.offset += 5;
    list = await listProjectsByCountry("CL", state.projects.offset);
  } else {
    if (!list.length) {
      list = await listProjectsByCountry("CL", state.projects.offset);
    }
  }

  state.projects.lastList = list;
  const n = isNumericChoice(t, list.length) ?? extractProjectChoiceFromText(t, list.length);
  if (n) {
    const chosen = list[n - 1];
    const detail = await loadProjectContentByCountry("CL", chosen.id);
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
  const projectKnowledge = (await loadManagedSectionContent("proyectos", "CL")).knowledgeText;
  if (knowledgeHints.some((h) => t.includes(normalizeText(h))) && projectKnowledge) {
    const ai = await generateKnowledgeAiAnswer({ role: "proyectos", input, knowledgeText: projectKnowledge });
    if (ai) return [ai, "", getProjectsCtaText()].join("\n");
    const clipped = projectKnowledge.length > 1400 ? `${projectKnowledge.slice(0, 1400).trim()}...` : projectKnowledge;
    return [clipped, "", getProjectsCtaText()].join("\n");
  }
  if (!list.length) return "Por ahora no veo proyectos para mostrar. Responde Menú para volver al inicio.";

  if (noMoreProjects) {
    return "Por ahora no tengo más proyectos para mostrar. Elige algún proyecto o si quieres regresamos al menú.";
  }

  const lines = list.map((p, i) => `${i + 1}) ${p.titulo}`).join("\n");
  return ["Estos son algunos proyectos:", "", lines, "", getProjectsNaturalGuidanceText(), "", getProjectsMenuReminderText()].join("\n");
}

async function loadProjectContentByCountry(country: Country, id: number) {
  const q = `proyectos?select=id,titulo,contenido&limit=1&id=eq.${id}&country=eq.${country}`;
  const res = await supabaseFetch(q, { method: "GET" });
  if (res.ok && Array.isArray(res.data)) {
    const row = (res.data as unknown[])[0];
    if (row) {
      const titulo = toTrimmedString(getRecordValue(row, "titulo"));
      const contenido = toTrimmedString(getRecordValue(row, "contenido"));
      return { id, titulo, plain: htmlToParagraphText(contenido) };
    }
  }
  if (country === "CL") {
    const fallback = await supabaseFetch(`proyectos?select=id,titulo,contenido&limit=1&id=eq.${id}`, { method: "GET" });
    if (!fallback.ok || !Array.isArray(fallback.data)) return null;
    const row = (fallback.data as unknown[])[0];
    if (!row) return null;
    const titulo = toTrimmedString(getRecordValue(row, "titulo"));
    const contenido = toTrimmedString(getRecordValue(row, "contenido"));
    return { id, titulo, plain: htmlToParagraphText(contenido) };
  }
  const project = loadUyProjectsData().projects.find((item) => item.id === id);
  if (!project) return null;
  return { id, titulo: project.titulo, plain: project.contenido };
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
    case "cl_compra_asesoria":
    case "uy_compra_asesoria":
      return "Asesoría de compra";
    case "cl_proyectos":
    case "uy_proyectos":
      return "Asesoría en proyectos";
    case "cl_arriendo_precio":
      return "Arriendo (precios)";
    case "cl_dealer":
      return getDealerZoneLabel(data);
    case "cl_servicio_tecnico":
      return data?.subtipo ? `Servicio técnico - ${data.subtipo}` : "Servicio técnico";
    case "uy_servicio_tecnico":
      return data?.subtipo ? `Servicio técnico Uruguay - ${data.subtipo}` : "Servicio técnico Uruguay";
  }
}

function getContactFormStartIntro(kind: ContactFormKind) {
  switch (kind) {
    case "cl_compra_asesoria":
      return getPurchaseAdviceLeadIntro("CL");
    case "cl_proyectos":
      return "Muy bien. Armemos tu solicitud de asesoría en proyectos.";
    case "cl_arriendo_precio":
      return getArriendoPriceLeadIntro();
    case "cl_dealer":
      return "Muy bien. Armemos tu solicitud para que un dealer de tu región te contacte.";
    case "cl_servicio_tecnico":
      return "Muy bien. Armemos tu solicitud de servicio técnico.";
    case "uy_compra_asesoria":
      return getPurchaseAdviceLeadIntro("UY");
    case "uy_proyectos":
      return "Muy bien. Armemos tu solicitud de asesoría en proyectos.";
    case "uy_servicio_tecnico":
      return "Muy bien. Armemos tu solicitud de servicio técnico para Uruguay.";
  }
}

function getContactFormReviewTitle(kind: ContactFormKind, data?: ContactFormState["data"]) {
  switch (kind) {
    case "cl_compra_asesoria":
    case "uy_compra_asesoria":
      return "Muy bien. Este es el resumen de tu solicitud de asesoría de compra:";
    case "cl_proyectos":
    case "uy_proyectos":
      return "Muy bien. Este es el resumen de tu solicitud de asesoría en proyectos:";
    case "cl_arriendo_precio":
      return "Muy bien. Este es el resumen de tu solicitud de precios de arriendo:";
    case "cl_dealer":
      return `Muy bien. Este es el resumen de tu solicitud de ${getContactFormRequestLabel(kind, data)}:`;
    case "cl_servicio_tecnico":
      return "Muy bien. Este es el resumen de tu solicitud de servicio técnico:";
    case "uy_servicio_tecnico":
      return "Muy bien. Este es el resumen de tu solicitud de servicio técnico para Uruguay:";
  }
}

function getContactFormSuccessMessage(kind: ContactFormKind, data?: ContactFormState["data"]) {
  switch (kind) {
    case "cl_compra_asesoria":
    case "uy_compra_asesoria":
      return "✅ Tu solicitud de asesoría de compra fue enviada correctamente. Te contactaremos a la brevedad.";
    case "cl_proyectos":
    case "uy_proyectos":
      return "✅ Tu solicitud de asesoría en proyectos fue enviada correctamente. Te contactaremos a la brevedad.";
    case "cl_arriendo_precio":
      return "✅ Tu solicitud de precios de arriendo fue enviada correctamente. Te contactaremos a la brevedad.";
    case "cl_dealer":
      return `✅ Tu solicitud de ${getContactFormRequestLabel(kind, data)} fue enviada correctamente. Te contactaremos a la brevedad.`;
    case "cl_servicio_tecnico":
      return `✅ Tu solicitud de ${getContactFormRequestLabel(kind, data)} fue enviada correctamente. Te contactaremos a la brevedad.`;
    case "uy_servicio_tecnico":
      return `✅ Tu solicitud de ${getContactFormRequestLabel(kind, data)} fue enviada correctamente. Nuestro equipo en Uruguay te contactará a la brevedad.`;
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

async function buildProjectsLandingMessage(country: Country) {
  const content = await loadManagedSectionContent("proyectos", country);
  return [
    content.openingText,
    "",
    "1) Sí, quiero mejorar mi sistema",
    "2) Conocer Proyectos",
    "3) Volver al menú",
  ].join("\n");
}

function parseProjectsEntryChoice(text: string) {
  const t = normalizeText(text);
  if (!t) return null;
  if (t === "1") return 1 as const;
  if (t === "2") return 2 as const;
  if (t === "3") return 3 as const;
  if (isAffirmative(text) && (t.includes("mejor") || t.includes("implem") || t.includes("sistema") || t.includes("comunic"))) return 1 as const;
  if (t.includes("mejorar") || t.includes("implementar") || t.includes("asesoria") || t.includes("asesoría")) return 1 as const;
  if (t.includes("conocer") || t.includes("ver proyectos") || t.includes("proyectos")) return 2 as const;
  if (t === "volver" || t.includes("volver al menu") || t.includes("volver al menú") || t === "menu" || t === "menú") return 3 as const;
  return null;
}

function getProjectsContactIntro() {
  return "Déjanos tu nombre, empresa y teléfono. Nuestro equipo de ingenieros te contactará a la brevedad para brindarte una asesoría experta y personalizada.";
}

function getNaturalMenuReminderText() {
  return "Recuerda que puedes volver a tu menu de opciones cuando lo desees.";
}

function getServicioTecnicoSubtypeLabel(requestType?: "mantencion_preventiva" | "reparacion") {
  if (requestType === "mantencion_preventiva") return "Mantención preventiva";
  if (requestType === "reparacion") return "Reparación (radios y equipos)";
  return "";
}

function buildServicioTecnicoInfoMessage() {
  return [
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
    getServiceNaturalGuidanceText("CL"),
  ].join("\n");
}

function buildServicioTecnicoInfoMessageUY() {
  return [
    "🔧 Servicio Técnico Autorizado Motorola",
    "Contamos con un equipo profesional altamente capacitado y certificado para servicio técnico en Uruguay.",
    "",
    "🛠️ Mantención preventiva",
    "Optimice la durabilidad de sus equipos y mejore la comunicación mediante mantenimientos preventivos anuales que incluyen ajustes de frecuencia y sensibilidad.",
    "",
    "🧰 Reparación (radios y equipos)",
    "Recupere la funcionalidad de sus radios con repuestos y accesorios originales. Nuestros especialistas utilizan herramientas de vanguardia y tecnología Motorola en la reparación.",
    "",
    "⚙️ Servicios adicionales",
    "- Instalaciones de licencias",
    "- Ajuste de parámetros",
    "- Garantía Motorola Solutions",
    "",
    getServiceNaturalGuidanceText("UY"),
  ].join("\n");
}

function buildServicioTecnicoMenu(country: Country = "CL") {
  return country === "UY"
    ? [
        "Solicitar Asistencia:",
        "1. Mantención Preventiva",
        "2. Reparación (radios y equipos)",
        "3. Consultar al sistema",
        "4. Volver al Menú",
      ].join("\n")
    : [
        "Solicitar Servicio:",
        "1. Mantención Preventiva",
        "2. Reparación (radios y equipos)",
        "3. Conversar con el sistema",
        "4. Volver al Menú",
      ].join("\n");
}

async function buildServicioTecnicoLandingMessage(country: Country = "CL") {
  const content = await loadManagedSectionContent("servicio_tecnico", country);
  return [content.openingText, "", buildServicioTecnicoMenu(country)].join("\n");
}

function buildServicioTecnicoChatIntro(country: Country = "CL") {
  return country === "UY"
    ? [
        "Muy bien. Ya puedes consultar al sistema de soporte para Uruguay.",
        "Cuéntame el equipo, modelo o la situación y te ayudo a revisarla.",
        "",
        "Si quieres volver al menú en cualquier momento, escribe 4, Menú o Volver.",
      ].join("\n")
    : [
        "Muy bien. Ya puedes conversar con el sistema.",
        "Cuéntame el equipo, modelo o la situación y te ayudo a revisarla.",
        "",
        "Si quieres volver al menú en cualquier momento, escribe 4, Menú o Volver.",
      ].join("\n");
}

function buildServicioTecnicoChatFooter(country: Country = "CL") {
  return country === "UY"
    ? "Si quieres volver al menú principal en cualquier momento, escribe 4, Menú o Volver."
    : "Si quieres volver al menú en cualquier momento, escribe 4, Menú o Volver.";
}

function parseServicioTecnicoChoice(text: string) {
  const t = normalizeText(text);
  if (!t) return null;
  if (t === "1") return 1 as const;
  if (t === "2") return 2 as const;
  if (t === "3") return 3 as const;
  if (t === "4") return 4 as const;
  if (t.includes("mantencion preventiva") || t.includes("mantención preventiva")) return 1 as const;
  if (t === "mantencion" || t === "mantención") return 1 as const;
  if (t.includes("reparacion") || t.includes("reparación")) return 2 as const;
  if (t.includes("conversar con el sistema") || t.includes("hablar con el sistema")) return 3 as const;
  if ((t.includes("conversar") || t.includes("consulta") || t.includes("pregunta")) && t.includes("sistema")) return 3 as const;
  if (t === "volver" || t.includes("volver al menu") || t.includes("volver al menú") || t === "menu" || t === "menú") return 4 as const;
  return null;
}

function getServicioTecnicoFormOptions(state: UserState, country: Country, requestType?: "mantencion_preventiva" | "reparacion") {
  const producto = state.serviceTech?.lastProducto || "";
  const subtipo = getServicioTecnicoSubtypeLabel(requestType);
  const intro =
    country === "UY"
      ? requestType === "mantencion_preventiva"
        ? "Muy bien. Armemos tu solicitud de Mantención preventiva para Uruguay."
        : requestType === "reparacion"
          ? "Muy bien. Armemos tu solicitud de Reparación (radios y equipos) para Uruguay."
          : "Muy bien. Armemos tu solicitud de servicio técnico para Uruguay."
      : requestType === "mantencion_preventiva"
        ? "Muy bien. Armemos tu solicitud de Mantención preventiva."
        : requestType === "reparacion"
          ? "Muy bien. Armemos tu solicitud de Reparación (radios y equipos)."
          : "Muy bien. Armemos tu solicitud de servicio técnico.";
  return {
    intro,
    presetData: {
      ...(producto ? { producto } : {}),
      ...(subtipo ? { subtipo } : {}),
    },
  };
}

function getServiceNaturalGuidanceText(country: Country = "CL") {
  return country === "UY"
    ? "Si necesitas ayuda más personalizada en Uruguay, solicita el servicio técnico y te derivamos al formulario de contacto."
    : "Si necesitas ayuda mas personalizada con tu caso, solo debes solicitar el servicio tecnico y te derivamos al formulario de contacto.";
}

function getDealerNaturalGuidanceText() {
  return "Si necesitas que te pongamos en contacto con un dealer de tu region, solo debes solicitarlo y te derivamos al formulario de contacto.";
}

function getCancelReminderText() {
  return "Si en algun momento quieres salir de este proceso, solo escribe: Cancelar.";
}

function getCancelMenuHintText() {
  return "Si deseas volver al menú escribe cancelar.";
}

function getCancelConfirmationText() {
  return "Muy bien, cancelé esta solicitud. Volvamos al menú principal.";
}

function getFormInProgressText() {
  return `Ahora mismo estamos completando una solicitud. ${getCancelMenuHintText()}`;
}

function getContactFormMessagePrompt(kind: ContactFormKind) {
  switch (kind) {
    case "cl_compra_asesoria":
    case "uy_compra_asesoria":
      return "¿Qué equipo o necesidad de compra quieres revisar con el asesor? (mensaje)";
    case "cl_proyectos":
    case "uy_proyectos":
      return "¿Qué proyecto o necesidad tienes? (mensaje)";
    case "cl_arriendo_precio":
      return "";
    case "cl_dealer":
      return "¿Qué necesitas del dealer de tu región? (mensaje)";
    case "cl_servicio_tecnico":
      return "¿Qué problema o solicitud tienes? (mensaje)";
    case "uy_servicio_tecnico":
      return "¿Qué problema o solicitud tienes en Uruguay? (mensaje)";
  }
}

function getContactFormStepPrompt(step: Exclude<ContactFormStep, "final">, kind: ContactFormKind) {
  const country = getContactFormCountry(kind);
  if (step === "nombre") return "Muy bien. Para continuar, indícame tu nombre y apellido.";
  if (step === "empresa") return "¿Para qué empresa es la solicitud? Si es para ti, escribe: Particular";
  if (step === "telefono") {
    if (kind === "cl_arriendo_precio") {
      return "¿A qué número de teléfono o correo prefieres que te enviemos el detalle de precios? Puedes responder con uno de los dos.";
    }
    return buildPhonePrompt(country);
  }
  if (step === "correo") return buildEmailPrompt(country);
  if (step === "direccion") return "¿Cuál es tu dirección, comuna o referencia de ubicación?";
  if (step === "producto") return "¿Con qué equipo o producto necesitas ayuda? Si prefieres omitirlo, escribe: Omitir";
  return getContactFormMessagePrompt(kind);
}

function getContactFormNextStep(kind: ContactFormKind, data: ContactFormState["data"], optionalProductHandled?: boolean): ContactFormStep {
  if (kind === "cl_proyectos" || kind === "uy_proyectos") {
    if (!data.nombre) return "nombre";
    if (!data.empresa) return "empresa";
    if (!data.telefono) return "telefono";
    return "final";
  }
  if (kind === "cl_arriendo_precio") {
    if (!data.telefono && !data.correo) return "telefono";
    return "final";
  }
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
    if (form.kind === "cl_arriendo_precio") {
      const { email } = resolveEmailInput(input, country);
      if (email) {
        form.data.correo = email;
        form.data.telefono = "";
        return null;
      }
      const { phone, error } = resolvePhoneInput(input, country);
      if (error) return "Necesito un teléfono o un correo válido para enviarte el detalle de precios. Ej: +56912345678 o nombre@empresa.cl";
      form.data.telefono = phone;
      return null;
    }
    const { phone, error } = resolvePhoneInput(input, country);
    if (error) return error;
    form.data.telefono = phone;
    return null;
  }
  if (field === "correo") {
    const { email, error } = resolveEmailInput(input, country);
    if (error) return error;
    form.data.correo = email;
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
    if (input.trim().length < 2) return "Indícame el equipo o modelo. Si prefieres omitirlo, escribe: Omitir";
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
  if (form.kind === "cl_proyectos" || form.kind === "uy_proyectos") {
    const lines = [
      getContactFormReviewTitle(form.kind, form.data),
      "",
      "*Solicitud*",
      `- Tipo: ${getContactFormRequestLabel(form.kind, form.data)}`,
      "",
      "*Datos de contacto*",
      form.data.nombre ? `- Nombre y Apellido: ${form.data.nombre}` : "",
      form.data.telefono ? `- Teléfono: ${form.data.telefono}` : "",
      "",
      "*Empresa*",
      form.data.empresa ? `- Empresa: ${form.data.empresa}` : "- Empresa: Particular / No informada",
      "",
      "Si todo está correcto, escribe: Confirmar solicitud",
      "Si necesitas ajustar un dato, puedes decir por ejemplo: cambiar teléfono",
      getCancelMenuHintText(),
    ].filter(Boolean);
    return lines.join("\n");
  }
  if (form.kind === "cl_arriendo_precio") {
    const lines = [
      getContactFormReviewTitle(form.kind, form.data),
      "",
      "*Solicitud*",
      `- Tipo: ${getContactFormRequestLabel(form.kind, form.data)}`,
      form.data.producto ? `- Producto: ${form.data.producto}` : "",
      "",
      "*Datos de contacto*",
      form.data.telefono ? `- Teléfono: ${form.data.telefono}` : "",
      form.data.correo ? `- Correo electrónico: ${form.data.correo}` : "",
      "",
      "Si todo está correcto, escribe: Confirmar solicitud",
      "Si necesitas ajustar un dato, puedes decir por ejemplo: cambiar teléfono",
      getCancelMenuHintText(),
    ].filter(Boolean);
    return lines.join("\n");
  }
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
    "Si todo está correcto, escribe: Confirmar solicitud",
    "Si necesitas ajustar un dato, puedes decir por ejemplo: cambiar teléfono",
    getCancelMenuHintText(),
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
  try {
    const country = getContactFormCountry(form.kind);
    const kind = normalizeText(form.kind);
    const flowKey =
      kind.includes("servicio_tecnico")
        ? "servicio_tecnico"
        : kind.includes("arriendo")
          ? "arriendo"
        : kind.includes("proyectos")
          ? "proyectos"
          : kind.includes("dealer")
            ? "dealer"
            : kind.includes("cambium")
              ? "cambium"
              : "cotizacion";
    const flowLabel =
      flowKey === "servicio_tecnico"
        ? "Servicio técnico"
        : flowKey === "arriendo"
          ? "Arriendo"
        : flowKey === "proyectos"
          ? "Asesoría en proyectos"
          : flowKey === "dealer"
            ? "Dealer"
            : flowKey === "cambium"
              ? "Cambium"
              : "Cotización";
    const sheetRow: SheetsLeadRow = {
      fecha: new Date().toISOString(),
      country,
      flowKey,
      flowLabel,
      userPhone,
      nombre: form.data.nombre ?? "",
      empresa: form.data.empresa ?? "",
      telefono: form.data.telefono ?? "",
      email: form.data.correo ?? "",
      direccion: form.data.direccion ?? "",
      producto: form.data.producto ?? "",
      mensaje: form.data.mensaje ?? "",
      ciudad: "",
    };
    void withTimeout(appendLeadToGoogleSheet(sheetRow), 2500);
  } catch {}

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
    subtipo: options?.presetData?.subtipo,
    mensaje: options?.presetData?.mensaje,
  };

  const optionalProductHandled = Boolean(options?.presetData?.producto);
  const next = getContactFormNextStep(kind, data, optionalProductHandled);
  state.contactForm = { kind, step: next, data, reviewMode: false, reviewEditField: undefined, optionalProductHandled };

  if (next === "final") {
    state.contactForm.reviewMode = true;
    const review = await buildContactFormReviewMessage(state);
    const intro = options?.intro?.trim();
    if (kind === "cl_arriendo_precio") return intro ? [intro, "", review].join("\n") : review;
    return intro ? [intro, "", review].join("\n") : review;
  }

  const intro = options?.intro ?? getContactFormStartIntro(kind);
  if (kind === "cl_arriendo_precio") {
    return [intro, getCancelReminderText()].filter(Boolean).join("\n");
  }
  return [intro, "", buildProfileReuseGuidance(profile, "solicitud", next), "", getContactFormStepPrompt(next, kind), "", getCancelReminderText()].join("\n");
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
    return `Si todo está correcto, escribe: Confirmar solicitud. Si necesitas ajustar un dato, puedes decir por ejemplo: cambiar teléfono. ${getCancelMenuHintText()}`;
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
  const wantsDetail = t.includes("detalle") || t.includes("completo") || t.includes("texto completo") || t.includes("ver completo");
  const wantsMoreProjects = t.includes("ver mas proyectos") || t.includes("ver más proyectos");
  const knowledgeHints = ["certificacion", "certificación", "certificaciones", "enfoque", "banco", "informativo", "capacidad", "soluciones"];
  if (state.projects.stage === "entry") {
    if (!input) return await buildProjectsLandingMessage("UY");
    const entryChoice = parseProjectsEntryChoice(input);
    if (entryChoice === 3 || isMenuCommand(input)) {
      returnToCasualState(state);
      markMenuShown(state);
      return buildMainMenuText(state.country ?? "UY", "return");
    }
    if (entryChoice === 1 || t.includes("solicit") || t.includes("asesoria") || t.includes("asesoría") || t.includes("formulario") || t.includes("contact")) {
      return await startContactForm(state, userPhone, "uy_proyectos", { intro: getProjectsContactIntro() });
    }
    if (entryChoice !== 2) return await buildProjectsLandingMessage("UY");
    state.projects.stage = "browse";
    state.projects.offset = 0;
    state.projects.lastList = undefined;
    state.projects.reading = undefined;
  }

  let list = state.projects.lastList ?? [];
  let noMoreProjects = false;

  if (wantsDetail && state.projects.reading?.id) {
    const detail = await loadProjectContentByCountry("UY", state.projects.reading.id);
    if (!detail) return "No pude cargar ese proyecto. Elige otro número o escribe Menú.";
    const chunks = chunkText(detail.plain, 1100);
    return [
      `*${detail.titulo}*`,
      ...(chunks.length ? chunks : ["Descripción no disponible."]),
      getProjectsCtaText(),
      "Para ver otro proyecto, indícame el número o escribe Menú.",
    ].filter(Boolean);
  }

  if (wantsMoreProjects) {
    const nextOffset = state.projects.offset + 5;
    const nextList = await listProjectsByCountry("UY", nextOffset);
    if (nextList.length) {
      state.projects.offset = nextOffset;
      list = nextList;
    } else if (state.projects.offset === 0 && !list.length) {
      list = await listProjectsByCountry("UY", 0);
      noMoreProjects = true;
    } else {
      noMoreProjects = true;
    }
  } else if (t.includes("ver mas") || t.includes("ver más")) {
    state.projects.offset += 5;
    list = await listProjectsByCountry("UY", state.projects.offset);
  } else if (!list.length) {
    list = await listProjectsByCountry("UY", state.projects.offset);
  }

  state.projects.lastList = list;
  const n = isNumericChoice(t, list.length) ?? extractProjectChoiceFromText(t, list.length);
  if (n) {
    const chosen = list[n - 1];
    if (!chosen) return "Elige un número válido o escribe Menú.";
    state.projects.reading = { id: chosen.id, offset: 0 };
    const detail = await loadProjectContentByCountry("UY", chosen.id);
    if (!detail) return "No pude cargar ese proyecto. Elige otro número o escribe Menú.";
    const resumen = summarizeProject(detail.plain, 900);
    const messages: string[] = [`*${chosen.titulo}*`];
    if (resumen) messages.push(resumen);
    messages.push("Si quieres que te envíe el detalle completo, dime: Detalle.");
    messages.push(getProjectsCtaText());
    messages.push("Para ver otro proyecto, indícame el número (ej: 2) o escribe: proyecto 2.");
    return messages.filter(Boolean);
  }

  const projectKnowledge = (await loadManagedSectionContent("proyectos", "UY")).knowledgeText || loadUyProjectsData().bankText;
  if (knowledgeHints.some((h) => t.includes(normalizeText(h))) && projectKnowledge) {
    const ai = await generateKnowledgeAiAnswer({ role: "proyectos", input, knowledgeText: projectKnowledge });
    if (ai) return [ai, "", getProjectsCtaText()].join("\n");
    const clipped = projectKnowledge.length > 1400 ? `${projectKnowledge.slice(0, 1400).trim()}...` : projectKnowledge;
    return [clipped, "", getProjectsCtaText()].join("\n");
  }

  if (!list.length) return "Por ahora no veo proyectos para mostrar. Responde Menú para volver al inicio.";

  if (noMoreProjects) {
    return "Por ahora no tengo más proyectos para mostrar. Elige algún proyecto o si quieres regresamos al menú.";
  }

  const lines = list.map((p, i) => `${i + 1}) ${p.titulo}`).join("\n");
  return ["Estos son algunos proyectos:", "", lines, "", getProjectsNaturalGuidanceText(), "", getProjectsMenuReminderText()].join("\n");
}

async function handleServicioTecnicoUY(state: UserState, text: string, userPhone: string): Promise<Reply> {
  const input = text.trim();
  const managedContent = await loadManagedSectionContent("servicio_tecnico", "UY");
  state.serviceTech ??= {};
  if (!state.serviceTech.mode) state.serviceTech.mode = "submenu";
  if (!input) {
    state.serviceTech.mode = "submenu";
    return await buildServicioTecnicoLandingMessage("UY");
  }

  const detected = extractLikelyProductModel(input);
  if (detected) state.serviceTech.lastProducto = detected;
  const choice = parseServicioTecnicoChoice(input);

  if (choice === 4) {
    returnToCasualState(state);
    markMenuShown(state);
    return buildMainMenuText(state.country ?? "UY", "return");
  }

  if (choice === 1 || choice === 2) {
    const requestType = choice === 1 ? "mantencion_preventiva" : "reparacion";
    state.serviceTech.requestType = requestType;
    inboxAdd({ source: "gowa", signatureValid: null, from: userPhone, text: `[DEBUG] service-tech uy submenu to form type=${requestType}` });
    return await startContactForm(state, userPhone, "uy_servicio_tecnico", getServicioTecnicoFormOptions(state, "UY", requestType));
  }

  if (isServiceTechFormIntent(input)) {
    inboxAdd({
      source: "gowa",
      signatureValid: null,
      from: userPhone,
      text: `[DEBUG] service-tech uy routed to form producto=${state.serviceTech.lastProducto || ""} type=${state.serviceTech.requestType ?? ""}`,
    });
    return await startContactForm(state, userPhone, "uy_servicio_tecnico", getServicioTecnicoFormOptions(state, "UY", state.serviceTech.requestType));
  }

  if (choice === 3) {
    state.serviceTech.mode = "chat";
    return buildServicioTecnicoChatIntro("UY");
  }

  if (state.serviceTech.mode !== "chat") state.serviceTech.mode = "chat";
  if (isRepeatedServiceTechQuestion(state, input)) {
    inboxAdd({ source: "gowa", signatureValid: null, from: userPhone, text: `[DEBUG] service-tech uy duplicate ignored text=${input}` });
    return "";
  }

  const structuredHits = (await answerStructuredServiceKnowledge("UY", input)) ?? [];
  const knowledgeText = managedContent.knowledgeText || loadUyServicioTecnicoText();
  const ai = await generateServiceTechAiAnswer({
    input,
    knowledge: [
      ...structuredHits.map((h) => ({ tema: h.tema, info: h.info })),
      ...(knowledgeText ? [{ tema: "Servicio técnico (Uruguay)", info: knowledgeText }] : []),
    ],
  });

  const footer = buildServicioTecnicoChatFooter("UY");

  inboxAdd({
    source: "gowa",
    signatureValid: null,
    from: userPhone,
    text: `[DEBUG] service-tech uy reply generated ai=${Boolean(ai)} hits=${structuredHits.length} model=${state.serviceTech?.lastProducto ?? ""}`,
  });
  if (!ai) return [managedContent.openingText, "", footer].join("\n");

  const aiNorm = normalizeText(ai);
  const alreadyHasFooter = aiNorm.includes("4 o menu") || aiNorm.includes("4 o menú") || aiNorm.includes("volver al menu") || aiNorm.includes("volver al menú");
  return alreadyHasFooter ? ai : [ai, "", footer].join("\n");
}

async function handleServicioTecnico(state: UserState, text: string, userPhone: string) {
  const q = text.trim();
  const managedContent = await loadManagedSectionContent("servicio_tecnico", "CL");
  state.serviceTech ??= {};
  if (!state.serviceTech.mode) state.serviceTech.mode = "submenu";
  if (!q) {
    state.serviceTech.mode = "submenu";
    return await buildServicioTecnicoLandingMessage();
  }

  const detected = extractLikelyProductModel(q);
  if (detected) state.serviceTech.lastProducto = detected;
  const choice = parseServicioTecnicoChoice(q);

  if (choice === 4) {
    returnToCasualState(state);
    markMenuShown(state);
    return buildMainMenuText(state.country ?? "CL", "return");
  }

  if (choice === 1 || choice === 2) {
    const requestType = choice === 1 ? "mantencion_preventiva" : "reparacion";
    state.serviceTech.requestType = requestType;
    inboxAdd({ source: "gowa", signatureValid: null, from: userPhone, text: `[DEBUG] service-tech cl submenu to form type=${requestType}` });
    return await startContactForm(state, userPhone, "cl_servicio_tecnico", getServicioTecnicoFormOptions(state, "CL", requestType));
  }

  if (isServiceTechFormIntent(q)) {
    inboxAdd({
      source: "gowa",
      signatureValid: null,
      from: userPhone,
      text: `[DEBUG] service-tech cl routed to form producto=${state.serviceTech.lastProducto || ""} type=${state.serviceTech.requestType ?? ""}`,
    });
    return await startContactForm(state, userPhone, "cl_servicio_tecnico", getServicioTecnicoFormOptions(state, "CL", state.serviceTech.requestType));
  }

  if (choice === 3) {
    state.serviceTech.mode = "chat";
    return buildServicioTecnicoChatIntro("CL");
  }

  if (state.serviceTech.mode !== "chat") state.serviceTech.mode = "chat";
  if (isRepeatedServiceTechQuestion(state, q)) {
    inboxAdd({ source: "gowa", signatureValid: null, from: userPhone, text: `[DEBUG] service-tech cl duplicate ignored text=${q}` });
    return "";
  }

  const hits = (await answerServicioTecnico(q)) ?? [];
  const structuredHits = (await answerStructuredServiceKnowledge("CL", q)) ?? [];
  const mergedHits = [...structuredHits, ...hits].filter(
    (row, index, all) => all.findIndex((item) => normalizeText(item.tema) === normalizeText(row.tema) && normalizeText(item.info) === normalizeText(row.info)) === index,
  );
  const knowledge = [
    ...mergedHits.map((h) => ({ tema: h.tema, info: h.info })),
    ...(managedContent.knowledgeText ? [{ tema: "Servicio técnico (Chile)", info: managedContent.knowledgeText }] : []),
  ];
  const ai = await generateServiceTechAiAnswer({ input: q, knowledge });
  const footer = buildServicioTecnicoChatFooter("CL");
  if (!ai) return [managedContent.openingText, "", footer].join("\n");

  const aiNorm = normalizeText(ai);
  const alreadyHasFooter = aiNorm.includes("4 o menu") || aiNorm.includes("4 o menú") || aiNorm.includes("volver al menu") || aiNorm.includes("volver al menú");
  inboxAdd({
    source: "gowa",
    signatureValid: null,
    from: userPhone,
    text: `[DEBUG] service-tech cl reply generated ai=${Boolean(ai)} hits=${mergedHits.length} footer=${alreadyHasFooter} model=${state.serviceTech?.lastProducto ?? ""}`,
  });
  return alreadyHasFooter ? ai : [ai, "", footer].join("\n");
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
      if (input.length < 3) return "Necesito tu nombre y apellido para continuar.";
      setAndNext("nombre", input, "empresa");
      return "Muy bien. ¿Para qué empresa es la solicitud?";
    }
    if (q.step === "empresa") {
      if (input.length < 2) return "Indícame la empresa. Si la solicitud es personal, puedes escribir: Particular.";
      setAndNext("empresa", input, "telefono");
      return getCambiumStepPrompt("telefono");
    }
    if (q.step === "telefono") {
      const { phone, error } = resolvePhoneInput(input, "UY");
      if (error) return error;
      setAndNext("telefono", phone, "solucion");
      return getCambiumStepPrompt("solucion");
    }
    if (q.step === "solucion") {
      const opts = ["ePMP", "Punto a Punto", "Punto a multipunto", "Aplicaciones de Software", "Accesorios de Banda Ancha"];
      const n = extractChoiceNumberFromText(t, opts.length);
      const value = n ? opts[n - 1] : input;
      if (!value || String(value).trim().length < 2) return "¿Cuál solución te interesa? (Puedes responder con el número)";
      setAndNext("solucion", String(value).trim(), "email");
      return getCambiumStepPrompt("email");
    }
    if (q.step === "email") {
      const { email, error } = resolveEmailInput(input, "UY");
      if (error) return error;
      setAndNext("email", email, "direccion");
      return getCambiumStepPrompt("direccion");
    }
    if (q.step === "direccion") {
      if (input.length < 3) return "Necesito una dirección o referencia para continuar.";
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
      const ai = await generateKnowledgeAiAnswer({ role: "cambium", input, knowledgeText: `${data.intro}\n\n${data.bankText}`.trim() });
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
      const ai = await generateKnowledgeAiAnswer({ role: "cambium", input, knowledgeText: `${category.detail}\n\n${data.bankText}`.trim() });
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
      const profile = await loadUserProfile(userPhone);
      const dataPrefill: CambiumQuote["data"] = {
        categoria: category.title,
        producto: cambium.selected.name,
        nombre: profile?.nombre,
        empresa: profile?.empresa,
        telefono: profile?.telefono,
        email: profile?.email,
        direccion: profile?.direccion,
      };
      const next = getCambiumQuoteStep(dataPrefill);
      cambium.quote = {
        step: next,
        data: dataPrefill,
      };
      return [
        "📄 Muy bien. Armemos tu solicitud de Cambium.",
        "",
        buildProfileReuseGuidance(profile, "cambium"),
        "",
        getCambiumStepPrompt(next as Exclude<CambiumQuoteStep, "final">),
        "",
        getCancelReminderText(),
      ].join("\n");
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
          ? `Muy bien. Armemos tu solicitud para que un dealer te contacte por la zona de ${state.points.lastQuery}.`
          : "Muy bien. Armemos tu solicitud para que un dealer de tu región te contacte.",
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
      return ["Muy bien. Si quieres buscar otra zona o ciudad, escríbemela.", "", getNaturalMenuReminderText()].join("\n");
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
  const inboundDedupeTimestampMs = shouldSkipHashDedupe(String(text ?? ""))
    ? inboundTimestampMs
    : Math.floor(inboundTimestampMs / 15000) * 15000;

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
    const inboundText = sanitizeInboundWebsitePrefill(String(text ?? "").trim());
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

      const hashWindowMs = 90 * 1000;
      const hashKeepMs = 5 * 60 * 1000;
      const prevHashes = state.recentInboundHashes ?? [];
      const prunedHashes = prevHashes.filter((e) => Number.isFinite(e.ts) && e.ts > inboundTimestampMs - hashKeepMs);
      state.recentInboundHashes = prunedHashes;
      if (!shouldSkipHashDedupe(inboundText)) {
        const inboundHash = crypto
          .createHash("sha256")
          .update(`${normalizeText(userKey)}|${normalizeText(inboundText)}`)
          .digest("hex")
          .slice(0, 16);
        const isHashDuplicate = prunedHashes.some((e) => e.h === inboundHash && inboundTimestampMs - e.ts < hashWindowMs);
        state.recentInboundHashes = [{ h: inboundHash, ts: inboundTimestampMs }, ...prunedHashes.filter((e) => e.h !== inboundHash)].slice(0, 40);
        if (isHashDuplicate) {
          inboxAdd({ source: "gowa", signatureValid: null, from: userKey, text: `[DEBUG] Skipping reply: duplicate hash=${inboundHash}` });
          await saveUserState(userKey, state);
          return NextResponse.json({ ok: true }, { status: 200 });
        }
      }

      const skipIdDedupe = shouldSkipHashDedupe(inboundText);
      const derivedInboundKey = skipIdDedupe ? "" : buildInboundDedupeKey(userKey, inboundText, inboundDedupeTimestampMs);
      const inboundKeys = (skipIdDedupe ? [inboundId] : [inboundId, derivedInboundKey]).filter(Boolean) as string[];
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

      {
        const toAdd = inboundKeys.length ? inboundKeys : derivedInboundKey ? [derivedInboundKey] : [];
        const keep = (state.recentInboundIds ?? []).filter((x) => !toAdd.includes(x));
        state.recentInboundIds = [...toAdd, ...keep].slice(0, 25);
      }
      await saveUserState(userKey, state);

      await sendChatPresence(replyTo, "start");
      startedPresence = true;

      let reply: Reply = "";
      const rawBranchIntent = detectBranchIntent(inboundText, country);
      const branchIntent =
        state.activeBranch === "catalogo" && isRentalRequest(state) && rawBranchIntent.branch === "puntos_venta"
          ? { ...rawBranchIntent, branch: null as Branch | null }
          : rawBranchIntent;
      const casualChoice = parseMainMenuAction(inboundText, country) ?? branchIntent.branch;
      const unsupportedCommercialProduct = extractUnsupportedCommercialProduct(inboundText);
      const pureGreeting = isGreetingMessage(inboundText);
      const menuShownToday = state.lastMenuDate === todayKey;

      if (!isFormLockActive(state) && pureGreeting) {
        returnToCasualState(state);
        reply = withMainMenu("", state, country, menuShownToday ? "return" : "welcome");
      } else if (!isFormLockActive(state) && state.activeBranch === "menu" && !menuShownToday && !casualChoice) {
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
                reply = country === "UY" ? await handleProjectsUY(state, isLikelyMainMenuSelectionOnly(inboundText, country) ? "" : inboundText, userKey) : await handleProjects(state, isLikelyMainMenuSelectionOnly(inboundText, country) ? "" : inboundText, userKey);
              } else if (intent.branch === "servicio_tecnico") {
                reply = country === "UY" ? await handleServicioTecnicoUY(state, "", userKey) : await handleServicioTecnico(state, "", userKey);
              } else if (intent.branch === "cambium") {
                reply = await handleCambium(state, isLikelyMainMenuSelectionOnly(inboundText, country) ? "" : inboundText, userKey);
              } else if (intent.branch === "puntos_venta") {
                reply = await handlePoints(state, isLikelyMainMenuSelectionOnly(inboundText, country) ? "" : inboundText, userKey);
              } else {
                markMenuShown(state);
                reply = buildMainMenuText(country, "return");
              }
            } else {
              reply = "¿Quieres que use los datos que ya ingresaste para una nueva cotización?";
            }
          } else if (wantsCotizarOtro) {
            state.postCotizacion.awaitingReuseConfirm = true;
            reply = "Muy bien. ¿Quieres que use los datos que ya ingresaste para hacerlo más rápido?";
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
              reply = country === "UY" ? await handleProjectsUY(state, isLikelyMainMenuSelectionOnly(inboundText, country) ? "" : inboundText, userKey) : await handleProjects(state, isLikelyMainMenuSelectionOnly(inboundText, country) ? "" : inboundText, userKey);
            } else if (intent.branch === "servicio_tecnico") {
              const stInput = shouldUseServiceTechOpeningPrompt(inboundText) ? "" : inboundText;
              reply = country === "UY" ? await handleServicioTecnicoUY(state, stInput, userKey) : await handleServicioTecnico(state, stInput, userKey);
            } else if (intent.branch === "cambium") {
              reply = await handleCambium(state, isLikelyMainMenuSelectionOnly(inboundText, country) ? "" : inboundText, userKey);
            } else if (intent.branch === "puntos_venta") {
              reply = await handlePoints(state, isLikelyMainMenuSelectionOnly(inboundText, country) ? "" : inboundText, userKey);
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
          const hasCatalogContinuationContext = Boolean(
            state.catalog.selectedProductId ||
            state.catalog.lastList?.length ||
            state.catalog.pending ||
            state.catalog.quote ||
            state.catalog.filters.tipo_producto ||
            state.catalog.requestKind,
          );
          const choice = casualChoice;
          if (hasCatalogContinuationContext && !isMenuCommand(inboundText) && !branchIntent.wantsMenu && (!branchIntent.branch || branchIntent.branch === "catalogo")) {
            state.activeBranch = "catalogo";
            reply = country === "UY" ? await handleCatalogUY(state, inboundText, userKey) : await handleCatalog(state, inboundText, userKey);
          } else if (choice) {
            reply = await runMainMenuAction(state, userKey, choice, inboundText);
          } else if (unsupportedCommercialProduct) {
            const unsupportedReply = await buildUnsupportedCommercialReplyDynamic(country, unsupportedCommercialProduct, inboundText);
            reply = [unsupportedReply, "", getNaturalMenuReminderText()].join("\n\n");
          } else if (detectQuoteIntent(inboundText) || branchIntent.branch === "catalogo") {
            reply = await runMainMenuAction(state, userKey, "catalogo", inboundText);
          } else {
            const overviewReply = await buildOpenBusinessOverviewReply(country, inboundText);
            if (overviewReply) {
              reply = overviewReply;
            } else {
              const msg = await generateAiRewrite({
                kind: "fuera_menu",
                input: inboundText,
                facts:
                  country === "UY"
                    ? [
                        "Puedo ayudarte con compra de equipos y accesorios, servicio técnico, proyectos y soluciones Cambium.",
                        "Si me dices qué estás buscando, te oriento de inmediato a la ruta correcta.",
                        "Si quieres avanzar ahora, escribe Compra, Servicio técnico, Proyectos o Cambium.",
                      ]
                    : [
                        "Puedo ayudarte con compra o arriendo de equipos, servicio técnico, proyectos y puntos de venta.",
                        "Si me dices qué estás buscando, te oriento de inmediato a la ruta correcta.",
                        "Si quieres avanzar ahora, escribe Compra, Arriendo, Servicio técnico, Proyectos o Puntos de venta.",
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
                reply = country === "UY" ? await handleProjectsUY(state, isLikelyMainMenuSelectionOnly(inboundText, country) ? "" : inboundText, userKey) : await handleProjects(state, isLikelyMainMenuSelectionOnly(inboundText, country) ? "" : inboundText, userKey);
              } else if (intent.branch === "servicio_tecnico") {
                const stInput = shouldUseServiceTechOpeningPrompt(inboundText) ? "" : inboundText;
                reply = country === "UY" ? await handleServicioTecnicoUY(state, stInput, userKey) : await handleServicioTecnico(state, stInput, userKey);
              } else if (intent.branch === "cambium") {
                reply = await handleCambium(state, isLikelyMainMenuSelectionOnly(inboundText, country) ? "" : inboundText, userKey);
              } else if (intent.branch === "puntos_venta") {
                reply = await handlePoints(state, isLikelyMainMenuSelectionOnly(inboundText, country) ? "" : inboundText, userKey);
              } else {
                markMenuShown(state);
                reply = buildMainMenuText(country, "return");
              }
            }
          } else if (intent.branch && intent.branch === state.activeBranch && state.activeBranch === "proyectos") {
            reply = country === "UY" ? await handleProjectsUY(state, inboundText, userKey) : await handleProjects(state, inboundText, userKey);
          } else if (state.activeBranch === "servicio_tecnico") {
            // Usuario está en servicio_tecnico - procesar mensaje UNA SOLA VEZ
            reply = country === "UY" ? await handleServicioTecnicoUY(state, inboundText, userKey) : await handleServicioTecnico(state, inboundText, userKey);
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

      await saveUserState(userKey, state);
      const messages = Array.isArray(reply) ? reply : [reply];
      const hasProductFicha =
        messages.some((m) => m && typeof m === "object" && "type" in m && (m as OutboundMessage).type === "image") ||
        messages.some((m) => typeof m === "string" && (m.includes("📄 Ficha técnica") || m.includes("¿Qué deseas hacer ahora?")));
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
