"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CatalogRow = {
  producto: string;
  precio: string;
  descripcion_corta: string;
  descripcion: string;
  image_url: string;
  recomendados: string;
};

type CatalogListResponse = {
  ok: boolean;
  rows: CatalogRow[];
  limit: number;
  offset: number;
  search: string;
  error?: string;
};

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function parseCsv(text: string) {
  const src = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === "") {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        const next = src[i + 1];
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushField();
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  pushField();
  pushRow();

  const header = (rows[0] ?? []).map((h) => toTrimmedString(h).toLowerCase());
  const data = rows.slice(1);
  const idx = (name: string) => header.findIndex((h) => h === name);

  const colProducto = idx("producto");
  const colPrecio = idx("precio");
  const colDescCorta = idx("descripcion_corta");
  const colDesc = idx("descripcion");
  const colImage = idx("image_url");
  const colRec = idx("recomendados");

  const parsed: CatalogRow[] = [];
  for (const r of data) {
    const producto = toTrimmedString(r[colProducto] ?? "");
    if (!producto) continue;
    parsed.push({
      producto,
      precio: toTrimmedString(r[colPrecio] ?? ""),
      descripcion_corta: toTrimmedString(r[colDescCorta] ?? ""),
      descripcion: toTrimmedString(r[colDesc] ?? ""),
      image_url: toTrimmedString(r[colImage] ?? ""),
      recomendados: toTrimmedString(r[colRec] ?? ""),
    });
  }

  return parsed;
}

function emptyRow(): CatalogRow {
  return { producto: "", precio: "", descripcion_corta: "", descripcion: "", image_url: "", recomendados: "" };
}

export default function CatalogPage() {
  const [data, setData] = useState<CatalogListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit] = useState(50);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CatalogRow>>({});
  const [newRow, setNewRow] = useState<CatalogRow>(emptyRow());
  const [importRows, setImportRows] = useState<CatalogRow[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef("");

  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  const loadCatalog = useCallback(async (next?: { offset?: number; search?: string }) => {
    setLoading(true);
    setError("");
    const o = next?.offset ?? offset;
    const q = (next?.search ?? searchRef.current).trim();
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(o));
      if (q) params.set("search", q);
      const res = await fetch(`/api/catalog/admin?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as CatalogListResponse;
      if (!res.ok || !json?.ok) {
        setError(json?.error || "No pude cargar el catálogo en este momento.");
        return;
      }
      setData(json);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [limit, offset]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog, offset]);

  const rows = data?.rows ?? [];

  const exportingUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("format", "csv");
    const q = search.trim();
    if (q) params.set("search", q);
    return `/api/catalog/admin?${params.toString()}`;
  }, [search]);

  const hasPrev = offset > 0;
  const hasNext = rows.length >= limit;

  const currentDraft = (producto: string) => drafts[producto] ?? rows.find((r) => r.producto === producto) ?? emptyRow();

  function startEdit(producto: string) {
    setEditingId(producto);
    setDrafts((prev) => ({ ...prev, [producto]: { ...currentDraft(producto) } }));
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveRow(row: CatalogRow) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/catalog/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
      const json = (await res.json()) as { ok: boolean; row?: CatalogRow; error?: string };
      if (!res.ok || !json?.ok) {
        setError(json?.error || "No pude guardar el producto.");
        return;
      }
      setEditingId(null);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.producto];
        return next;
      });
      await loadCatalog({ offset: 0 });
      setOffset(0);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function createRow() {
    const row = { ...newRow, producto: newRow.producto.trim() };
    if (!row.producto) {
      setError("Debes indicar el campo producto.");
      return;
    }
    await saveRow(row);
    setNewRow(emptyRow());
  }

  async function deleteRow(producto: string) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/catalog/admin?producto=${encodeURIComponent(producto)}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        setError(json?.error || "No pude eliminar el producto.");
        return;
      }
      setEditingId(null);
      await loadCatalog();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function importBulk() {
    if (!importRows.length) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/catalog/admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: importRows }),
      });
      const json = (await res.json()) as { ok: boolean; savedCount?: number; error?: string };
      if (!res.ok || !json?.ok) {
        setError(json?.error || "No pude importar el catálogo.");
        return;
      }
      setImportRows([]);
      if (fileRef.current) fileRef.current.value = "";
      await loadCatalog({ offset: 0 });
      setOffset(0);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top,#27272a_0%,#09090b_45%,#020617_100%)] font-sans text-zinc-50">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-8 md:px-8 lg:px-10">
        <section className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur xl:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
                <span>Panel InterWins</span>
                <span className="text-zinc-400">/</span>
                <span className="text-white">Catálogo</span>
              </div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Gestión de catálogo y precios</h1>
              <p className="max-w-2xl text-sm leading-6 text-zinc-300 md:text-base">
                Exporta, importa y edita productos del catálogo comercial (precio referencial y descripciones).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/"
                className="inline-flex h-11 items-center rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Volver al dashboard
              </a>
              <button
                type="button"
                onClick={() => loadCatalog({ offset: 0 })}
                className="h-11 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Refrescar catálogo
              </button>
              <a
                href={exportingUrl}
                className="inline-flex h-11 items-center rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                Exportar CSV
              </a>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 shadow-2xl shadow-black/10 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex w-full flex-col gap-2 lg:max-w-xl">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Buscar</label>
              <div className="flex gap-3">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 outline-none ring-0 transition focus:border-cyan-400/30"
                  placeholder="Producto, ID o texto en descripción corta"
                />
                <button
                  type="button"
                  onClick={() => {
                    setOffset(0);
                    void loadCatalog({ offset: 0, search });
                  }}
                  className="inline-flex h-11 items-center rounded-2xl bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15"
                >
                  Buscar
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={!hasPrev || loading}
                onClick={() => setOffset((o) => Math.max(0, o - limit))}
                className={[
                  "inline-flex h-11 items-center rounded-2xl border px-4 text-sm font-semibold transition",
                  !hasPrev || loading ? "border-white/5 bg-white/5 text-zinc-500" : "border-white/10 bg-white/5 text-white hover:bg-white/10",
                ].join(" ")}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={!hasNext || loading}
                onClick={() => setOffset((o) => o + limit)}
                className={[
                  "inline-flex h-11 items-center rounded-2xl border px-4 text-sm font-semibold transition",
                  !hasNext || loading ? "border-white/5 bg-white/5 text-zinc-500" : "border-white/10 bg-white/5 text-white hover:bg-white/10",
                ].join(" ")}
              >
                Siguiente
              </button>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-zinc-300">
                Página: <span className="font-semibold text-white">{Math.floor(offset / limit) + 1}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 shadow-2xl shadow-black/10 backdrop-blur">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Agregar producto</h2>
              <p className="mt-1 text-sm text-zinc-400">Crea o actualiza un producto por ID.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={newRow.producto}
                onChange={(e) => setNewRow((p) => ({ ...p, producto: e.target.value }))}
                className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                placeholder="producto (ID)"
              />
              <input
                value={newRow.precio}
                onChange={(e) => setNewRow((p) => ({ ...p, precio: e.target.value }))}
                className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                placeholder="precio (ej: 199900)"
              />
              <input
                value={newRow.image_url}
                onChange={(e) => setNewRow((p) => ({ ...p, image_url: e.target.value }))}
                className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                placeholder="image_url"
              />
              <input
                value={newRow.recomendados}
                onChange={(e) => setNewRow((p) => ({ ...p, recomendados: e.target.value }))}
                className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                placeholder="recomendados (separados por coma)"
              />
              <textarea
                value={newRow.descripcion_corta}
                onChange={(e) => setNewRow((p) => ({ ...p, descripcion_corta: e.target.value }))}
                className="min-h-[88px] rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-200 outline-none focus:border-cyan-400/30 md:col-span-2"
                placeholder="descripcion_corta"
              />
              <textarea
                value={newRow.descripcion}
                onChange={(e) => setNewRow((p) => ({ ...p, descripcion: e.target.value }))}
                className="min-h-[120px] rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-200 outline-none focus:border-cyan-400/30 md:col-span-2"
                placeholder="descripcion"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={createRow}
                className="inline-flex h-11 items-center rounded-2xl bg-cyan-400 px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-70"
              >
                Guardar producto
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setNewRow(emptyRow())}
                className="inline-flex h-11 items-center rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-70"
              >
                Limpiar
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/6 p-5 shadow-2xl shadow-black/10 backdrop-blur">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Importar CSV</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Importa filas con encabezados: producto, precio, descripcion_corta, descripcion, image_url, recomendados.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  const parsed = parseCsv(text);
                  setImportRows(parsed);
                }}
                className="block w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-200"
              />
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-zinc-300">
                  Filas: <span className="font-semibold text-white">{importRows.length}</span>
                </div>
                <button
                  type="button"
                  disabled={saving || !importRows.length}
                  onClick={importBulk}
                  className="inline-flex h-11 items-center rounded-2xl bg-white/10 px-5 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-70"
                >
                  Importar
                </button>
                <button
                  type="button"
                  disabled={saving || !importRows.length}
                  onClick={() => {
                    setImportRows([]);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="inline-flex h-11 items-center rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-70"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-black/20 shadow-2xl shadow-black/10 backdrop-blur">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="px-4 py-4 font-medium">Producto</th>
                  <th className="px-4 py-4 font-medium">Precio</th>
                  <th className="px-4 py-4 font-medium">Imagen</th>
                  <th className="px-4 py-4 font-medium">Descripción corta</th>
                  <th className="px-4 py-4 font-medium">Recomendados</th>
                  <th className="px-4 py-4 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-zinc-400">
                      Cargando catálogo...
                    </td>
                  </tr>
                ) : rows.length ? (
                  rows.map((r) => {
                    const isEditing = editingId === r.producto;
                    const draft = isEditing ? drafts[r.producto] ?? r : r;
                    return (
                      <tr key={r.producto} className="align-top">
                        <td className="px-4 py-4">
                          <div className="font-semibold text-white">{r.producto}</div>
                        </td>
                        <td className="px-4 py-4">
                          {isEditing ? (
                            <input
                              value={draft.precio}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [r.producto]: { ...(prev[r.producto] ?? r), precio: e.target.value },
                                }))
                              }
                              className="h-10 w-40 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                              placeholder="precio"
                            />
                          ) : (
                            <div className="text-zinc-200">{r.precio || "—"}</div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {isEditing ? (
                            <input
                              value={draft.image_url}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [r.producto]: { ...(prev[r.producto] ?? r), image_url: e.target.value },
                                }))
                              }
                              className="h-10 w-[360px] rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                              placeholder="image_url"
                            />
                          ) : r.image_url ? (
                            <a href={r.image_url} target="_blank" rel="noreferrer" className="text-cyan-200 hover:underline">
                              Ver
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {isEditing ? (
                            <textarea
                              value={draft.descripcion_corta}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [r.producto]: { ...(prev[r.producto] ?? r), descripcion_corta: e.target.value },
                                }))
                              }
                              className="min-h-[90px] w-[440px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                              placeholder="descripcion_corta"
                            />
                          ) : (
                            <div className="max-w-[440px] whitespace-pre-wrap text-zinc-200">{r.descripcion_corta || "—"}</div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {isEditing ? (
                            <input
                              value={draft.recomendados}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [r.producto]: { ...(prev[r.producto] ?? r), recomendados: e.target.value },
                                }))
                              }
                              className="h-10 w-[320px] rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                              placeholder="recomendados"
                            />
                          ) : (
                            <div className="max-w-[320px] break-words text-zinc-200">{r.recomendados || "—"}</div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {isEditing ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => saveRow({ ...draft, producto: r.producto })}
                                className="inline-flex h-10 items-center rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-70"
                              >
                                Guardar
                              </button>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={cancelEdit}
                                className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-70"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => deleteRow(r.producto)}
                                className="inline-flex h-10 items-center rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/15 disabled:opacity-70"
                              >
                                Eliminar
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEdit(r.producto)}
                              className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10"
                            >
                              Editar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-zinc-400">
                      No hay productos para mostrar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
