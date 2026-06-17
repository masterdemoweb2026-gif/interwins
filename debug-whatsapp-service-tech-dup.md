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

## Evidencia Pendiente
- Contar cuantas veces entra el request por mensaje.
- Contar cuantas veces se evalua la rama `servicio_tecnico`.
- Contar cuantas veces se llama a `handleServicioTecnico()` por `inboundText`.
- Confirmar cuantas veces se ejecuta `sendTextMessage()` por request y con que contenido.

## Estado
- Sesion creada.
- Falta instrumentacion.
