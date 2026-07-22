-- =============================================================================
-- Desglose geográfico de `punto_venta`
-- =============================================================================
--
-- PROBLEMA
--   La ubicación vive enterrada en el texto de la dirección:
--
--     "MIGUEL CLARO #575 PROVIDENCIA"   -> la comuna está al final, sin columna
--     categoria = "ZONA CENTRO"          -> lo único consultable hoy
--
--   Por eso un cliente que escribe "Santiago" o "Región Metropolitana" recibe
--   "no encontré puntos de venta", aunque haya nueve en esa ciudad: nada en la
--   fila dice que Providencia pertenece a Santiago.
--
-- SOLUCIÓN
--   Tres columnas derivadas de la dirección, más una versión sin tildes para
--   que "Ñuñoa" y "nunoa" sean lo mismo (ilike no pliega acentos, y en WhatsApp
--   casi nadie los escribe).
--
--   Las columnas se llenan desde el código (`src/lib/geo/chile.ts`), que conoce
--   la relación comuna -> región -> zona. Verificado: extrae la comuna de las
--   27 direcciones actuales sin fallos, y la zona que deduce coincide con la
--   que ya estaba declarada en `categoria` en los 27 casos.
-- =============================================================================

alter table public.punto_venta
  add column if not exists comuna       text,
  add column if not exists region       text,
  add column if not exists zona         text,
  -- Clave de búsqueda: comuna + región + zona + dirección, sin tildes y en
  -- minúsculas. Permite resolver la consulta con un solo ilike.
  add column if not exists busqueda_key text;

create index if not exists punto_venta_comuna_idx on public.punto_venta (comuna);
create index if not exists punto_venta_region_idx on public.punto_venta (region);
create index if not exists punto_venta_zona_idx   on public.punto_venta (zona);

-- Búsqueda difusa sobre la clave normalizada, para tolerar errores de tipeo.
create extension if not exists pg_trgm;
create index if not exists punto_venta_busqueda_trgm_idx
  on public.punto_venta using gin (busqueda_key gin_trgm_ops);

comment on column public.punto_venta.comuna is
  'Comuna extraída de la dirección. La llena /api/catalog/geo-sync; no editar a mano.';
comment on column public.punto_venta.region is
  'Región derivada de la comuna. Permite responder "Santiago" o "Región Metropolitana".';
comment on column public.punto_venta.zona is
  'NORTE | CENTRO | SUR. Derivada de la comuna; coincide con la categoría declarada.';
comment on column public.punto_venta.busqueda_key is
  'comuna + región + zona + dirección, sin tildes y en minúsculas. Se consulta esta columna.';

-- =============================================================================
-- `dealers` ya trae region y comuna, pero con formatos heterogéneos
-- ("RM Región Metropolitana", "VIII Region del Bío Bío", y algunas filas con la
-- comuna puesta en el campo región). Se agregan las mismas columnas
-- normalizadas para poder consultar ambas tablas de la misma forma.
-- =============================================================================

alter table public.dealers
  add column if not exists comuna_norm  text,
  add column if not exists region_norm  text,
  add column if not exists zona         text,
  add column if not exists busqueda_key text;

create index if not exists dealers_comuna_norm_idx on public.dealers (comuna_norm);
create index if not exists dealers_region_norm_idx on public.dealers (region_norm);
create index if not exists dealers_zona_idx        on public.dealers (zona);
create index if not exists dealers_busqueda_trgm_idx
  on public.dealers using gin (busqueda_key gin_trgm_ops);
