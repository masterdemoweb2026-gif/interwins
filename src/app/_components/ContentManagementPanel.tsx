"use client";

import { useEffect, useState } from "react";

type Country = "CL" | "UY";
type SectionKey = "proyectos" | "servicio_tecnico" | "empresa";
type ActiveTab = "proyectos" | "servicio_tecnico" | "empresa";

type SectionContentPayload = {
  section: SectionKey;
  country: Country;
  openingText: string;
  knowledgeText: string;
  updatedAt: string;
  source: string;
};

type SectionContentResponse = {
  ok: boolean;
  content: SectionContentPayload;
  warning?: string;
  error?: string;
};

type ProjectRow = {
  id: string;
  titulo: string;
  contenido: string;
  country: Country;
  source: "database" | "file";
};

type ProjectsResponse = {
  ok: boolean;
  rows: ProjectRow[];
  warning?: string;
  error?: string;
};

type ServiceKnowledgeRow = {
  id: string;
  country: Country;
  tema: string;
  palabrasClave: string[];
  keywordsText: string;
  informacion: string;
  prioridad: number;
  activo: boolean;
  source: "database" | "legacy";
};

type ServiceKnowledgeResponse = {
  ok: boolean;
  rows: ServiceKnowledgeRow[];
  warning?: string;
  error?: string;
};

function formatDate(value: string) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function emptySection(section: SectionKey, country: Country): SectionContentPayload {
  return {
    section,
    country,
    openingText: "",
    knowledgeText: "",
    updatedAt: "",
    source: "fallback",
  };
}

function emptyProject(country: Country): Omit<ProjectRow, "id" | "source"> {
  return {
    titulo: "",
    contenido: "",
    country,
  };
}

function emptyKnowledge(country: Country): Omit<ServiceKnowledgeRow, "id" | "source" | "palabrasClave"> {
  return {
    country,
    tema: "",
    keywordsText: "",
    informacion: "",
    prioridad: 100,
    activo: true,
  };
}

export default function ContentManagementPanel() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("proyectos");

  const [companyCountry, setCompanyCountry] = useState<Country>("CL");
  const [companyContent, setCompanyContent] = useState<SectionContentPayload>(emptySection("empresa", "CL"));
  const [companyLoading, setCompanyLoading] = useState(true);
  const [companySaving, setCompanySaving] = useState(false);
  const [companyError, setCompanyError] = useState("");
  const [companyWarning, setCompanyWarning] = useState("");

  const [projectsCountry, setProjectsCountry] = useState<Country>("CL");
  const [projectsContent, setProjectsContent] = useState<SectionContentPayload>(emptySection("proyectos", "CL"));
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsSaving, setProjectsSaving] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [projectsWarning, setProjectsWarning] = useState("");
  const [projectRows, setProjectRows] = useState<ProjectRow[]>([]);
  const [projectRowsLoading, setProjectRowsLoading] = useState(true);
  const [projectRowsSavingId, setProjectRowsSavingId] = useState<string | null>(null);
  const [projectDrafts, setProjectDrafts] = useState<Record<string, { titulo: string; contenido: string }>>({});
  const [newProject, setNewProject] = useState<Omit<ProjectRow, "id" | "source">>(emptyProject("CL"));

  const [serviceCountry, setServiceCountry] = useState<Country>("CL");
  const [serviceContent, setServiceContent] = useState<SectionContentPayload>(emptySection("servicio_tecnico", "CL"));
  const [serviceLoading, setServiceLoading] = useState(true);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [serviceError, setServiceError] = useState("");
  const [serviceWarning, setServiceWarning] = useState("");
  const [serviceKnowledgeRows, setServiceKnowledgeRows] = useState<ServiceKnowledgeRow[]>([]);
  const [serviceKnowledgeLoading, setServiceKnowledgeLoading] = useState(true);
  const [serviceKnowledgeSavingId, setServiceKnowledgeSavingId] = useState<string | null>(null);
  const [serviceKnowledgeImporting, setServiceKnowledgeImporting] = useState(false);
  const [serviceKnowledgeDrafts, setServiceKnowledgeDrafts] = useState<
    Record<string, { tema: string; keywordsText: string; informacion: string; prioridad: number; activo: boolean }>
  >({});
  const [newServiceKnowledge, setNewServiceKnowledge] =
    useState<Omit<ServiceKnowledgeRow, "id" | "source" | "palabrasClave">>(emptyKnowledge("CL"));

  async function loadSectionContent(section: SectionKey, country: Country) {
    const res = await fetch(`/api/dashboard/content/admin?section=${section}&country=${country}`, { cache: "no-store" });
    const json = (await res.json()) as SectionContentResponse;
    if (!res.ok || !json.ok) {
      throw new Error(json.error || "No pude cargar la configuración.");
    }
    return json;
  }

  async function saveSectionContent(section: SectionKey, country: Country, payload: { openingText: string; knowledgeText: string }) {
    const res = await fetch("/api/dashboard/content/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section,
        country,
        openingText: payload.openingText,
        knowledgeText: payload.knowledgeText,
      }),
    });
    const json = (await res.json()) as SectionContentResponse;
    if (!res.ok || !json.ok) {
      throw new Error(json.error || "No pude guardar la configuración.");
    }
    return json;
  }

  async function loadProjects(country: Country) {
    const res = await fetch(`/api/dashboard/projects/admin?country=${country}`, { cache: "no-store" });
    const json = (await res.json()) as ProjectsResponse;
    if (!res.ok || !json.ok) {
      throw new Error(json.error || "No pude cargar los proyectos.");
    }
    return json;
  }

  async function loadServiceKnowledge(country: Country) {
    const res = await fetch(`/api/dashboard/service-knowledge/admin?country=${country}`, { cache: "no-store" });
    const json = (await res.json()) as ServiceKnowledgeResponse;
    if (!res.ok || !json.ok) {
      throw new Error(json.error || "No pude cargar el conocimiento técnico.");
    }
    return json;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setCompanyLoading(true);
      setCompanyError("");
      try {
        const json = await loadSectionContent("empresa", companyCountry);
        if (cancelled) return;
        setCompanyContent(json.content);
        setCompanyWarning(json.warning || "");
      } catch (err) {
        if (cancelled) return;
        setCompanyError(String(err));
      } finally {
        if (cancelled) return;
        setCompanyLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyCountry]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setProjectsLoading(true);
      setProjectsError("");
      try {
        const json = await loadSectionContent("proyectos", projectsCountry);
        if (cancelled) return;
        setProjectsContent(json.content);
        setProjectsWarning(json.warning || "");
      } catch (err) {
        if (cancelled) return;
        setProjectsError(String(err));
      } finally {
        if (cancelled) return;
        setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectsCountry]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setProjectRowsLoading(true);
      setProjectsError("");
      setNewProject(emptyProject(projectsCountry));
      try {
        const json = await loadProjects(projectsCountry);
        if (cancelled) return;
        setProjectRows(json.rows);
        setProjectsWarning((prev) => [prev, json.warning].filter(Boolean).join(" | "));
        setProjectDrafts(
          Object.fromEntries(
            json.rows.map((row) => [
              row.id,
              {
                titulo: row.titulo,
                contenido: row.contenido,
              },
            ]),
          ),
        );
      } catch (err) {
        if (cancelled) return;
        setProjectsError(String(err));
      } finally {
        if (cancelled) return;
        setProjectRowsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectsCountry]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setServiceLoading(true);
      setServiceError("");
      try {
        const json = await loadSectionContent("servicio_tecnico", serviceCountry);
        if (cancelled) return;
        setServiceContent(json.content);
        setServiceWarning(json.warning || "");
      } catch (err) {
        if (cancelled) return;
        setServiceError(String(err));
      } finally {
        if (cancelled) return;
        setServiceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceCountry]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setServiceKnowledgeLoading(true);
      setServiceError("");
      setNewServiceKnowledge(emptyKnowledge(serviceCountry));
      try {
        const json = await loadServiceKnowledge(serviceCountry);
        if (cancelled) return;
        setServiceKnowledgeRows(json.rows);
        setServiceWarning((prev) => [prev, json.warning].filter(Boolean).join(" | "));
        setServiceKnowledgeDrafts(
          Object.fromEntries(
            json.rows.map((row) => [
              row.id,
              {
                tema: row.tema,
                keywordsText: row.keywordsText,
                informacion: row.informacion,
                prioridad: row.prioridad,
                activo: row.activo,
              },
            ]),
          ),
        );
      } catch (err) {
        if (cancelled) return;
        setServiceError(String(err));
      } finally {
        if (cancelled) return;
        setServiceKnowledgeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceCountry]);

  async function handleSaveProjectsContent() {
    setProjectsSaving(true);
    setProjectsError("");
    try {
      const json = await saveSectionContent("proyectos", projectsCountry, {
        openingText: projectsContent.openingText,
        knowledgeText: projectsContent.knowledgeText,
      });
      setProjectsContent(json.content);
      setProjectsWarning(json.warning || "");
    } catch (err) {
      setProjectsError(String(err));
    } finally {
      setProjectsSaving(false);
    }
  }

  async function handleSaveCompanyContent() {
    setCompanySaving(true);
    setCompanyError("");
    try {
      const json = await saveSectionContent("empresa", companyCountry, {
        openingText: companyContent.openingText,
        knowledgeText: companyContent.knowledgeText,
      });
      setCompanyContent(json.content);
      setCompanyWarning(json.warning || "");
    } catch (err) {
      setCompanyError(String(err));
    } finally {
      setCompanySaving(false);
    }
  }

  async function handleSaveServiceContent() {
    setServiceSaving(true);
    setServiceError("");
    try {
      const json = await saveSectionContent("servicio_tecnico", serviceCountry, {
        openingText: serviceContent.openingText,
        knowledgeText: serviceContent.knowledgeText,
      });
      setServiceContent(json.content);
      setServiceWarning(json.warning || "");
    } catch (err) {
      setServiceError(String(err));
    } finally {
      setServiceSaving(false);
    }
  }

  async function handleCreateProject() {
    if (!newProject.titulo.trim() || !newProject.contenido.trim()) {
      setProjectsError("Necesito título y contenido para crear el proyecto.");
      return;
    }
    setProjectRowsSavingId("new");
    setProjectsError("");
    try {
      const res = await fetch("/api/dashboard/projects/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProject),
      });
      const json = (await res.json()) as { ok: boolean; row?: ProjectRow; warning?: string; error?: string };
      if (!res.ok || !json.ok || !json.row) throw new Error(json.error || "No pude crear el proyecto.");
      const createdRow = json.row;
      setProjectRows((prev) => [...prev, createdRow]);
      setProjectDrafts((prev) => ({
        ...prev,
        [createdRow.id]: { titulo: createdRow.titulo, contenido: createdRow.contenido },
      }));
      setNewProject(emptyProject(projectsCountry));
      setProjectsWarning(json.warning || "");
    } catch (err) {
      setProjectsError(String(err));
    } finally {
      setProjectRowsSavingId(null);
    }
  }

  async function handleSaveProject(id: string) {
    const draft = projectDrafts[id];
    if (!draft?.titulo.trim() || !draft?.contenido.trim()) {
      setProjectsError("No puedo guardar proyectos vacíos.");
      return;
    }
    setProjectRowsSavingId(id);
    setProjectsError("");
    try {
      const res = await fetch("/api/dashboard/projects/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, country: projectsCountry, ...draft }),
      });
      const json = (await res.json()) as { ok: boolean; row?: ProjectRow; warning?: string; error?: string };
      if (!res.ok || !json.ok || !json.row) throw new Error(json.error || "No pude actualizar el proyecto.");
      setProjectRows((prev) => prev.map((row) => (row.id === id ? json.row! : row)));
      setProjectsWarning(json.warning || "");
    } catch (err) {
      setProjectsError(String(err));
    } finally {
      setProjectRowsSavingId(null);
    }
  }

  async function handleDeleteProject(id: string) {
    const confirmDelete = window.confirm("¿Seguro que quieres eliminar este proyecto?");
    if (!confirmDelete) return;
    setProjectRowsSavingId(id);
    setProjectsError("");
    try {
      const res = await fetch(`/api/dashboard/projects/admin?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || "No pude eliminar el proyecto.");
      setProjectRows((prev) => prev.filter((row) => row.id !== id));
      setProjectDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setProjectsError(String(err));
    } finally {
      setProjectRowsSavingId(null);
    }
  }

  async function handleCreateServiceKnowledge() {
    if (!newServiceKnowledge.tema.trim() || !newServiceKnowledge.informacion.trim()) {
      setServiceError("Necesito tema e información para crear el conocimiento técnico.");
      return;
    }
    setServiceKnowledgeSavingId("new");
    setServiceError("");
    try {
      const res = await fetch("/api/dashboard/service-knowledge/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newServiceKnowledge),
      });
      const json = (await res.json()) as { ok: boolean; row?: ServiceKnowledgeRow; error?: string };
      if (!res.ok || !json.ok || !json.row) throw new Error(json.error || "No pude crear el conocimiento técnico.");
      const createdRow = json.row;
      setServiceKnowledgeRows((prev) => [...prev, createdRow].sort((a, b) => a.prioridad - b.prioridad || Number(a.id) - Number(b.id)));
      setServiceKnowledgeDrafts((prev) => ({
        ...prev,
        [createdRow.id]: {
          tema: createdRow.tema,
          keywordsText: createdRow.keywordsText,
          informacion: createdRow.informacion,
          prioridad: createdRow.prioridad,
          activo: createdRow.activo,
        },
      }));
      setNewServiceKnowledge(emptyKnowledge(serviceCountry));
    } catch (err) {
      setServiceError(String(err));
    } finally {
      setServiceKnowledgeSavingId(null);
    }
  }

  async function handleSaveServiceKnowledge(id: string) {
    const draft = serviceKnowledgeDrafts[id];
    if (!draft?.tema.trim() || !draft?.informacion.trim()) {
      setServiceError("No puedo guardar conocimiento técnico vacío.");
      return;
    }
    setServiceKnowledgeSavingId(id);
    setServiceError("");
    try {
      const res = await fetch("/api/dashboard/service-knowledge/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, country: serviceCountry, ...draft }),
      });
      const json = (await res.json()) as { ok: boolean; row?: ServiceKnowledgeRow; error?: string };
      if (!res.ok || !json.ok || !json.row) throw new Error(json.error || "No pude actualizar el conocimiento técnico.");
      const updatedRow = json.row;
      setServiceKnowledgeRows((prev) => prev.map((row) => (row.id === id ? updatedRow : row)).sort((a, b) => a.prioridad - b.prioridad || Number(a.id) - Number(b.id)));
    } catch (err) {
      setServiceError(String(err));
    } finally {
      setServiceKnowledgeSavingId(null);
    }
  }

  async function handleDeleteServiceKnowledge(id: string) {
    const confirmDelete = window.confirm("¿Seguro que quieres eliminar este conocimiento técnico?");
    if (!confirmDelete) return;
    setServiceKnowledgeSavingId(id);
    setServiceError("");
    try {
      const res = await fetch(`/api/dashboard/service-knowledge/admin?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || "No pude eliminar el conocimiento técnico.");
      setServiceKnowledgeRows((prev) => prev.filter((row) => row.id !== id));
      setServiceKnowledgeDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setServiceError(String(err));
    } finally {
      setServiceKnowledgeSavingId(null);
    }
  }

  async function handleImportServiceKnowledgeFromText() {
    const rawText = serviceContent.knowledgeText.trim();
    if (!rawText) {
      setServiceError("Primero debes tener contenido en el bloque 'Conocimiento IA libre' para importarlo.");
      return;
    }

    const confirmed = window.confirm(
      "Esta importación solo agregará nuevos registros al conocimiento estructurado. No reemplaza ni elimina nada. ¿Quieres continuar?",
    );
    if (!confirmed) return;

    setServiceKnowledgeImporting(true);
    setServiceError("");
    try {
      const res = await fetch("/api/dashboard/service-knowledge/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_from_text",
          country: serviceCountry,
          rawText,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        rows?: ServiceKnowledgeRow[];
        importedCount?: number;
        skippedCount?: number;
        warning?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error || "No pude importar el conocimiento técnico.");

      const importedRows = json.rows ?? [];
      if (importedRows.length) {
        setServiceKnowledgeRows((prev) =>
          [...prev, ...importedRows]
            .filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index)
            .sort((a, b) => a.prioridad - b.prioridad || Number(a.id) - Number(b.id)),
        );
        setServiceKnowledgeDrafts((prev) => ({
          ...prev,
          ...Object.fromEntries(
            importedRows.map((row) => [
              row.id,
              {
                tema: row.tema,
                keywordsText: row.keywordsText,
                informacion: row.informacion,
                prioridad: row.prioridad,
                activo: row.activo,
              },
            ]),
          ),
        }));
      }

      const resultMessage =
        typeof json.importedCount === "number" || typeof json.skippedCount === "number"
          ? `Importados: ${json.importedCount ?? 0}. Omitidos por duplicado: ${json.skippedCount ?? 0}.`
          : "Importación completada.";
      setServiceWarning([json.warning, resultMessage].filter(Boolean).join(" | "));
    } catch (err) {
      setServiceError(String(err));
    } finally {
      setServiceKnowledgeImporting(false);
    }
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 shadow-2xl shadow-black/10 backdrop-blur">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Gestión de contenido</h2>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              Administra la apertura de ramas, el conocimiento que usa la IA y el contenido institucional, de proyectos y de servicio técnico.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {[
              { value: "empresa" as const, label: "Empresa" },
              { value: "proyectos" as const, label: "Proyectos" },
              { value: "servicio_tecnico" as const, label: "Servicio Técnico" },
            ].map((tab) => {
              const isActive = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={[
                    "inline-flex h-11 items-center rounded-2xl border px-5 text-sm font-semibold transition",
                    isActive
                      ? "border-cyan-300/50 bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/20"
                      : "border-white/10 bg-white/5 text-zinc-200 hover:border-cyan-400/30 hover:bg-white/10",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === "empresa" ? (
          <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-white">Configuración Institucional</div>
                <div className="mt-1 text-xs text-zinc-500">Última actualización: {formatDate(companyContent.updatedAt)}</div>
              </div>
              <div className="flex gap-3">
                {(["CL", "UY"] as Country[]).map((country) => (
                  <button
                    key={country}
                    type="button"
                    onClick={() => setCompanyCountry(country)}
                    className={[
                      "inline-flex h-10 items-center rounded-xl border px-4 text-sm font-medium transition",
                      companyCountry === country
                        ? "border-cyan-300/50 bg-cyan-400 text-slate-950"
                        : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10",
                    ].join(" ")}
                  >
                    {country === "CL" ? "Chile" : "Uruguay"}
                  </button>
                ))}
              </div>
            </div>

            {companyWarning ? <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{companyWarning}</div> : null}
            {companyError ? <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{companyError}</div> : null}

            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Resumen institucional</label>
                <textarea
                  value={companyContent.openingText}
                  onChange={(e) => setCompanyContent((prev) => ({ ...prev, openingText: e.target.value }))}
                  rows={14}
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Conocimiento institucional IA</label>
                <textarea
                  value={companyContent.knowledgeText}
                  onChange={(e) => setCompanyContent((prev) => ({ ...prev, knowledgeText: e.target.value }))}
                  rows={14}
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSaveCompanyContent}
                disabled={companyLoading || companySaving}
                className="inline-flex h-11 items-center rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {companySaving ? "Guardando..." : "Guardar configuración institucional"}
              </button>
              <div className="text-xs text-zinc-500">Este contenido se usa para responder preguntas como qué es InterWins, quiénes son o a qué se dedican.</div>
            </div>
          </div>
        ) : activeTab === "proyectos" ? (
          <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
            <div className="space-y-5">
              <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white">Configuración de Proyectos</div>
                    <div className="mt-1 text-xs text-zinc-500">Última actualización: {formatDate(projectsContent.updatedAt)}</div>
                  </div>
                  <div className="flex gap-3">
                    {(["CL", "UY"] as Country[]).map((country) => (
                      <button
                        key={country}
                        type="button"
                        onClick={() => setProjectsCountry(country)}
                        className={[
                          "inline-flex h-10 items-center rounded-xl border px-4 text-sm font-medium transition",
                          projectsCountry === country
                            ? "border-cyan-300/50 bg-cyan-400 text-slate-950"
                            : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10",
                        ].join(" ")}
                      >
                        {country === "CL" ? "Chile" : "Uruguay"}
                      </button>
                    ))}
                  </div>
                </div>

                {projectsWarning ? <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{projectsWarning}</div> : null}
                {projectsError ? <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{projectsError}</div> : null}

                <div className="mt-5 space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Mensaje de apertura</label>
                    <textarea
                      value={projectsContent.openingText}
                      onChange={(e) => setProjectsContent((prev) => ({ ...prev, openingText: e.target.value }))}
                      rows={10}
                      className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Conocimiento IA</label>
                    <textarea
                      value={projectsContent.knowledgeText}
                      onChange={(e) => setProjectsContent((prev) => ({ ...prev, knowledgeText: e.target.value }))}
                      rows={10}
                      className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveProjectsContent}
                    disabled={projectsLoading || projectsSaving}
                    className="inline-flex h-11 items-center rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {projectsSaving ? "Guardando..." : "Guardar configuración de Proyectos"}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                <div className="text-sm font-semibold text-white">Agregar proyecto</div>
                <div className="mt-4 space-y-3">
                  <input
                    value={newProject.titulo}
                    onChange={(e) => setNewProject((prev) => ({ ...prev, titulo: e.target.value }))}
                    placeholder="Título del proyecto"
                    className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-cyan-400/40"
                  />
                  <textarea
                    value={newProject.contenido}
                    onChange={(e) => setNewProject((prev) => ({ ...prev, contenido: e.target.value }))}
                    rows={7}
                    placeholder="Contenido del proyecto"
                    className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-cyan-400/40"
                  />
                  <button
                    type="button"
                    onClick={handleCreateProject}
                    disabled={projectRowsSavingId === "new"}
                    className="inline-flex h-11 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {projectRowsSavingId === "new" ? "Creando..." : "Crear proyecto"}
                  </button>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                <div className="text-sm font-semibold text-white">Proyectos existentes</div>
                <div className="mt-4 space-y-4">
                  {projectRowsLoading ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-zinc-400">Cargando proyectos...</div>
                  ) : projectRows.length ? (
                    projectRows.map((row) => {
                      const draft = projectDrafts[row.id] ?? { titulo: row.titulo, contenido: row.contenido };
                      const isSaving = projectRowsSavingId === row.id;
                      const readOnly = row.source !== "database";
                      return (
                        <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">ID {row.id}</span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">
                              {row.source === "database" ? "Base de datos" : "Archivo fallback"}
                            </span>
                          </div>
                          <div className="space-y-3">
                            <input
                              value={draft.titulo}
                              onChange={(e) =>
                                setProjectDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { ...draft, titulo: e.target.value },
                                }))
                              }
                              readOnly={readOnly}
                              className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none read-only:opacity-70 focus:border-cyan-400/40"
                            />
                            <textarea
                              value={draft.contenido}
                              onChange={(e) =>
                                setProjectDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { ...draft, contenido: e.target.value },
                                }))
                              }
                              readOnly={readOnly}
                              rows={6}
                              className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none read-only:opacity-70 focus:border-cyan-400/40"
                            />
                            <div className="flex flex-wrap gap-3">
                              <button
                                type="button"
                                onClick={() => void handleSaveProject(row.id)}
                                disabled={readOnly || isSaving}
                                className="inline-flex h-10 items-center rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isSaving ? "Guardando..." : "Guardar"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteProject(row.id)}
                                disabled={readOnly || isSaving}
                                className="inline-flex h-10 items-center rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-zinc-400">No hay proyectos cargados para este país.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">Configuración de Servicio Técnico</div>
                  <div className="mt-1 text-xs text-zinc-500">Última actualización: {formatDate(serviceContent.updatedAt)}</div>
                </div>
                <div className="flex gap-3">
                  {(["CL", "UY"] as Country[]).map((country) => (
                    <button
                      key={country}
                      type="button"
                      onClick={() => setServiceCountry(country)}
                      className={[
                        "inline-flex h-10 items-center rounded-xl border px-4 text-sm font-medium transition",
                        serviceCountry === country
                          ? "border-cyan-300/50 bg-cyan-400 text-slate-950"
                          : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10",
                      ].join(" ")}
                    >
                      {country === "CL" ? "Chile" : "Uruguay"}
                    </button>
                  ))}
                </div>
              </div>

              {serviceWarning ? <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{serviceWarning}</div> : null}
              {serviceError ? <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{serviceError}</div> : null}

              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Bloque de apertura / estático</label>
                  <textarea
                    value={serviceContent.openingText}
                    onChange={(e) => setServiceContent((prev) => ({ ...prev, openingText: e.target.value }))}
                    rows={16}
                    className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Conocimiento IA libre</label>
                  <textarea
                    value={serviceContent.knowledgeText}
                    onChange={(e) => setServiceContent((prev) => ({ ...prev, knowledgeText: e.target.value }))}
                    rows={16}
                    className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSaveServiceContent}
                  disabled={serviceLoading || serviceSaving}
                  className="inline-flex h-11 items-center rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {serviceSaving ? "Guardando..." : "Guardar configuración de Servicio Técnico"}
                </button>
                <button
                  type="button"
                  onClick={handleImportServiceKnowledgeFromText}
                  disabled={serviceLoading || serviceKnowledgeImporting || !serviceContent.knowledgeText.trim()}
                  className="inline-flex h-11 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {serviceKnowledgeImporting ? "Importando..." : "Importar texto libre a conocimiento estructurado"}
                </button>
                <div className="text-xs text-zinc-500">Aquí gestionas el bloque estático y una base libre de conocimiento complementario.</div>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                <div className="text-sm font-semibold text-white">Agregar conocimiento técnico</div>
                <div className="mt-4 space-y-3">
                  <input
                    value={newServiceKnowledge.tema}
                    onChange={(e) => setNewServiceKnowledge((prev) => ({ ...prev, tema: e.target.value }))}
                    placeholder="Tema"
                    className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-cyan-400/40"
                  />
                  <input
                    value={newServiceKnowledge.keywordsText}
                    onChange={(e) => setNewServiceKnowledge((prev) => ({ ...prev, keywordsText: e.target.value }))}
                    placeholder="Keywords separadas por coma"
                    className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-cyan-400/40"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="number"
                      value={newServiceKnowledge.prioridad}
                      onChange={(e) => setNewServiceKnowledge((prev) => ({ ...prev, prioridad: Number(e.target.value || "100") || 100 }))}
                      placeholder="Prioridad"
                      className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-cyan-400/40"
                    />
                    <label className="flex h-11 items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-200">
                      <input
                        type="checkbox"
                        checked={newServiceKnowledge.activo}
                        onChange={(e) => setNewServiceKnowledge((prev) => ({ ...prev, activo: e.target.checked }))}
                      />
                      Activo
                    </label>
                  </div>
                  <textarea
                    value={newServiceKnowledge.informacion}
                    onChange={(e) => setNewServiceKnowledge((prev) => ({ ...prev, informacion: e.target.value }))}
                    rows={8}
                    placeholder="Información técnica"
                    className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-cyan-400/40"
                  />
                  <button
                    type="button"
                    onClick={handleCreateServiceKnowledge}
                    disabled={serviceKnowledgeSavingId === "new"}
                    className="inline-flex h-11 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {serviceKnowledgeSavingId === "new" ? "Creando..." : "Crear conocimiento"}
                  </button>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                <div className="text-sm font-semibold text-white">Conocimiento estructurado existente</div>
                <div className="mt-4 space-y-4">
                  {serviceKnowledgeLoading ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-zinc-400">Cargando conocimiento técnico...</div>
                  ) : serviceKnowledgeRows.length ? (
                    serviceKnowledgeRows.map((row) => {
                      const draft = serviceKnowledgeDrafts[row.id] ?? {
                        tema: row.tema,
                        keywordsText: row.keywordsText,
                        informacion: row.informacion,
                        prioridad: row.prioridad,
                        activo: row.activo,
                      };
                      const isSaving = serviceKnowledgeSavingId === row.id;
                      const readOnly = row.source !== "database";
                      return (
                        <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">ID {row.id}</span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-300">
                              {row.source === "database" ? "Base de datos" : "Legacy fallback"}
                            </span>
                          </div>
                          <div className="space-y-3">
                            <input
                              value={draft.tema}
                              onChange={(e) =>
                                setServiceKnowledgeDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { ...draft, tema: e.target.value },
                                }))
                              }
                              readOnly={readOnly}
                              className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none read-only:opacity-70 focus:border-cyan-400/40"
                            />
                            <input
                              value={draft.keywordsText}
                              onChange={(e) =>
                                setServiceKnowledgeDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { ...draft, keywordsText: e.target.value },
                                }))
                              }
                              readOnly={readOnly}
                              className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none read-only:opacity-70 focus:border-cyan-400/40"
                            />
                            <div className="grid gap-3 sm:grid-cols-2">
                              <input
                                type="number"
                                value={draft.prioridad}
                                onChange={(e) =>
                                  setServiceKnowledgeDrafts((prev) => ({
                                    ...prev,
                                    [row.id]: { ...draft, prioridad: Number(e.target.value || "100") || 100 },
                                  }))
                                }
                                readOnly={readOnly}
                                className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none read-only:opacity-70 focus:border-cyan-400/40"
                              />
                              <label className="flex h-11 items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-200">
                                <input
                                  type="checkbox"
                                  checked={draft.activo}
                                  onChange={(e) =>
                                    setServiceKnowledgeDrafts((prev) => ({
                                      ...prev,
                                      [row.id]: { ...draft, activo: e.target.checked },
                                    }))
                                  }
                                  disabled={readOnly}
                                />
                                Activo
                              </label>
                            </div>
                            <textarea
                              value={draft.informacion}
                              onChange={(e) =>
                                setServiceKnowledgeDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { ...draft, informacion: e.target.value },
                                }))
                              }
                              readOnly={readOnly}
                              rows={7}
                              className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none read-only:opacity-70 focus:border-cyan-400/40"
                            />
                            <div className="flex flex-wrap gap-3">
                              <button
                                type="button"
                                onClick={() => void handleSaveServiceKnowledge(row.id)}
                                disabled={readOnly || isSaving}
                                className="inline-flex h-10 items-center rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isSaving ? "Guardando..." : "Guardar"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteServiceKnowledge(row.id)}
                                disabled={readOnly || isSaving}
                                className="inline-flex h-10 items-center rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-zinc-400">
                      No hay conocimiento estructurado cargado para este país todavía.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
