-- =============================================================================
-- Migración: columna `bandas`
-- =============================================================================
--
-- POR QUÉ
--   `banda` (singular) guarda una sola banda y queda en NULL cuando la fuente no
--   es unívoca. El problema es que ese NULL termina significando tres cosas
--   distintas, que al filtrar deben comportarse de forma OPUESTA:
--
--     R5      -> Frecuencia = "UHF, VHF"  -> cubre AMBAS  -> debe salir en las dos
--     TLK100  -> Frecuencia = "4G / LTE"  -> no le aplica -> no debe salir en ninguna
--     otros   -> sin dato                 -> desconocido
--
--   Con todo colapsado a NULL no se puede distinguir: incluir los NULL mete el
--   TLK100 (que es LTE) en una búsqueda de VHF, y excluirlos pierde el R5.
--
--   Se nota solo en productos SIN variaciones, porque cuando hay variaciones son
--   ellas las que llevan la banda concreta y el filtro las encuentra igual.
--
--   `banda` se conserva para mostrar; `bandas` es la que se consulta.
-- =============================================================================

alter table public.catalog_products
  add column if not exists bandas text[] not null default '{}';

-- Contención por índice: filtrar "cubre VHF" sobre el arreglo.
create index if not exists catalog_products_bandas_idx
  on public.catalog_products using gin (bandas);

comment on column public.catalog_products.bandas is
  'Todas las bandas que cubre el producto. Vacío cuando no aplica (LTE) o se desconoce. Se consulta esta columna, no `banda`.';
