"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CatalogRow = {
  id: string;
  producto: string;
  nombre_modelo_especial: string;
  precio_lista_clp: string;
  precio_lista_raw: string;
  modelo: string;
  record_type: string;
  tier: string;
  descripcion: string;
  caracteristicas: string;
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

function sanitizeDigits(value: string) {
  return String(value ?? "").replace(/[^\d]/g, "");
}

function sanitizePriceRaw(value: string) {
  return String(value ?? "").replace(/[^\d\s.,$]/g, "");
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

  const colId = idx("id");
  const colProducto = idx("producto");
  const colNombreEspecial = idx("nombre_modelo_especial");
  const colPrecioClp = idx("precio_lista_clp");
  const colPrecioRaw = idx("precio_lista_raw");
  const colModelo = idx("modelo");
  const colRecordType = idx("record_type");
  const colTier = idx("tier");
  const colDesc = idx("descripcion");
  const colCaract = idx("caracteristicas");
  const colRec = idx("recomendados");

  const parsed: CatalogRow[] = [];
  for (const r of data) {
    const producto = toTrimmedString(r[colProducto] ?? "");
    if (!producto) continue;
    parsed.push({
      id: toTrimmedString(r[colId] ?? ""),
      producto,
      nombre_modelo_especial: toTrimmedString(r[colNombreEspecial] ?? ""),
      precio_lista_clp: toTrimmedString(r[colPrecioClp] ?? ""),
      precio_lista_raw: toTrimmedString(r[colPrecioRaw] ?? ""),
      modelo: toTrimmedString(r[colModelo] ?? ""),
      record_type: toTrimmedString(r[colRecordType] ?? ""),
      tier: toTrimmedString(r[colTier] ?? ""),
      descripcion: toTrimmedString(r[colDesc] ?? ""),
      caracteristicas: toTrimmedString(r[colCaract] ?? ""),
      recomendados: toTrimmedString(r[colRec] ?? ""),
    });
  }

  return parsed;
}

function emptyRow(): CatalogRow {
  return {
    id: "",
    producto: "",
    nombre_modelo_especial: "",
    precio_lista_clp: "",
    precio_lista_raw: "",
    modelo: "",
    record_type: "",
    tier: "",
    descripcion: "",
    caracteristicas: "",
    recomendados: "",
  };
}

export default function CatalogPage() {
  const [data, setData] = useState<CatalogListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 10;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CatalogRow>>({});
  const [readingId, setReadingId] = useState<string | null>(null);
  const [priceEdits, setPriceEdits] = useState<Record<string, { precio_lista_clp: string; precio_lista_raw: string; dirty: boolean }>>(
    {},
  );
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
      setPriceEdits((prev) => {
        const nextEdits: Record<string, { precio_lista_clp: string; precio_lista_raw: string; dirty: boolean }> = { ...prev };
        for (const r of json.rows ?? []) {
          const current = nextEdits[r.id];
          if (current?.dirty) continue;
          nextEdits[r.id] = { precio_lista_clp: r.precio_lista_clp ?? "", precio_lista_raw: r.precio_lista_raw ?? "", dirty: false };
        }
        return nextEdits;
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [offset]);

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

  const currentDraft = (id: string) => drafts[id] ?? rows.find((r) => r.id === id) ?? emptyRow();

  function startEdit(id: string) {
    setEditingId(id);
    setDrafts((prev) => ({ ...prev, [id]: { ...currentDraft(id) } }));
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function closeReading() {
    setReadingId(null);
  }

  function getPriceEdit(id: string, fallback: CatalogRow) {
    return priceEdits[id] ?? { precio_lista_clp: fallback.precio_lista_clp ?? "", precio_lista_raw: fallback.precio_lista_raw ?? "", dirty: false };
  }

  function setPriceEditValue(id: string, patch: Partial<{ precio_lista_clp: string; precio_lista_raw: string }>) {
    setPriceEdits((prev) => {
      const cur = prev[id] ?? { precio_lista_clp: "", precio_lista_raw: "", dirty: false };
      const next = { ...cur, ...patch };
      if (patch.precio_lista_clp != null) next.precio_lista_clp = sanitizeDigits(next.precio_lista_clp);
      if (patch.precio_lista_raw != null) next.precio_lista_raw = sanitizePriceRaw(next.precio_lista_raw);
      return { ...prev, [id]: { ...next, dirty: true } };
    });
  }

  async function savePrices(id: string) {
    const base = rows.find((r) => r.id === id);
    if (!base) return;
    const edit = getPriceEdit(id, base);
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/catalog/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, precio_lista_clp: edit.precio_lista_clp, precio_lista_raw: edit.precio_lista_raw }),
      });
      const json = (await res.json()) as { ok: boolean; row?: CatalogRow; error?: string };
      if (!res.ok || !json?.ok) {
        setError(json?.error || "No pude actualizar los precios.");
        return;
      }
      setPriceEdits((prev) => ({ ...prev, [id]: { precio_lista_clp: edit.precio_lista_clp, precio_lista_raw: edit.precio_lista_raw, dirty: false } }));
      await loadCatalog();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveRow(row: CatalogRow) {
    setSaving(true);
    setError("");
    try {
      const base = rows.find((r) => r.id === row.id);
      const price = base ? getPriceEdit(row.id, base) : null;
      const payload = price ? { ...row, precio_lista_clp: price.precio_lista_clp, precio_lista_raw: price.precio_lista_raw } : row;
      const res = await fetch("/api/catalog/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok: boolean; row?: CatalogRow; error?: string };
      if (!res.ok || !json?.ok) {
        setError(json?.error || "No pude guardar el producto.");
        return;
      }
      setEditingId(null);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
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

  async function deleteRow(id: string) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/catalog/admin?id=${encodeURIComponent(id)}`, { method: "DELETE" });
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
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-5 py-8 md:px-8 lg:px-10">
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
              <p className="mt-1 text-sm text-zinc-400">Crea un registro nuevo en catalogo_productos (precio referencial).</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={newRow.producto}
                onChange={(e) => setNewRow((p) => ({ ...p, producto: e.target.value }))}
                className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                placeholder="producto (ej: VX-80, DEP250)"
              />
              <input
                value={newRow.precio_lista_clp}
                onChange={(e) => setNewRow((p) => ({ ...p, precio_lista_clp: sanitizeDigits(e.target.value) }))}
                className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                placeholder="precio_lista_clp (ej: 199900)"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
              />
              <input
                value={newRow.precio_lista_raw}
                onChange={(e) => setNewRow((p) => ({ ...p, precio_lista_raw: sanitizePriceRaw(e.target.value) }))}
                className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                placeholder='precio_lista_raw (ej: "$ 126.339")'
                inputMode="numeric"
                pattern="[0-9\\s.,$]*"
              />
              <input
                value={newRow.recomendados}
                onChange={(e) => setNewRow((p) => ({ ...p, recomendados: e.target.value }))}
                className="h-11 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                placeholder="recomendados (separados por coma)"
              />
              <textarea
                value={newRow.caracteristicas}
                onChange={(e) => setNewRow((p) => ({ ...p, caracteristicas: e.target.value }))}
                className="min-h-[88px] rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-200 outline-none focus:border-cyan-400/30 md:col-span-2"
                placeholder="caracteristicas"
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
                Importa filas con encabezados: id, producto, nombre_modelo_especial, precio_lista_clp, precio_lista_raw, modelo, record_type, tier,
                descripcion, caracteristicas, recomendados.
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
            <table className="min-w-[1720px] w-full text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="sticky left-0 z-30 bg-zinc-950 px-4 py-4 font-medium">ID</th>
                  <th className="px-4 py-4 font-medium">Producto</th>
                  <th className="px-4 py-4 font-medium">Modelo</th>
                  <th className="px-4 py-4 font-medium">Tier</th>
                  <th className="px-4 py-4 font-medium">Tipo</th>
                  <th className="px-4 py-4 font-medium">Precio CLP</th>
                  <th className="px-4 py-4 font-medium">Precio raw</th>
                  <th className="px-4 py-4 font-medium">Descripción</th>
                  <th className="px-4 py-4 font-medium">Recomendados</th>
                  <th className="sticky right-0 z-30 bg-zinc-950 px-4 py-4 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-zinc-400">
                      Cargando catálogo...
                    </td>
                  </tr>
                ) : rows.length ? (
                  rows.map((r) => {
                    const price = getPriceEdit(r.id, r);
                    const shownDescription = (r.descripcion ?? "").trim();
                    const shortDescription =
                      shownDescription.length > 140 ? `${shownDescription.slice(0, 140).trim()}...` : shownDescription;
                    return (
                      <tr key={r.id} className="align-top">
                        <td className="sticky left-0 z-20 bg-zinc-950 px-4 py-4">
                          <div className="text-zinc-300">{r.id}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-semibold text-white">{r.producto}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-zinc-200">{r.modelo || r.nombre_modelo_especial || "—"}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-zinc-200">{r.tier || "—"}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-zinc-200">{r.record_type || "—"}</div>
                        </td>
                        <td className="px-4 py-4">
                          <input
                            value={price.precio_lista_clp}
                            onChange={(e) => setPriceEditValue(r.id, { precio_lista_clp: e.target.value })}
                            className="h-10 w-28 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                            placeholder="precio_lista_clp"
                            disabled={saving}
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <input
                            value={price.precio_lista_raw}
                            onChange={(e) => setPriceEditValue(r.id, { precio_lista_raw: e.target.value })}
                            className="h-10 w-[160px] rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                            placeholder="precio_lista_raw"
                            disabled={saving}
                            inputMode="numeric"
                            pattern="[0-9\\s.,$]*"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <div className="w-[360px] space-y-2">
                            {shownDescription ? (
                              <>
                                <div className="whitespace-pre-wrap text-zinc-200">{shortDescription}</div>
                                {shownDescription.length > 140 ? (
                                  <button
                                    type="button"
                                    onClick={() => setReadingId(r.id)}
                                    className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/10"
                                  >
                                    Leer más
                                  </button>
                                ) : null}
                              </>
                            ) : (
                              <div className="text-zinc-400">—</div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="max-w-[320px] break-words text-zinc-200">{r.recomendados || "—"}</div>
                        </td>
                        <td className="sticky right-0 z-20 bg-zinc-950 px-4 py-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={saving || !price.dirty}
                              onClick={() => savePrices(r.id)}
                              className={[
                                "inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold transition",
                                saving || !price.dirty
                                  ? "border border-white/10 bg-white/5 text-zinc-500"
                                  : "bg-cyan-400 text-slate-950 hover:bg-cyan-300",
                              ].join(" ")}
                            >
                              Guardar precios
                            </button>
                            <button
                              type="button"
                              onClick={() => startEdit(r.id)}
                              className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10"
                            >
                              Editar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-zinc-400">
                      No hay productos para mostrar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {readingId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeReading();
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-white/5 px-6 py-5">
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Detalle</div>
                <div className="text-lg font-semibold text-white">
                  {rows.find((r) => r.id === readingId)?.producto || readingId}
                </div>
              </div>
              <button
                type="button"
                onClick={closeReading}
                className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Cerrar
              </button>
            </div>
            <div className="max-h-[72vh] overflow-y-auto px-6 py-5">
              {(() => {
                const row = rows.find((r) => r.id === readingId);
                if (!row) return <div className="text-zinc-400">No pude cargar el detalle.</div>;
                return (
                  <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Modelo</div>
                        <div className="mt-1 text-sm font-semibold text-white">{row.modelo || row.nombre_modelo_especial || "—"}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Tipo</div>
                        <div className="mt-1 text-sm font-semibold text-white">{row.record_type || "—"}</div>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Precio CLP</div>
                        <div className="mt-1 text-sm font-semibold text-white">{row.precio_lista_clp || "—"}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Precio raw</div>
                        <div className="mt-1 text-sm font-semibold text-white">{row.precio_lista_raw || "—"}</div>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Tier</div>
                        <div className="mt-1 text-sm font-semibold text-white">{row.tier || "—"}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Recomendados</div>
                        <div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-white">{row.recomendados || "—"}</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Características</div>
                      <div className="whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-zinc-200">
                        {(row.caracteristicas ?? "").trim() || "—"}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Descripción</div>
                      <div className="whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-zinc-200">
                        {(row.descripcion ?? "").trim() || "—"}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      ) : null}

      {editingId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cancelEdit();
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-white/5 px-6 py-5">
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Editar producto</div>
                <div className="text-lg font-semibold text-white">
                  {drafts[editingId]?.producto || rows.find((r) => r.id === editingId)?.producto || editingId}
                </div>
              </div>
              <button
                type="button"
                onClick={cancelEdit}
                className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Cerrar
              </button>
            </div>

            <div className="max-h-[72vh] overflow-y-auto px-6 py-5">
              {(() => {
                const base = rows.find((r) => r.id === editingId) ?? emptyRow();
                const draft = drafts[editingId] ?? base;
                const price = getPriceEdit(editingId, base);
                return (
                  <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">ID</div>
                        <div className="mt-1 text-sm font-semibold text-white">{editingId}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Producto</div>
                        <div className="mt-1 text-sm font-semibold text-white">{draft.producto || "—"}</div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Precio CLP</div>
                        <input
                          value={price.precio_lista_clp}
                          onChange={(e) => setPriceEditValue(editingId, { precio_lista_clp: e.target.value })}
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                          placeholder="precio_lista_clp"
                          disabled={saving}
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Precio raw</div>
                        <input
                          value={price.precio_lista_raw}
                          onChange={(e) => setPriceEditValue(editingId, { precio_lista_raw: e.target.value })}
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                          placeholder="precio_lista_raw"
                          disabled={saving}
                          inputMode="numeric"
                          pattern="[0-9\\s.,$]*"
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Modelo</div>
                        <input
                          value={draft.modelo}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [editingId]: { ...(prev[editingId] ?? base), modelo: e.target.value } }))
                          }
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                          placeholder="modelo"
                          disabled={saving}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Nombre modelo especial</div>
                        <input
                          value={draft.nombre_modelo_especial}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [editingId]: { ...(prev[editingId] ?? base), nombre_modelo_especial: e.target.value },
                            }))
                          }
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                          placeholder="nombre_modelo_especial"
                          disabled={saving}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Record type</div>
                        <input
                          value={draft.record_type}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [editingId]: { ...(prev[editingId] ?? base), record_type: e.target.value },
                            }))
                          }
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                          placeholder="record_type"
                          disabled={saving}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Tier</div>
                        <input
                          value={draft.tier}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [editingId]: { ...(prev[editingId] ?? base), tier: e.target.value } }))
                          }
                          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                          placeholder="tier"
                          disabled={saving}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Características</div>
                      <textarea
                        value={draft.caracteristicas}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [editingId]: { ...(prev[editingId] ?? base), caracteristicas: e.target.value },
                          }))
                        }
                        className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                        placeholder="caracteristicas"
                        disabled={saving}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Descripción</div>
                      <textarea
                        value={draft.descripcion}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [editingId]: { ...(prev[editingId] ?? base), descripcion: e.target.value } }))
                        }
                        className="min-h-[160px] w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                        placeholder="descripcion"
                        disabled={saving}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Recomendados</div>
                      <input
                        value={draft.recomendados}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [editingId]: { ...(prev[editingId] ?? base), recomendados: e.target.value },
                          }))
                        }
                        className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-400/30"
                        placeholder="recomendados"
                        disabled={saving}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-white/5 px-6 py-5">
              <button
                type="button"
                disabled={saving}
                onClick={() => editingId && deleteRow(editingId)}
                className="inline-flex h-11 items-center rounded-2xl border border-rose-400/30 bg-rose-400/10 px-5 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/15 disabled:opacity-70"
              >
                Eliminar
              </button>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={cancelEdit}
                  className="inline-flex h-11 items-center rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-70"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    if (!editingId) return;
                    const base = rows.find((r) => r.id === editingId) ?? emptyRow();
                    const draft = drafts[editingId] ?? base;
                    void saveRow({ ...draft, id: editingId, producto: base.producto || draft.producto });
                  }}
                  className="inline-flex h-11 items-center rounded-2xl bg-cyan-400 px-6 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-70"
                >
                  Guardar cambios
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
