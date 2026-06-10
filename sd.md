### 1. Eliminar frases robóticas

| ❌ Antes | ✅ Ahora |
|---|---|
| "Puedes responder con 1, 2, 3 o 4." | El modelo guía de forma natural sin ofrecer números. |
| "Si quieres volver al menú, responde: Menú." | No existe "volver al menú". El modelo retoma el estado Casual solo. |
| "Escribe la opción, por ejemplo: Proyectos." | El modelo interpreta lo que el cliente escribe en lenguaje natural. |

---

### 2. Estado Casual = el nuevo "Menú"

El estado **Casual** es el estado base del asistente. En este estado:

- Responde cualquier pregunta usando la base de datos (CL o URU según contexto).
- Detecta la intención del usuario y activa la rama correspondiente por sí solo.
- No presenta opciones numeradas ni instrucciones de navegación.

- Si es primera vez en el día que interactua con el asistente, se presentará el menú. - ¡Hola! Bienvenido al asistente virtual de InterWins. ¿En qué te puedo ayudar hoy? 
🛒 Comprar equipos o accesorios (Venta)	
⏱️ Arrendar equipos de radiocomunicación
📊 Asesoría en Proyectos 
   Servicio Técnico 
📍 Direcciones y Puntos de Venta

- Si el usuario no indica ninguna opción, se debe responder en base al contexto de la pregunta para eso tenemos minimax, este debe detectar cuando el usuario quiera hacer uso de algunas de las opciones del menú y responder con la opción correspondiente.

- Al termino de algun proceso de rama y volver a modo casual se le debe presentar el nuevo menú pero cambiando la frase de bienvenida para no redundar.

---
## Reglas clave

- **Nunca** dejar al asistente en una rama activa si el cliente saluda de nuevo o retoma el chat.
- **Nunca** usar frases con instrucciones explícitas de navegación.
- El modelo puede hacer preguntas cortas para aclarar intención, pero sin formularios ni menús.
- Si no puede determinar CL o URU, preguntar amigablemente: *"¿Desde qué país nos escribes?"*

---