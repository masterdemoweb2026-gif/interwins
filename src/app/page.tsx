"use client";

import { useEffect, useMemo, useState } from "react";

import ContentManagementPanel from "./_components/ContentManagementPanel";

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

type DashboardResponse = {
  ok: boolean;
  summary: {
    uniqueConversationUsers: number;
    uniqueRequestUsers: number;
    totalRequests: number;
    flowCounts: Record<string, number>;
    countryCounts: Record<string, number>;
    conversationCountryCounts: Record<string, number>;
    lastUpdatedAt: string;
  };
  requests: DashboardRequest[];
  warnings: string[];
};

type CountryFilter = "all" | "CL" | "UY";

function formatDate(value: string) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function badgeClasses(flowKey: string) {
  switch (flowKey) {
    case "cotizacion":
      return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
    case "arriendo":
      return "bg-sky-500/15 text-sky-300 ring-sky-500/30";
    case "servicio_tecnico":
      return "bg-amber-500/15 text-amber-300 ring-amber-500/30";
    case "proyectos":
      return "bg-violet-500/15 text-violet-300 ring-violet-500/30";
    case "cambium":
      return "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30";
    default:
      return "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30";
  }
}

export default function Home() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [flowFilter, setFlowFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState<CountryFilter>("all");
  const [search, setSearch] = useState("");

  async function refreshDashboard() {
    setIsLoadingDashboard(true);
    setDashboardError("");
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      const data = (await res.json()) as DashboardResponse;
      if (!res.ok || !data?.ok) {
        setDashboardError("No pude cargar el panel en este momento.");
        return;
      }
      setDashboard(data);
    } catch (err) {
      setDashboardError(String(err));
    } finally {
      setIsLoadingDashboard(false);
    }
  }

  useEffect(() => {
    const bootId = window.setTimeout(() => {
      void refreshDashboard();
    }, 0);
    const dashboardId = window.setInterval(() => {
      void refreshDashboard();
    }, 30000);
    return () => {
      window.clearTimeout(bootId);
      window.clearInterval(dashboardId);
    };
  }, []);

  const flowOptions = useMemo(() => {
    const items = dashboard?.requests ?? [];
    const unique = new Map<string, string>();
    for (const item of items) {
      if (!unique.has(item.flowKey)) unique.set(item.flowKey, item.flowLabel);
    }
    return Array.from(unique.entries()).map(([value, label]) => ({ value, label }));
  }, [dashboard]);

  const countryScopedRequests = useMemo(() => {
    const items = dashboard?.requests ?? [];
    if (countryFilter === "all") return items;
    return items.filter((item) => item.country === countryFilter);
  }, [dashboard, countryFilter]);

  const filteredRequests = useMemo(() => {
    const items = countryScopedRequests;
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const byFlow = flowFilter === "all" || item.flowKey === flowFilter;
      if (!byFlow) return false;
      if (!query) return true;
      const haystack = [
        item.flowLabel,
        item.country,
        item.nombre,
        item.empresa,
        item.telefono,
        item.email,
        item.producto,
        item.categoria,
        item.mensaje,
        item.userPhone,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [countryScopedRequests, flowFilter, search]);

  const summary = dashboard?.summary;
  const countryScopedFlowCounts = useMemo(
    () =>
      countryScopedRequests.reduce<Record<string, number>>((acc, item) => {
        acc[item.flowKey] = (acc[item.flowKey] ?? 0) + 1;
        return acc;
      }, {}),
    [countryScopedRequests],
  );
  const countryScopedUniqueRequestUsers = useMemo(
    () => new Set(countryScopedRequests.map((item) => item.userPhone).filter(Boolean)).size,
    [countryScopedRequests],
  );
  const countryScopedUniqueConversationUsers =
    countryFilter === "all" ? (summary?.uniqueConversationUsers ?? 0) : (summary?.conversationCountryCounts[countryFilter] ?? 0);
  const supportCount =
    (countryScopedFlowCounts.servicio_tecnico ?? 0) + (countryScopedFlowCounts.proyectos ?? 0) + (countryScopedFlowCounts.cambium ?? 0);
  const activeCountryLabel = countryFilter === "CL" ? "Chile" : countryFilter === "UY" ? "Uruguay" : "General";
  const cards = [
    {
      label: "Usuarios en flujo",
      value: countryScopedUniqueConversationUsers,
      detail: `Personas que ya interactuaron por WhatsApp en ${activeCountryLabel.toLowerCase()}`,
      accent: "from-emerald-500/20 to-emerald-500/5",
    },
    {
      label: "Usuarios con solicitud",
      value: countryScopedUniqueRequestUsers,
      detail: `Contactos que ya dejaron formulario en ${activeCountryLabel.toLowerCase()}`,
      accent: "from-sky-500/20 to-sky-500/5",
    },
    {
      label: "Solicitudes totales",
      value: countryScopedRequests.length,
      detail: `Registros consolidados de ${activeCountryLabel.toLowerCase()}`,
      accent: "from-violet-500/20 to-violet-500/5",
    },
    {
      label: "Cotizaciones",
      value: countryScopedFlowCounts.cotizacion ?? 0,
      detail: "Solicitudes de compra o catálogo",
      accent: "from-emerald-400/20 to-emerald-400/5",
    },
    {
      label: "Arriendos",
      value: countryScopedFlowCounts.arriendo ?? 0,
      detail: "Solicitudes de arriendo registradas",
      accent: "from-cyan-400/20 to-cyan-400/5",
    },
    {
      label: "Soporte y proyectos",
      value: supportCount,
      detail: "Servicio técnico, proyectos y Cambium",
      accent: "from-amber-400/20 to-amber-400/5",
    },
  ];

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top,#27272a_0%,#09090b_45%,#020617_100%)] font-sans text-zinc-50">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-8 md:px-8 lg:px-10">
        <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur xl:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <div className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
                Panel InterWins
              </div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Solicitudes, leads y actividad del asistente</h1>
              <p className="max-w-2xl text-sm leading-6 text-zinc-300 md:text-base">
                Vista consolidada de cotizaciones, arriendos, servicio técnico, proyectos y formularios capturados desde WhatsApp.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={refreshDashboard}
                className="h-11 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Refrescar panel
              </button>
              <a
                href="/catalog"
                className="inline-flex h-11 items-center rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Catálogo
              </a>
              <a
                href="/api/dashboard?format=csv"
                className="inline-flex h-11 items-center rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                Exportar data
              </a>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 shadow-xl shadow-black/10 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.24em] text-zinc-500">Vista por país</div>
              <p className="mt-1 text-sm text-zinc-400">Activa un país para ver solo sus cuadrantes y registros. Sin selección, la vista es general.</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {[
                { value: "CL" as const, label: "Chile" },
                { value: "UY" as const, label: "Uruguay" },
              ].map((option) => {
                const isActive = countryFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setCountryFilter((current) => (current === option.value ? "all" : option.value))}
                    className={[
                      "inline-flex h-11 items-center rounded-2xl border px-5 text-sm font-semibold transition",
                      isActive
                        ? "border-cyan-300/50 bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/20"
                        : "border-white/10 bg-white/5 text-zinc-200 hover:border-cyan-400/30 hover:bg-white/10",
                    ].join(" ")}
                  >
                    {option.label}
                  </button>
                );
              })}

              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-zinc-300">
                Vista actual: <span className="font-semibold text-white">{activeCountryLabel}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <article
              key={card.label}
              className={`rounded-3xl border border-white/10 bg-gradient-to-br ${card.accent} p-5 shadow-lg shadow-black/10`}
            >
              <div className="text-sm text-zinc-300">{card.label}</div>
              <div className="mt-3 text-3xl font-semibold tracking-tight">{card.value}</div>
              <div className="mt-2 text-sm text-zinc-400">{card.detail}</div>
            </article>
          ))}
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 shadow-2xl shadow-black/10 backdrop-blur">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Solicitudes registradas</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Última actualización: {summary?.lastUpdatedAt ? formatDate(summary.lastUpdatedAt) : "Cargando..."}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2 lg:min-w-[380px] xl:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Tipo de solicitud</label>
                  <select
                    value={flowFilter}
                    onChange={(e) => setFlowFilter(e.target.value)}
                    className="dashboard-select h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  >
                    <option value="all">Todas</option>
                    {flowOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Buscar</label>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cliente, empresa, correo, producto..."
                    className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-cyan-400/40"
                  />
                </div>
              </div>
            </div>

            {dashboard?.warnings?.length ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                {dashboard.warnings.join(" | ")}
              </div>
            ) : null}

            {dashboardError ? (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{dashboardError}</div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Chile</div>
                <div className="mt-2 text-2xl font-semibold">{summary?.countryCounts.CL ?? 0}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Uruguay</div>
                <div className="mt-2 text-2xl font-semibold">{summary?.countryCounts.UY ?? 0}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Filtradas</div>
                <div className="mt-2 text-2xl font-semibold">{filteredRequests.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Fuentes activas</div>
                <div className="mt-2 text-2xl font-semibold">{new Set(countryScopedRequests.map((item) => item.source)).size}</div>
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/20">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-zinc-500">
                    <tr>
                      <th className="px-4 py-4 font-medium">Fecha</th>
                      <th className="px-4 py-4 font-medium">Tipo</th>
                      <th className="px-4 py-4 font-medium">Cliente</th>
                      <th className="px-4 py-4 font-medium">Empresa</th>
                      <th className="px-4 py-4 font-medium">Contacto</th>
                      <th className="px-4 py-4 font-medium">Detalle</th>
                      <th className="px-4 py-4 font-medium">Origen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {isLoadingDashboard ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-zinc-400">
                          Cargando panel...
                        </td>
                      </tr>
                    ) : filteredRequests.length ? (
                      filteredRequests.map((item) => (
                        <tr key={item.id} className="align-top transition hover:bg-white/[0.03]">
                          <td className="px-4 py-4 text-zinc-300">
                            <div>{formatDate(item.createdAt)}</div>
                            <div className="mt-1 text-xs text-zinc-500">{item.country || "N/A"}</div>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ring-1 ${badgeClasses(item.flowKey)}`}>
                              {item.flowLabel}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="font-medium text-white">{item.nombre || "Sin nombre"}</div>
                            <div className="mt-1 text-xs text-zinc-500">{item.userPhone || "Sin teléfono base"}</div>
                          </td>
                          <td className="px-4 py-4 text-zinc-300">{item.empresa || "Particular / No informado"}</td>
                          <td className="px-4 py-4 text-zinc-300">
                            <div>{item.telefono || "-"}</div>
                            <div className="mt-1 text-xs text-zinc-500">{item.email || "-"}</div>
                          </td>
                          <td className="px-4 py-4 text-zinc-300">
                            <div className="font-medium text-white">{item.producto || item.categoria || "Sin detalle principal"}</div>
                            <div className="mt-1 max-w-md text-xs leading-5 text-zinc-500">{item.mensaje || "Sin observaciones"}</div>
                          </td>
                          <td className="px-4 py-4 text-zinc-400">
                            <div>{item.categoria || item.flowKey}</div>
                            <div className="mt-1 text-xs text-zinc-500">
                              {item.source} · {item.canal} · {item.estado}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-zinc-400">
                          No encontré solicitudes con esos filtros.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <ContentManagementPanel />
      </main>
    </div>
  );
}
