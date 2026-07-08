import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Country = "CL" | "UY";
type SectionKey = "proyectos" | "servicio_tecnico" | "empresa";
type JsonRecord = Record<string, unknown>;

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
}

function toText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
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

function readLocalTextFile(relPath: string) {
  try {
    return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
  } catch {
    return "";
  }
}

function loadUyProjectsKnowledgeFallback() {
  const raw = readLocalTextFile(path.join("instructivo", "uruguay", "proyectos.txt"));
  const lines = (raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.toLowerCase().includes("banco informativo"));
  return (start >= 0 ? lines.slice(start) : []).join("\n").trim();
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

function getDefaultCompanyOpeningText(country: Country) {
  return [
    "InterWins es una empresa que diseña e implementa soluciones para operaciones críticas, orientadas a impactar positivamente la continuidad operativa, la seguridad en terreno y la eficiencia productiva de sus clientes.",
    "",
    country === "UY"
      ? "En Uruguay, también orientamos soluciones de conectividad y proyectos empresariales especializados."
      : "En Chile, acompañamos a empresas con soluciones de radiocomunicación profesional, conectividad, soporte técnico y proyectos tecnológicos especializados.",
  ].join("\n");
}

function getDefaultCompanyKnowledgeText(country: Country) {
  return [
    "Diseñamos e implementamos soluciones para mejorar la operación de nuestros clientes.",
    "Nos enfocamos en soluciones para operaciones críticas que aumentan la seguridad de las personas y maximizan la eficiencia productiva.",
    "InterWins puede apoyar con radiocomunicación profesional, conectividad empresarial, infraestructura de telecomunicaciones, automatización, ciberseguridad y redes IP según el contexto del proyecto.",
    country === "UY"
      ? "También orientamos requerimientos vinculados a compra, proyectos, servicio técnico y soluciones Cambium."
      : "También orientamos requerimientos vinculados a compra, arriendo, proyectos, servicio técnico y puntos de venta.",
  ].join("\n");
}

function getDefaultServiceTechOpeningText(country: Country) {
  if (country === "UY") {
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
      "Si necesitas ayuda más personalizada en Uruguay, solicita el servicio técnico y te derivamos al formulario de contacto.",
    ].join("\n");
  }

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
    "Si necesitas ayuda mas personalizada con tu caso, solo debes solicitar el servicio tecnico y te derivamos al formulario de contacto.",
  ].join("\n");
}

function getDefaultSectionContent(section: SectionKey, country: Country) {
  if (section === "proyectos") {
    return {
      openingText: getDefaultProjectsOpeningText(),
      knowledgeText: country === "UY" ? loadUyProjectsKnowledgeFallback() : "",
    };
  }

  if (section === "empresa") {
    return {
      openingText: getDefaultCompanyOpeningText(country),
      knowledgeText: getDefaultCompanyKnowledgeText(country),
    };
  }

  return {
    openingText: getDefaultServiceTechOpeningText(country),
    knowledgeText: country === "UY" ? readLocalTextFile(path.join("instructivo", "uruguay", "servicio_tecnico.txt")).trim() : "",
  };
}

function normalizeCountry(value: string): Country {
  return value === "UY" ? "UY" : "CL";
}

function normalizeSection(value: string): SectionKey {
  if (value === "servicio_tecnico") return "servicio_tecnico";
  if (value === "empresa") return "empresa";
  return "proyectos";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const section = normalizeSection((url.searchParams.get("section") ?? "").trim());
  const country = normalizeCountry((url.searchParams.get("country") ?? "").trim().toUpperCase());
  const defaults = getDefaultSectionContent(section, country);
  let warning = "";

  const query = `assistant_section_content?select=section_key,country,opening_text,knowledge_text,updated_at&limit=1&section_key=eq.${section}&country=eq.${country}`;
  const res = await supabaseFetch(query, { method: "GET" });
  if (!res.ok) {
    warning = "No pude leer assistant_section_content. Se muestran valores por defecto o fallback.";
    return NextResponse.json(
      {
        ok: true,
        content: {
          section,
          country,
          openingText: defaults.openingText,
          knowledgeText: defaults.knowledgeText,
          updatedAt: "",
          source: "fallback",
        },
        warning,
      },
      { status: 200 },
    );
  }

  const row = Array.isArray(res.data) ? asRecord(res.data[0]) : {};
  return NextResponse.json(
    {
      ok: true,
      content: {
        section,
        country,
        openingText: toText(row.opening_text) || defaults.openingText,
        knowledgeText: toText(row.knowledge_text) || defaults.knowledgeText,
        updatedAt: toText(row.updated_at),
        source: toText(row.opening_text) || toText(row.knowledge_text) ? "database" : "fallback",
      },
      warning,
    },
    { status: 200 },
  );
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON inválido." }, { status: 400 });
  }

  const row = asRecord(body);
  const section = normalizeSection(toText(row.section));
  const country = normalizeCountry(toText(row.country).toUpperCase());
  const openingText = toText(row.openingText);
  const knowledgeText = toText(row.knowledgeText);

  const payload = {
    section_key: section,
    country,
    opening_text: openingText,
    knowledge_text: knowledgeText,
    updated_at: new Date().toISOString(),
  };

  const res = await supabaseFetch("assistant_section_content?on_conflict=section_key,country", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "No pude guardar la configuración. Ejecuta primero el SQL de soporte del dashboard.",
        details: res.error,
      },
      { status: res.status || 500 },
    );
  }

  const saved = Array.isArray(res.data) ? asRecord(res.data[0]) : {};
  return NextResponse.json(
    {
      ok: true,
      content: {
        section,
        country,
        openingText: toText(saved.opening_text) || openingText,
        knowledgeText: toText(saved.knowledge_text) || knowledgeText,
        updatedAt: toText(saved.updated_at) || payload.updated_at,
        source: "database",
      },
    },
    { status: 200 },
  );
}
