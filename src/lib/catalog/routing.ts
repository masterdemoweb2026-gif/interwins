/**
 * Decide qué hace el bot con un producto según su precio y su disponibilidad.
 *
 * Regla de negocio acordada:
 *
 *   1. Tiene precio                  -> muestra el precio y sigue a cotización de venta.
 *                                       Si además se arrienda, el arriendo NO se ofrece
 *                                       solo: aparece únicamente si el cliente lo pide.
 *   2. Sin precio + se arrienda      -> deriva al flujo de ARRIENDO, explicando el porqué.
 *   3. Sin precio + no se arrienda   -> ficha + "se cotiza caso a caso" + formulario de venta.
 *
 * La regla 3 es la red de seguridad: cualquier producto que quede sin precio en
 * `catalogo_productos` sigue capturando el lead en vez de morir en un
 * "precio por confirmar" sin salida.
 */

export type Disponibilidad = {
  venta: boolean;
  arriendo: boolean;
};

/** Rango de precios armado desde las variantes de `catalogo_productos`. */
export type RangoPrecio = { min: number; max: number };

export type IntencionCompra = "cotizacion" | "arriendo" | undefined;

export type Ruta =
  | { accion: "mostrar_precio"; precioTexto: string; motivo: string; ofreceArriendo: boolean }
  | { accion: "derivar_arriendo"; motivo: string }
  | { accion: "derivar_cotizacion"; motivo: string };

export function formatearCLP(monto: number) {
  return `$${Math.round(monto).toLocaleString("es-CL")}`;
}

/**
 * Texto de precio. El padre en `catalogo_productos` no trae precio; lo traen sus
 * variantes, así que un producto con varias variantes se expresa como rango.
 */
export function formatearPrecio(rango: RangoPrecio | null) {
  if (!rango) return "";
  const { min, max } = rango;
  if (!Number.isFinite(min) || min <= 0) return "";
  if (max > min) return `Desde ${formatearCLP(min)} hasta ${formatearCLP(max)}`;
  return formatearCLP(min);
}

/**
 * Piso de plausibilidad para un precio.
 *
 * El catálogo de Uruguay trae `precio = 1` en 15 de sus 22 filas: es un
 * placeholder de WooCommerce, no un precio. Sin este filtro el bot le diría a
 * un cliente que una batería Impres cuesta $1. El accesorio real más barato
 * observado ronda los $12.000, así que el umbral no descarta nada legítimo.
 */
export const PRECIO_MINIMO_PLAUSIBLE = 100;

/** Construye el rango a partir de los precios de las variantes. */
export function construirRango(preciosVariantes: number[]): RangoPrecio | null {
  const validos = preciosVariantes.filter((n) => Number.isFinite(n) && n >= PRECIO_MINIMO_PLAUSIBLE);
  if (!validos.length) return null;
  return { min: Math.min(...validos), max: Math.max(...validos) };
}

export function decidirRuta(args: {
  nombreProducto: string;
  precio: RangoPrecio | null;
  disponibilidad: Disponibilidad;
  intencion: IntencionCompra;
}): Ruta {
  const { nombreProducto, precio, disponibilidad, intencion } = args;

  // El cliente pidió arriendo explícitamente y el producto se arrienda:
  // se respeta la intención aunque exista precio de venta.
  if (intencion === "arriendo" && disponibilidad.arriendo) {
    return {
      accion: "derivar_arriendo",
      motivo: `Perfecto, el ${nombreProducto} está disponible en arriendo.`,
    };
  }

  if (precio) {
    return {
      accion: "mostrar_precio",
      precioTexto: formatearPrecio(precio),
      motivo: "",
      // Acordado: no se ofrece el arriendo por iniciativa propia.
      ofreceArriendo: false,
    };
  }

  if (disponibilidad.arriendo) {
    return {
      accion: "derivar_arriendo",
      motivo: disponibilidad.venta
        ? `El ${nombreProducto} lo manejamos principalmente en modalidad de arriendo, así que te puedo ayudar por esa vía.`
        : `El ${nombreProducto} está disponible solo en modalidad de arriendo.`,
    };
  }

  return {
    accion: "derivar_cotizacion",
    motivo: `El ${nombreProducto} se cotiza caso a caso según configuración y cantidad, así que el precio te lo confirma un ejecutivo.`,
  };
}
