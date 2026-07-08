# Propuesta de Adaptación del Sistema Conversacional de WhatsApp

## Objetivo

Adaptar el sistema actual de atención por WhatsApp para que el usuario pueda interactuar de dos formas:

1. **Navegación guiada mediante menú.**
2. **Conversación libre utilizando Inteligencia Artificial.**

Ambos caminos deben converger hacia el mismo objetivo: entregar información correcta, alineada al negocio actual y conducir al usuario hacia la acción correspondiente (cotización, formulario de contacto, servicio técnico, arriendo, etc.).

---

# Objetivos Específicos

El asistente debe ser capaz de:

- Comprender tanto respuestas estructuradas como lenguaje natural.
- Utilizar un banco de conocimiento actualizado del negocio.
- Evitar respuestas fuera del contexto comercial.
- Detectar automáticamente la intención del usuario.
- Redireccionar la conversación hacia la rama correcta del flujo.
- Mantener una experiencia conversacional natural sin depender exclusivamente del menú.

---

# Modalidades de interacción

## 1. Navegación mediante Menú (Contexto)

El comportamiento actual del menú debe mantenerse, pero ampliando la capacidad de comprensión.

El sistema debe reconocer:

### Respuesta numérica

Ejemplos:

- 1
- 2
- 3
- 4
- 5

---

### Respuesta escrita

Ejemplos:

- Uno
- Dos
- Tres
- Cuatro
- Cinco

---

### Frases relacionadas

Ejemplos:

- Opción 3
- Elijo la opción 2
- Quiero la cuatro
- Escogo la opción uno
- Me interesa la número cinco

---

### Intenciones equivalentes

Incluso si el usuario no menciona el número, la IA debe inferir la rama correcta.

Ejemplos:

| Usuario | Derivar a |
|----------|-----------|
| Quiero cotizar un equipo | Venta |
| Necesito comprar radios | Venta |
| Quiero arrendar equipos | Arriendo |
| Necesito una repetidora | Venta |
| Busco servicio técnico | Servicio Técnico |
| Quiero reparar una radio | Servicio Técnico |
| Necesito asesoría para un proyecto | Proyectos |
| ¿Dónde están ubicados? | Direcciones |

Es decir, el menú debe funcionar tanto por selección explícita como por detección de intención.

---

# 2. Conversación Libre

Actualmente existen usuarios que ignoran completamente el menú y comienzan una conversación directamente.

Por ejemplo:

> Hola

> Necesito radios para una minera

> ¿Cuánto cuesta arrendar?

> ¿Tienen Motorola?

> ¿Atienden en Antofagasta?

Este tipo de interacción debe ser completamente soportada por el agente.

La IA debe identificar automáticamente la intención y dirigir la conversación hacia la rama correspondiente sin obligar al usuario a comenzar nuevamente desde el menú.

---

# Problemas actuales

Actualmente el sistema presenta errores cuando el usuario formula preguntas fuera del flujo esperado.

Ejemplo:

Usuario:

> ¿Tienen celulares?

Respuesta actual:

> Sí, manejamos equipos celulares...

Este comportamiento genera una respuesta incorrecta, ya que el negocio comercializa principalmente equipos de radiocomunicación.

Esto provoca:

- información incorrecta
- pérdida de confianza
- confusión
- reclamos
- conversaciones estancadas

---

# Solución propuesta

La IA debe trabajar sobre un **Banco de Conocimiento** que represente el negocio actual.

Antes de responder cualquier consulta, debe validar si el producto, servicio o concepto existe dentro del catálogo oficial.

Si no existe, debe responder de forma contextual.

Ejemplo:

Usuario:

> ¿Venden celulares?

Respuesta esperada:

> Actualmente no comercializamos teléfonos celulares. Nuestro catálogo está enfocado en soluciones de radiocomunicación profesional, como radios portátiles, móviles, repetidores, accesorios y servicios asociados.

De esta manera se evita entregar información inventada.

---

# Banco de Información

Se propone mantener un conjunto de información estructurada disponible para el agente.

Por ejemplo:

## Productos

Chile

- Radios Portátiles
- Radios Móviles
- Repetidores
- Accesorios
- Cámaras Corporales

Uruguay

- (Listado correspondiente)

---

## Servicios

- Venta
- Arriendo
- Servicio Técnico
- Asesoría en proyectos
- Contratos de soporte
- Mantenciones preventivas
- Reparaciones

---

## Marcas

- Motorola Solutions
- (otras marcas disponibles)

---

## Cobertura

- Chile
- Uruguay

---

## Frecuencias

- UHF Analógico
- UHF Digital
- VHF Analógico
- VHF Digital

---

# Clasificación automática de intención

Cada mensaje del usuario debe pasar por una etapa de clasificación antes de responder.

Ejemplo:

Usuario

> Necesito radios para una faena.

↓

Clasificación

Venta

↓

Productos

↓

Responder utilizando el banco de conocimiento.

---

Usuario

> Quiero arrendar veinte equipos.

↓

Clasificación

Arriendo

↓

Solicitar cantidad, ciudad y fechas.

---

Usuario

> Necesito reparar una radio Motorola.

↓

Clasificación

Servicio Técnico

↓

Continuar con el flujo correspondiente.

---

# Detección de entidades

Además de identificar la intención, la IA debería detectar automáticamente información relevante como:

- Producto
- Marca
- Cantidad
- País
- Ciudad
- Tipo de servicio
- Tipo de frecuencia
- Tipo de cliente
- Industria

Esto permitirá responder de manera más precisa y reducir preguntas innecesarias.

---

# Integración con las ramas del sistema

La conversación libre no reemplaza el menú.

Simplemente determina automáticamente a qué rama del flujo pertenece el usuario.

Ejemplo:

Usuario

> Necesito una repetidora para una minera.

↓

Detectar:

- Producto: Repetidor
- Intención: Venta

↓

Ingresar automáticamente al flujo de Venta sin mostrar nuevamente el menú principal.

---

# Beneficios

La implementación permitirá:

- Reducir respuestas incorrectas.
- Evitar alucinaciones del modelo.
- Disminuir la necesidad de crear "parches" para cada caso nuevo.
- Centralizar el conocimiento del negocio.
- Mejorar la experiencia del cliente.
- Guiar automáticamente al usuario hacia el formulario o ejecutivo correspondiente.
- Mantener conversaciones más naturales.
- Facilitar futuras actualizaciones simplemente modificando el banco de información.

---

# Recomendación de Arquitectura

Se recomienda que el agente de IA disponga de:

## 1. Banco de conocimiento

Información oficial del negocio:

- Productos
- Servicios
- Marcas
- Cobertura
- Preguntas frecuentes
- Restricciones
- Políticas comerciales

---

## 2. Clasificador de intención

Determina automáticamente qué desea el usuario.

Ejemplo:

- Venta
- Arriendo
- Servicio Técnico
- Proyectos
- Direcciones

---

## 3. Motor Conversacional

Mantiene el contexto de la conversación y responde utilizando exclusivamente el banco de información.

---

## 4. Navegador de Flujos

Una vez detectada la intención, dirige al usuario hacia la rama correspondiente del sistema sin obligarlo a utilizar el menú principal.

---

# Resultado Esperado

El sistema deberá comportarse como un asistente inteligente capaz de adaptarse a la forma en que cada usuario desea interactuar.

Si el usuario prefiere utilizar el menú, el flujo continuará funcionando normalmente.

Si el usuario decide conversar de forma libre, la IA comprenderá su intención, utilizará el banco de conocimiento oficial y lo dirigirá automáticamente hacia el flujo correcto, evitando respuestas erróneas y mejorando significativamente la experiencia de atención.