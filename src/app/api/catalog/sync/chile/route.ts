import crypto from "crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type JsonRecord = Record<string, unknown>;

type StagingRow = {
  "ID": string;
  "Tipo": string;
  "SKU": string;
  "GTIN, UPC, EAN o ISBN": string;
  "Nombre": string;
  "Publicado": string;
  "¿Está destacado?": string;
  "Visibilidad en el catálogo": string;
  "Descripción corta": string;
  "Descripción": string;
  "¿Existencias?": string;
  "Inventario": string;
  "¿Permitir reservas de productos agotados?": string;
  "¿Vendido individualmente?": string;
  "Precio normal": string;
  "Categorías": string;
  "Etiquetas": string;
  "Clase de envío": string;
  "Imágenes": string;
  "Posición": string;
  "Marcas": string;
  "Nombre del atributo 1": string;
  "Valor(es) del atributo 1": string;
  "Atributo visible 1": string;
  "Atributo global 1": string;
  "Nombre del atributo 2": string;
  "Valor(es) del atributo 2": string;
  "Atributo visible 2": string;
  "Atributo global 2": string;
  "Nombre del atributo 3": string;
  "Valor(es) del atributo 3": string;
  "Atributo visible 3": string;
  "Atributo global 3": string;
  "Nombre del atributo 4": string;
  "Valor(es) del atributo 4": string;
  "Atributo visible 4": string;
  "Atributo global 4": string;
  "Nombre del atributo 5": string;
  "Valor(es) del atributo 5": string;
  "Atributo visible 5": string;
  "Atributo global 5": string;
  "Nombre del atributo 6": string;
  "Valor(es) del atributo 6": string;
  "Atributo visible 6": string;
  "Atributo global 6": string;
  "Nombre del atributo 7": string;
  "Valor(es) del atributo 7": string;
  "Atributo visible 7": string;
  "Atributo global 7": string;
  "Nombre del atributo 8": string;
  "Valor(es) del atributo 8": string;
  "Atributo visible 8": string;
  "Atributo global 8": string;
};

type SyncOptions = {
  dryRun: boolean;
  pageSize: number;
};

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
}

function getWpBaseUrl() {
  return (process.env.WP_CL_BASE_URL ?? "https://www.interwins.cl").replace(/\/+$/, "");
}

function getSyncSecret() {
  return (process.env.CATALOG_SYNC_SECRET ?? "").trim();
}

function getCronSecret() {
  return (process.env.CRON_SECRET ?? "").trim();
}

function getHeaderToken(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-sync-secret")?.trim() ?? "";
}

function isAuthorized(request: Request) {
  const cronSecret = getCronSecret();
  const syncSecret = getSyncSecret();
  if (!cronSecret && !syncSecret) return process.env.NODE_ENV !== "production";
  const url = new URL(request.url);
  const provided = getHeaderToken(request) || url.searchParams.get("secret")?.trim() || "";
  return provided === cronSecret || provided === syncSecret;
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

function toArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function pickText(record: JsonRecord, key: string) {
  return toText(record[key]);
}

function buildEmptyRow(): StagingRow {
  return {
    "ID": "",
    "Tipo": "",
    "SKU": "",
    "GTIN, UPC, EAN o ISBN": "",
    "Nombre": "",
    "Publicado": "",
    "¿Está destacado?": "",
    "Visibilidad en el catálogo": "",
    "Descripción corta": "",
    "Descripción": "",
    "¿Existencias?": "",
    "Inventario": "",
    "¿Permitir reservas de productos agotados?": "",
    "¿Vendido individualmente?": "",
    "Precio normal": "",
    "Categorías": "",
    "Etiquetas": "",
    "Clase de envío": "",
    "Imágenes": "",
    "Posición": "",
    "Marcas": "",
    "Nombre del atributo 1": "",
    "Valor(es) del atributo 1": "",
    "Atributo visible 1": "",
    "Atributo global 1": "",
    "Nombre del atributo 2": "",
    "Valor(es) del atributo 2": "",
    "Atributo visible 2": "",
    "Atributo global 2": "",
    "Nombre del atributo 3": "",
    "Valor(es) del atributo 3": "",
    "Atributo visible 3": "",
    "Atributo global 3": "",
    "Nombre del atributo 4": "",
    "Valor(es) del atributo 4": "",
    "Atributo visible 4": "",
    "Atributo global 4": "",
    "Nombre del atributo 5": "",
    "Valor(es) del atributo 5": "",
    "Atributo visible 5": "",
    "Atributo global 5": "",
    "Nombre del atributo 6": "",
    "Valor(es) del atributo 6": "",
    "Atributo visible 6": "",
    "Atributo global 6": "",
    "Nombre del atributo 7": "",
    "Valor(es) del atributo 7": "",
    "Atributo visible 7": "",
    "Atributo global 7": "",
    "Nombre del atributo 8": "",
    "Valor(es) del atributo 8": "",
    "Atributo visible 8": "",
    "Atributo global 8": "",
  };
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

async function fetchWpJson(pathname: string) {
  const res = await fetch(`${getWpBaseUrl()}${pathname}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, data, error: res.ok ? "" : text };
}

function getCategoryPath(categoryId: number, categoryMap: Map<number, JsonRecord>) {
  const names: string[] = [];
  const seen = new Set<number>();
  let currentId = categoryId;

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const node = categoryMap.get(currentId);
    if (!node) break;
    const name = pickText(node, "name");
    if (name) names.unshift(name);
    const parent = Number(node.parent ?? 0);
    currentId = Number.isFinite(parent) ? parent : 0;
  }

  return names.join(" > ");
}

function getAttributeValue(attribute: JsonRecord) {
  return toArray(attribute.terms)
    .map((term) => pickText(asRecord(term), "name"))
    .filter(Boolean)
    .join(", ");
}

function applyAttributes(row: StagingRow, attributes: JsonRecord[]) {
  attributes.slice(0, 8).forEach((attribute, index) => {
    const slot = index + 1;
    row[`Nombre del atributo ${slot}` as keyof StagingRow] = pickText(attribute, "name");
    row[`Valor(es) del atributo ${slot}` as keyof StagingRow] = getAttributeValue(attribute);
    row[`Atributo visible ${slot}` as keyof StagingRow] = "1";
    row[`Atributo global ${slot}` as keyof StagingRow] = pickText(attribute, "taxonomy") ? "1" : "0";
  });
}

function normalizeMainProduct(product: JsonRecord, categoryMap: Map<number, JsonRecord>) {
  const row = buildEmptyRow();
  const prices = asRecord(product.prices);
  const categories = toArray(product.categories).map((item) => asRecord(item));
  const tags = toArray(product.tags).map((item) => asRecord(item));
  const brands = toArray(product.brands).map((item) => asRecord(item));
  const images = toArray(product.images).map((item) => asRecord(item));
  const attributes = toArray(product.attributes).map((item) => asRecord(item));

  row["ID"] = pickText(product, "id");
  row["Tipo"] = pickText(product, "type");
  row["SKU"] = pickText(product, "sku");
  row["Nombre"] = pickText(product, "name");
  row["Publicado"] = "1";
  row["¿Está destacado?"] = "0";
  row["Visibilidad en el catálogo"] = "visible";
  row["Descripción corta"] = pickText(product, "short_description");
  row["Descripción"] = pickText(product, "description");
  row["¿Existencias?"] = product.is_in_stock === false ? "0" : "1";
  row["Inventario"] = toText(product.low_stock_remaining);
  row["¿Permitir reservas de productos agotados?"] = product.is_on_backorder === true ? "1" : "0";
  row["¿Vendido individualmente?"] = product.sold_individually === true ? "1" : "0";
  row["Precio normal"] = pickText(prices, "regular_price") || pickText(prices, "price");
  row["Categorías"] = categories
    .map((category) => getCategoryPath(Number(category.id ?? 0), categoryMap) || pickText(category, "name"))
    .filter(Boolean)
    .join(", ");
  row["Etiquetas"] = tags.map((tag) => pickText(tag, "name")).filter(Boolean).join(", ");
  row["Imágenes"] = images.map((image) => pickText(image, "src")).filter(Boolean).join(", ");
  row["Marcas"] = brands.map((brand) => pickText(brand, "name")).filter(Boolean).join(", ");
  applyAttributes(row, attributes);

  return row;
}

function buildVariationAttributes(variation: JsonRecord) {
  return toArray(variation.attributes).map((item) => {
    const record = asRecord(item);
    return {
      name: pickText(record, "name"),
      terms: [{ name: pickText(record, "value") }],
      taxonomy: "",
    } as JsonRecord;
  });
}

async function normalizeVariationProduct(variationId: number, parent: JsonRecord, categoryMap: Map<number, JsonRecord>) {
  const detailRes = await fetchWpJson(`/wp-json/wc/store/products/${variationId}`);
  if (!detailRes.ok) {
    throw new Error(`No fue posible cargar la variación ${variationId}: ${detailRes.status}`);
  }

  const detail = asRecord(detailRes.data);
  const row = buildEmptyRow();
  const prices = asRecord(detail.prices);
  const categories = toArray(detail.categories).map((item) => asRecord(item));
  const tags = toArray(detail.tags).map((item) => asRecord(item));
  const brands = toArray(detail.brands).map((item) => asRecord(item));
  const images = toArray(detail.images).map((item) => asRecord(item));

  row["ID"] = pickText(detail, "id");
  row["Tipo"] = pickText(detail, "type") || "variation";
  row["SKU"] = pickText(detail, "sku") || pickText(parent, "sku");
  row["Nombre"] = [pickText(detail, "name") || pickText(parent, "name"), pickText(detail, "variation")].filter(Boolean).join(" - ");
  row["Publicado"] = "1";
  row["¿Está destacado?"] = "0";
  row["Visibilidad en el catálogo"] = "visible";
  row["Descripción corta"] = pickText(detail, "short_description");
  row["Descripción"] = pickText(detail, "description");
  row["¿Existencias?"] = detail.is_in_stock === false ? "0" : "1";
  row["Inventario"] = toText(detail.low_stock_remaining);
  row["¿Permitir reservas de productos agotados?"] = detail.is_on_backorder === true ? "1" : "0";
  row["¿Vendido individualmente?"] = detail.sold_individually === true ? "1" : "0";
  row["Precio normal"] = pickText(prices, "regular_price") || pickText(prices, "price");
  row["Categorías"] = categories
    .map((category) => getCategoryPath(Number(category.id ?? 0), categoryMap) || pickText(category, "name"))
    .filter(Boolean)
    .join(", ");
  row["Etiquetas"] = tags.map((tag) => pickText(tag, "name")).filter(Boolean).join(", ");
  row["Imágenes"] = images.map((image) => pickText(image, "src")).filter(Boolean).join(", ");
  row["Marcas"] = brands.map((brand) => pickText(brand, "name")).filter(Boolean).join(", ");
  applyAttributes(row, buildVariationAttributes(detail));

  return row;
}

async function fetchCategoryMap() {
  const categoryMap = new Map<number, JsonRecord>();
  let page = 1;
  const pageSize = 100;

  while (true) {
    const res = await fetchWpJson(`/wp-json/wc/store/products/categories?per_page=${pageSize}&page=${page}`);
    if (!res.ok) {
      throw new Error(`No fue posible cargar categorías desde WordPress: ${res.status}`);
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    for (const item of rows) {
      const record = asRecord(item);
      const id = Number(record.id ?? 0);
      if (id) categoryMap.set(id, record);
    }
    if (rows.length < pageSize) break;
    page += 1;
  }

  return categoryMap;
}

async function fetchAllChileProducts(pageSize: number) {
  const categoryMap = await fetchCategoryMap();
  const products: JsonRecord[] = [];
  let page = 1;

  while (true) {
    const res = await fetchWpJson(`/wp-json/wc/store/products?per_page=${pageSize}&page=${page}`);
    if (!res.ok) {
      throw new Error(`No fue posible cargar productos desde WordPress: ${res.status}`);
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) break;
    for (const item of rows) products.push(asRecord(item));
    if (rows.length < pageSize) break;
    page += 1;
  }

  const normalized: StagingRow[] = [];
  let variationCount = 0;

  for (const product of products) {
    normalized.push(normalizeMainProduct(product, categoryMap));
    const variations = toArray(product.variations).map((item) => asRecord(item));
    for (const variation of variations) {
      const variationId = Number(variation.id ?? 0);
      if (!variationId) continue;
      normalized.push(await normalizeVariationProduct(variationId, product, categoryMap));
      variationCount += 1;
    }
  }

  return {
    products,
    rows: normalized,
    mainCount: products.length,
    variationCount,
  };
}

async function replaceChileStaging(rows: StagingRow[]) {
  const deleteRes = await supabaseFetch("inter_products_staging", {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal",
    },
  });

  if (!deleteRes.ok) {
    throw new Error(`No fue posible limpiar inter_products_staging: ${deleteRes.status} ${deleteRes.error}`);
  }

  const batchSize = 100;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const insertRes = await supabaseFetch("inter_products_staging", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(batch),
    });

    if (!insertRes.ok) {
      throw new Error(`No fue posible insertar el lote ${offset}-${offset + batch.length}: ${insertRes.status} ${insertRes.error}`);
    }
  }
}

function toStagingRow(record: JsonRecord) {
  const row = buildEmptyRow();
  for (const key of Object.keys(row) as Array<keyof StagingRow>) {
    row[key] = toText(record[key]);
  }
  return row;
}

function sortStagingRows(rows: StagingRow[]) {
  return [...rows].sort((a, b) => {
    const left = `${a["ID"]}|${a["Tipo"]}|${a["SKU"]}|${a["Nombre"]}`;
    const right = `${b["ID"]}|${b["Tipo"]}|${b["SKU"]}|${b["Nombre"]}`;
    return left.localeCompare(right);
  });
}

function buildRowsHash(rows: StagingRow[]) {
  return crypto.createHash("sha256").update(JSON.stringify(sortStagingRows(rows))).digest("hex");
}

async function fetchCurrentChileStaging() {
  const rows: StagingRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const res = await supabaseFetch(`inter_products_staging?select=*&limit=${pageSize}&offset=${offset}`);
    if (!res.ok) {
      throw new Error(`No fue posible leer inter_products_staging: ${res.status} ${res.error}`);
    }
    const batch = Array.isArray(res.data) ? res.data : [];
    if (!batch.length) break;
    for (const item of batch) rows.push(toStagingRow(asRecord(item)));
    if (batch.length < pageSize) break;
  }

  return rows;
}

async function runSync(options: SyncOptions) {
  const startedAt = Date.now();
  const { rows, mainCount, variationCount } = await fetchAllChileProducts(options.pageSize);
  const incomingHash = buildRowsHash(rows);
  const currentRows = await fetchCurrentChileStaging();
  const currentHash = buildRowsHash(currentRows);
  const hasChanges = incomingHash !== currentHash;
  const elapsedMs = Date.now() - startedAt;
  const sample = rows.slice(0, 3).map((row) => ({
    ID: row["ID"],
    Tipo: row["Tipo"],
    SKU: row["SKU"],
    Nombre: row["Nombre"],
    Precio: row["Precio normal"],
    Categoria: row["Categorías"],
  }));

  let updated = false;
  if (!options.dryRun && hasChanges) {
    await replaceChileStaging(rows);
    updated = true;
  }

  return {
    dryRun: options.dryRun,
    source: `${getWpBaseUrl()}/wp-json/wc/store/products`,
    table: "inter_products_staging",
    mainCount,
    variationCount,
    hasChanges,
    updated,
    currentHash,
    incomingHash,
    currentRows: currentRows.length,
    totalRows: rows.length,
    elapsedMs,
    sample,
  };
}

function parseOptions(request: Request, body?: JsonRecord): SyncOptions {
  const url = new URL(request.url);
  const dryRunParam = url.searchParams.get("dryRun");
  const pageSizeParam = url.searchParams.get("pageSize");
  const dryRun =
    dryRunParam != null
      ? !["0", "false", "no"].includes(dryRunParam.toLowerCase())
      : body?.dryRun === true;
  const pageSize = Math.min(100, Math.max(1, Number(pageSizeParam ?? body?.pageSize ?? 50) || 50));
  return { dryRun, pageSize };
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const mode = (url.searchParams.get("mode") ?? "").trim().toLowerCase();
    const result = await runSync(parseOptions(request, { dryRun: mode !== "sync" }));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Error desconocido en la sincronización" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as JsonRecord;
    const result = await runSync(parseOptions(request, body));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Error desconocido en la sincronización" },
      { status: 500 },
    );
  }
}
