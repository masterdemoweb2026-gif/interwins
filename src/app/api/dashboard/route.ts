import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type DashboardRequest = {
  id: string;
  source: "cotizaciones" | "uy_leads";
  flowKey: string;
  flowLabel: string;
  country: string;
  createdAt: string;
  userPhone: string;
  nombre: string;
  empresa: string;
  telefono: string;
  email: string;
  producto: string;
  categoria: string;
  mensaje: string;
  estado: string;
  canal: string;
};

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
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

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function toText(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function toJoinedText(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => toText(item)).filter(Boolean).join(" | ");
  }
  if (typeof value === "string") return value.trim();
  return toText(value);
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function detectCountryFromPhone(phone: string) {
  const digits = String(phone ?? "").replace(/[^\d]/g, "");
  if (digits.startsWith("598")) return "UY";
  if (digits.startsWith("56")) return "CL";
  return "CL";
}

function parseDate(value: string) {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function getCreatedAt(row: JsonRecord) {
  return (
    toText(row.created_at) ||
    toText(row.updated_at) ||
    toText(row.last_updated_at) ||
    toText(row.fecha) ||
    toText(row.inserted_at) ||
    ""
  );
}

function mapCotizacionOrigin(origen: string) {
  const normalized = normalizeText(origen);

  switch (normalized) {
    case "cl_arriendo_producto":
    case "cl_arriendo_directo":
      return { key: "arriendo", label: "Arriendo" };
    case "cl_proyectos":
      return { key: "proyectos", label: "Proyectos" };
    case "cl_dealer":
      return { key: "dealer", label: "Dealer" };
    case "cl_servicio_tecnico":
      return { key: "servicio_tecnico", label: "Servicio técnico" };
    case "cl_cotizacion_producto":
    case "uy_catalogo":
    case "cotizacion":
    case "cotizacion_general":
    case "catalogo":
    case "otro":
    case "":
      return { key: "cotizacion", label: "Cotización" };
    default:
      return normalized.includes("arriendo")
        ? { key: "arriendo", label: "Arriendo" }
        : { key: "cotizacion", label: "Cotización" };
  }
}

function mapUyFlow(flow: string) {
  switch (flow) {
    case "uy_servicio_tecnico":
      return { key: "servicio_tecnico", label: "Servicio técnico" };
    case "uy_proyectos":
      return { key: "proyectos", label: "Proyectos" };
    case "uy_cambium":
      return { key: "cambium", label: "Cambium" };
    default:
      return { key: flow || "otro", label: flow || "Otro" };
  }
}

function mapOriginDisplayLabel(value: string) {
  const normalized = normalizeText(value);
  switch (normalized) {
    case "cl_cotizacion_producto":
      return "Cotización de producto";
    case "cl_arriendo_producto":
      return "Arriendo de producto";
    case "cl_arriendo_directo":
      return "Arriendo directo";
    case "cl_dealer":
      return "Solicitud Dealer";
    case "cl_proyectos":
      return "Solicitud Proyectos";
    case "cl_servicio_tecnico":
      return "Solicitud Servicio técnico";
    case "uy_servicio_tecnico":
      return "Solicitud Servicio técnico";
    case "uy_proyectos":
      return "Solicitud Proyectos";
    case "uy_cambium":
      return "Solicitud Cambium";
    case "uy_catalogo":
    case "cotizacion":
    case "cotizacion_general":
    case "catalogo":
    case "otro":
    case "":
      return "Cotización";
    default:
      return value;
  }
}

function normalizeCotizacion(row: JsonRecord, index: number): DashboardRequest {
  const origen = toText(row.origen);
  const mapped = mapCotizacionOrigin(origen);
  const mensaje = toText(row.mensaje);
  const recomendados = [
    toJoinedText(row.recomendados_ofrecidos),
    toJoinedText(row.recomendados_incluidos),
    toJoinedText(row.recomendados_rechazados),
  ]
    .filter(Boolean)
    .join(" || ");

  return {
    id: `cotizaciones-${toText(row.id) || toText(row.user_phone) || index}`,
    source: "cotizaciones",
    flowKey: mapped.key,
    flowLabel: mapped.label,
    country: toText(row.country) || "CL",
    createdAt: getCreatedAt(row),
    userPhone: toText(row.user_phone),
    nombre: toText(row.nombre),
    empresa: toText(row.empresa),
    telefono: toText(row.telefono),
    email: toText(row.email),
    producto: toText(row.producto_nombre) || toText(row.producto_id),
    categoria: mapOriginDisplayLabel(origen) || mapped.label,
    mensaje: mensaje || recomendados,
    estado: toText(row.estado) || "enviada",
    canal: toText(row.canal) || "whatsapp",
  };
}

function normalizeUyLead(row: JsonRecord, index: number): DashboardRequest {
  const flow = toText(row.flow);
  const mapped = mapUyFlow(flow);
  const categoria = toText(row.categoria);
  return {
    id: `uy-leads-${toText(row.id) || toText(row.user_phone) || index}`,
    source: "uy_leads",
    flowKey: mapped.key,
    flowLabel: mapped.label,
    country: toText(row.country) || "UY",
    createdAt: getCreatedAt(row),
    userPhone: toText(row.user_phone),
    nombre: toText(row.nombre),
    empresa: toText(row.empresa),
    telefono: toText(row.telefono),
    email: toText(row.email),
    producto: toText(row.producto),
    categoria: mapOriginDisplayLabel(categoria || flow) || mapped.label,
    mensaje: [toText(row.solucion), toText(row.mensaje)].filter(Boolean).join(" | "),
    estado: toText(row.estado) || "recibida",
    canal: toText(row.canal) || "whatsapp",
  };
}

function escapeCsv(value: string) {
  const safe = (value ?? "").replace(/"/g, "\"\"");
  return `"${safe}"`;
}

function toCsv(rows: DashboardRequest[]) {
  const header = [
    "fecha",
    "tipo",
    "pais",
    "origen",
    "cliente",
    "empresa",
    "telefono",
    "email",
    "producto",
    "categoria",
    "mensaje",
    "estado",
    "canal",
    "fuente",
  ];

  const lines = rows.map((row) =>
    [
      row.createdAt,
      row.flowLabel,
      row.country,
      row.flowKey,
      row.nombre,
      row.empresa,
      row.telefono,
      row.email,
      row.producto,
      row.categoria,
      row.mensaje,
      row.estado,
      row.canal,
      row.source,
    ]
      .map((value) => escapeCsv(value))
      .join(","),
  );

  return [header.join(","), ...lines].join("\n");
}

async function loadDashboardData() {
  const warnings: string[] = [];
  const uyLeadsTable = (process.env.UY_LEADS_TABLE ?? "uy_leads").trim() || "uy_leads";

  const [cotizacionesRes, uyLeadsRes, messageBufferRes] = await Promise.all([
    supabaseFetch("cotizaciones?select=*&limit=2000", { method: "GET" }),
    supabaseFetch(`${uyLeadsTable}?select=*&limit=2000`, { method: "GET" }),
    supabaseFetch("message_buffer?select=user_phone&limit=5000", { method: "GET" }),
  ]);

  if (!cotizacionesRes.ok) warnings.push(`No se pudo cargar cotizaciones (${cotizacionesRes.status})`);
  if (!uyLeadsRes.ok) warnings.push(`No se pudo cargar ${uyLeadsTable} (${uyLeadsRes.status})`);
  if (!messageBufferRes.ok) warnings.push(`No se pudo cargar message_buffer (${messageBufferRes.status})`);

  const cotizacionesRows = Array.isArray(cotizacionesRes.data) ? cotizacionesRes.data.map(asRecord) : [];
  const uyLeadsRows = Array.isArray(uyLeadsRes.data) ? uyLeadsRes.data.map(asRecord) : [];
  const messageRows = Array.isArray(messageBufferRes.data) ? messageBufferRes.data.map(asRecord) : [];

  const requests = [
    ...cotizacionesRows.map((row, index) => normalizeCotizacion(row, index)),
    ...uyLeadsRows.map((row, index) => normalizeUyLead(row, index)),
  ].sort((a, b) => {
    const aDate = parseDate(a.createdAt);
    const bDate = parseDate(b.createdAt);
    if (aDate !== bDate) return bDate - aDate;
    return a.id < b.id ? 1 : -1;
  });

  const flowCounts = requests.reduce<Record<string, number>>((acc, row) => {
    acc[row.flowKey] = (acc[row.flowKey] ?? 0) + 1;
    return acc;
  }, {});

  const countryCounts = requests.reduce<Record<string, number>>((acc, row) => {
    const key = row.country || "N/A";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const conversationCountryCounts = messageRows.reduce<Record<string, number>>((acc, row) => {
    const phone = toText(row.user_phone);
    if (!phone) return acc;
    const key = detectCountryFromPhone(phone);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const uniqueConversationUsers = new Set(messageRows.map((row) => toText(row.user_phone)).filter(Boolean)).size;
  const uniqueRequestUsers = new Set(requests.map((row) => row.userPhone).filter(Boolean)).size;

  return {
    ok: true,
    summary: {
      uniqueConversationUsers,
      uniqueRequestUsers,
      totalRequests: requests.length,
      flowCounts,
      countryCounts,
      conversationCountryCounts,
      lastUpdatedAt: new Date().toISOString(),
    },
    requests,
    warnings,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const data = await loadDashboardData();

  if (format === "csv") {
    const csv = toCsv(data.requests);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="interwins-solicitudes.csv"`,
      },
    });
  }

  return NextResponse.json(data, { status: 200 });
}
