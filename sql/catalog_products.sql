-- =============================================================================
-- catalog_products — catálogo derivado y autocontenido
-- =============================================================================
--
-- QUÉ ES
--   Una tabla DERIVADA. No reemplaza ninguna fuente actual:
--
--     inter_products_staging  <- WooCommerce Chile (cron diario)
--     inter_products          <- atributos curados CL
--     inter_products_uy       <- catálogo Uruguay (plano, 22 filas)
--     catalogo_productos      <- precios CL, cargados a mano
--              |
--              v
--     catalog_products        <- ESTA TABLA. El bot solo lee de aquí.
--
--   Todo lo que hoy se resuelve en cada consulta (heredar la imagen del padre,
--   buscar el precio con ilike sobre tres columnas, reconstruir el padre
--   partiendo el nombre por " - ") queda resuelto una sola vez al ingestar.
--
-- POR QUÉ
--   Hoy "DEP250" aparece tanto como identidad de un producto como atributo de
--   compatibilidad de un accesorio, y ambos viven en la columna `nombre`:
--
--     "EQUIPO RADIO ... MOTOROLA DEP250 - Digitales, VHF"  -> DEP250 es EL producto
--     "Auricular con micrófono y PTT - DEP250, VHF"        -> DEP250 es COMPATIBILIDAD
--
--   Buscar `nombre ilike '*dep*250*'` devuelve 30 filas revueltas. Separando
--   `modelo` de `compatible_con`, la misma búsqueda devuelve 5 productos y 25
--   accesorios compatibles, cada cosa en su lugar.
-- =============================================================================

create table if not exists public.catalog_products (
  -- Identificación --------------------------------------------------------
  pais              text    not null check (pais in ('CL','UY')),
  woo_id            text    not null,
  -- CL y UY vienen de instalaciones distintas de WordPress, así que un mismo
  -- id puede repetirse entre países. La clave es compuesta por eso.
  parent_woo_id     text,
  sku               text,
  record_type       text    not null check (record_type in ('product','variation')),

  -- Nombre e identidad ----------------------------------------------------
  nombre_completo   text    not null,
  nombre_base       text    not null,   -- sin el sufijo de variante
  variante          text,               -- 'Digitales, VHF'

  -- El arreglo central: identidad separada de compatibilidad.
  modelo            text,               -- 'DEP250'. NULL en accesorios, a propósito:
                                        -- un accesorio no tiene modelo propio, y
                                        -- extraérselo genera colisiones reales
                                        -- ("Cable de Programación Equipos R7"
                                        --  competiría con el radio R7).
  modelo_key        text,               -- 'dep250' normalizado. Es el índice que
                                        -- convierte la búsqueda en match exacto.
  compatible_con    text[]  not null default '{}',  -- ['DEP250'] en el audífono

  -- Clasificación ---------------------------------------------------------
  familia           text    not null check (familia in ('equipo_radio','accesorio','camara_corporal','desconocido')),
  marca             text,
  modalidad         text    check (modalidad in ('VENTA','ARRIENDO')),
  banda             text    check (banda in ('VHF','UHF')),
  tecnologia        text    check (tecnologia in ('DIGITAL','ANALOGO')),
  portabilidad      text,
  tipo_producto     text,
  categoria_path    text,

  -- Contenido, ya heredado del padre en la ingesta ------------------------
  imagen_url        text,
  descripcion       text,
  descripcion_corta text,
  ficha_url         text,

  -- Precio, ya resuelto contra catalogo_productos -------------------------
  -- El padre en catalogo_productos trae precio nulo y son las variantes las que
  -- lo tienen, así que un producto con varias variantes queda como rango
  -- ("Desde $233.994 hasta $275.811").
  precio_min        integer check (precio_min is null or precio_min > 0),
  precio_max        integer check (precio_max is null or precio_max > 0),
  moneda            text    not null default 'CLP',
  -- Convierte la regla de negocio en un WHERE en vez de una cadena de fallbacks:
  --   tiene precio                -> muestra el precio
  --   sin precio + se arrienda    -> deriva a arriendo, explicando el porqué
  --   sin precio + no se arrienda -> deriva a cotización de venta
  tiene_precio      boolean not null default false,

  -- Estado ----------------------------------------------------------------
  en_stock          boolean not null default true,
  -- Lo que deja de venir de Woo se marca inactivo en vez de borrarse: si un
  -- cliente está conversando sobre un producto justo cuando corre el sync, no
  -- se le rompe la conversación.
  activo            boolean not null default true,
  synced_at         timestamptz not null default now(),

  constraint catalog_products_pk primary key (pais, woo_id),
  constraint catalog_products_rango_valido check (precio_max is null or precio_min is null or precio_max >= precio_min),
  -- tiene_precio y las columnas de precio no pueden contradecirse.
  constraint catalog_products_precio_coherente check (
    (tiene_precio = false and precio_min is null and precio_max is null)
    or (tiene_precio = true and precio_min is not null)
  )
);

-- Índices ------------------------------------------------------------------

-- EL índice: buscar un modelo pasa de recorrer nombres con ilike a match exacto.
create index if not exists catalog_products_modelo_key_idx
  on public.catalog_products (pais, modelo_key) where modelo_key is not null;

-- Para "qué accesorios sirven para el DEP250".
create index if not exists catalog_products_compatible_idx
  on public.catalog_products using gin (compatible_con);

-- Para la navegación por menú (familia + modalidad + filtros).
create index if not exists catalog_products_navegacion_idx
  on public.catalog_products (pais, familia, modalidad, activo);

-- Para agrupar las variantes de un producto padre.
create index if not exists catalog_products_parent_idx
  on public.catalog_products (pais, parent_woo_id) where parent_woo_id is not null;

-- Respaldo por nombre, para cuando el usuario escribe algo que no es un modelo.
-- Requiere pg_trgm (Supabase lo trae disponible).
create extension if not exists pg_trgm;
create index if not exists catalog_products_nombre_trgm_idx
  on public.catalog_products using gin (nombre_completo gin_trgm_ops);

-- Seguridad ----------------------------------------------------------------
-- El bot escribe con la service role key (salta RLS). Se deja lectura pública
-- para mantener el mismo comportamiento que las tablas actuales, que ya son
-- legibles con la anon key. Si prefieres cerrarla, borra esta policy: el bot
-- seguirá funcionando porque escribe y lee con service role.
alter table public.catalog_products enable row level security;

drop policy if exists catalog_products_lectura on public.catalog_products;
create policy catalog_products_lectura
  on public.catalog_products for select
  using (true);

-- Documentación en la propia base ------------------------------------------
comment on table public.catalog_products is
  'Catálogo derivado de WooCommerce + atributos curados + precios manuales. Se regenera con el cron; no editar a mano.';
comment on column public.catalog_products.modelo is
  'Identidad del producto (DEP250). NULL en accesorios a propósito: se identifican por compatible_con.';
comment on column public.catalog_products.compatible_con is
  'Modelos con los que un accesorio es compatible. Separado de modelo para que el audífono no compita con el radio.';
comment on column public.catalog_products.tiene_precio is
  'False cuando no hay precio en catalogo_productos. Dispara la derivación a arriendo o a cotización.';
comment on column public.catalog_products.activo is
  'False cuando el producto dejó de venir de Woo. No se borra, para no romper conversaciones en curso.';
