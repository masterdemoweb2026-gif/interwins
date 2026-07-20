This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Variables de entorno (Vercel)

Este proyecto recibe mensajes entrantes por webhook y responde vía GOWA. Además, consulta Supabase y usa MiniMax M2.7 solo para redacción humanizada (saludos/cierres/excepciones).

### WhatsApp / GOWA

- `WHATSAPP_VERIFY_TOKEN` (string) Token de verificación del webhook (GET hub.challenge)
- `GOWA_WEBHOOK_SECRET` (string, opcional) Se usa para validar `x-hub-signature-256` (HMAC SHA256)
- `GOWA_BASE_URL` (string) Base URL de GOWA, ej: `http://<host>:3000`
- `GOWA_BASIC_AUTH` (string, opcional) Credenciales para Basic Auth (se aceptan en texto plano o ya en formato `Basic ...`)
- `GOWA_DEVICE_ID` (string, opcional) Device ID para GOWA (`X-Device-Id`)
- `WHATSAPP_AUTO_REPLY` (boolean string, opcional) `true` para responder automáticamente (default `true`)
- `DEBUG_STORE_WEBHOOK_BODY` (boolean string, opcional) `true` para guardar el body completo en debug inbox

### Supabase

- `SUPABASE_URL` (string) URL del proyecto, ej: `https://xxxx.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` (string recomendado) Key server-side para leer/escribir estado y consultar tablas con RLS
- `SUPABASE_ANON_KEY` (string, fallback) Se usa si no está `SUPABASE_SERVICE_ROLE_KEY`

El estado conversacional por usuario se persiste en la tabla `message_buffer` (columna `full_message`) usando como key `user_phone`.

### AI / DeepSeek (redacción humanizada)

- `AI_API_KEY` (string, recomendado) API Key canónica para la capa de completions
- `AI_BASE_URL` (string, opcional) Default: `https://opencode.ai/zen/go/v1/chat/completions`
- `AI_MODEL` (string, opcional) Default: `DeepSeek V4 Flash`
- Compatibilidad hacia atrás: también se aceptan `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` y, temporalmente, `MINIMAX_API_KEY` / `MINIMAX_BASE_URL`

### NLU (comprensión de intención)

Capa que interpreta el mensaje del cliente **antes** de la máquina de estados, para que no dependa de seguir el menú. Extrae en una sola pasada la rama, el tipo de solicitud (cotización/arriendo), el modelo, la banda, la tecnología, la cantidad y la ciudad, y con eso pre-rellena los filtros del catálogo: el bot se salta las preguntas cuya respuesta ya tiene.

Implementada en `src/lib/nlu.ts`. Usa el mismo gateway que la redacción (`AI_API_KEY` / `AI_BASE_URL`).

- `NLU_ENABLED` (boolean string, opcional) `false` para apagarla y volver 100% a la heurística anterior (default `true`)
- `NLU_MODEL` (string, opcional) Modelo para clasificar. Se separa de `AI_MODEL` a propósito: el enrutado necesita latencia baja. Default: el valor de `AI_MODEL`
- `NLU_TIMEOUT_MS` (number string, opcional) Timeout de la llamada de clasificación (default `3500`)

**Degradación segura:** si no hay `AI_API_KEY`, si la llamada falla, si vence el timeout o si el JSON es inválido, `classifyIntent` devuelve `null` y el webhook continúa con la detección por regex de siempre. Los mensajes triviales (números de menú, `menu`, `hola`, `si`) nunca llegan al LLM.

**Límites por diseño:** el NLU solo clasifica y extrae datos. Nunca redacta precios ni inventa productos — los datos comerciales siempre salen de Supabase. Todo valor que devuelve el modelo pasa por listas blancas antes de tocar el estado.

Las decisiones quedan trazadas en el debug inbox con el prefijo `[NLU]`.

### App

- `NEXT_PUBLIC_APP_URL` (string, opcional) Solo para mostrar la URL del webhook en la página de inicio
