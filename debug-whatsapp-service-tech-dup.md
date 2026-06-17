# [OPEN] Debug Session: whatsapp-service-tech-dup

## Sintoma
- En la rama `servicio_tecnico`, una sola consulta del usuario termina generando 2 o 3 respuestas.

## Esperado
- Un mensaje entrante del usuario debe producir una sola respuesta saliente.

## Hipotesis
1. El mismo webhook entra mas de una vez por el mismo mensaje y la deduplicacion actual no lo bloquea.
2. Dentro de `POST`, el flujo de control de `servicio_tecnico` asigna `reply` mas de una vez para el mismo `inboundText`.
3. `handleServicioTecnico()` se invoca una vez desde el enrutamiento principal y otra desde una rama secundaria para el mismo estado.
4. El proveedor o capa de envio dispara varias iteraciones sobre `messages` con contenido distinto construido durante el mismo request.
5. El cambio de estado entre `activeBranch`, `intent.branch` y `postCotizacion` deja el mensaje en una ruta ambigua que vuelve a procesar servicio tecnico.

## Evidencia
- Un solo request solo envía `reply` una vez al final del flujo (`messages = Array.isArray(reply) ? reply : [reply]` y luego loop de envío).
- `handleServicioTecnico()` devuelve un `string`, no un arreglo de respuestas, por lo que no puede explicar por sí solo 2 o 3 respuestas completas distintas dentro del mismo request.
- Los marcadores anti-duplicado (`recentInboundHashes` y `recentInboundIds`) se calculaban antes de procesar, pero se persistían recién al final del request.
- Eso dejaba una ventana donde un retry del proveedor podía volver a entrar antes de que el primer request guardara el dedupe en estado persistido.

## Hipotesis Confirmada
- Confirmada la hipótesis 1: el mismo mensaje puede reingresar mientras la primera ejecución aún está generando la respuesta, y como el dedupe persistente se guardaba al final, ese retry podía volver a procesarse completo.

## Estado
- Sesion creada.
- Instrumentacion agregada.
- Fix aplicado: persistir dedupe inmediatamente despues de validar que el inbound no es duplicado.
- Pendiente verificacion post-fix con una nueva prueba del usuario.
