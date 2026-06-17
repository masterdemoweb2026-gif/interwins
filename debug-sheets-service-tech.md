# [OPEN] Debug Session: sheets-service-tech

## Sintoma
- Una solicitud confirmada de servicio tecnico no aparece en Google Sheets.

## Esperado
- Al confirmar una solicitud de servicio tecnico, debe agregarse una fila en el Sheet correspondiente.

## Hipotesis
1. El flujo de confirmacion no llama a `appendLeadToGoogleSheet()` para `cl_servicio_tecnico`.
2. `resolveSheetsTarget()` esta resolviendo un spreadsheet o tab incorrecto para servicio tecnico.
3. La autenticacion con Google Sheets falla y el append se descarta.
4. El formulario de contacto de servicio tecnico no completa los datos requeridos para disparar el guardado.
5. La fila se escribe, pero en otra hoja por `country`, `flowKey` o `tab`.

## Evidencia Pendiente
- Confirmar donde se invoca `appendLeadToGoogleSheet()`.
- Confirmar con que `kind`, `country` y `flowKey` se construye la fila.
- Confirmar si el append responde `ok` o falla con status.
- Confirmar el spreadsheet/tab final de servicio tecnico CL.

## Estado
- Sesion creada.
- Falta instrumentacion.
