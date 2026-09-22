# 05 · El agente de IA (implementación real)

La primera entrega traía la arquitectura con un motor de reglas en el lugar del modelo. Este documento cubre el agente real: **Claude con tool-calling**, en `server/`.

---

## 1. Qué cambió y qué no

| | Motor de reglas (`demo/src/agent.js`) | Agente de IA (`server/agent-ai.js`) |
|---|---|---|
| Comprensión | regex + listas de términos | **Claude, tool-calling** |
| Triage determinista pre-LLM | ✅ | ✅ (idéntico) |
| Guardrails de entrada (PII, anti-inyección) | ✅ | ✅ |
| Herramientas como fuente de verdad | ✅ | ✅ (mismas funciones) |
| Precondiciones de seguridad | ✅ | ✅ **evaluadas contra el estado del servidor** |
| Guardrails de salida | ✅ | ✅ |
| Escalamiento con contexto | ✅ | ✅ |
| Conversación libre, fuera del guion | ❌ | ✅ |

Las capas alrededor del modelo son las mismas. **Eso era el punto del diseño**: el modelo es una pieza reemplazable dentro de un marco que no confía en él.

---

## 2. Decisiones de API y por qué

| Decisión | Valor | Razón |
|---|---|---|
| Modelo | `claude-opus-5` | Configurable con `OPENSIDE_MODEL`. |
| Thinking | `{ type: "adaptive" }` | Opus 5 corre thinking adaptativo; `budget_tokens` está **removido** y devuelve 400. |
| Effort | `medium` (`OPENSIDE_EFFORT`) | Atención conversacional: `high` no compra calidad proporcional al costo y la latencia. Para el screening de RM conviene medir `high`. |
| `max_tokens` | 2048 | Los mensajes de WhatsApp son cortos; no hace falta streaming para evitar timeouts. |
| Loop | **manual**, no el tool runner | Hacen falta tres cosas que el runner no expone: precondiciones evaluadas antes de ejecutar, traza por herramienta para el inspector, y corte por iteraciones. |
| `strict: true` en cada herramienta | ✅ | La API garantiza que `tool_use.input` valida exactamente contra el esquema. El ejecutor no recibe argumentos con forma inventada. |
| `fallbacks: "default"` + beta `server-side-fallback-2026-07-01` | ✅ | Si un clasificador de seguridad rechaza el turno, el servidor enruta a otro modelo en vez de romper la conversación. |
| `cache_control: ephemeral` en el system prompt | ✅ | El prompt (~4 KB) es estable; se paga una vez y se lee de caché en cada turno. La traza muestra `cache_read`. |
| Historial | recorte a 40 mensajes | Sin romper pares `tool_use`/`tool_result` — un `tool_result` huérfano es un 400. |

### Lo que se comprueba antes de leer la respuesta

```js
if (respuesta.stop_reason === 'refusal') { … }   // llega con HTTP 200, no como excepción
if (respuesta.stop_reason === 'pause_turn') { … } // reanudar empujando el turno
if (respuesta.stop_reason === 'max_tokens') { … } // respuesta truncada
```

Y los `tool_result` de llamadas paralelas van **en un único mensaje de usuario**: repartirlos en varios le enseña al modelo a dejar de paralelizar.

---

## 3. Las 12 herramientas

| Herramienta | Qué garantiza |
|---|---|
| `consultar_catalogo` | El modelo no inventa `estudio_id`. |
| `cotizar_estudio` | Única fuente de precios. |
| `verificar_seguro` | El modelo informa, no confirma cobertura. |
| `consultar_preparacion` · `consultar_sedes` | Datos institucionales, no memoria del modelo. |
| `obtener_preguntas_screening_rm` | El modelo usa la redacción oficial, no inventa preguntas de seguridad. |
| `evaluar_screening_rm` | **La decisión de aptitud es de la herramienta, no del modelo.** |
| `registrar_consentimiento` | Ley 81: timestamp + hash del texto mostrado. |
| `buscar_cupos` | Única fuente de horarios. |
| `agendar_cita` | Sujeta a tres precondiciones (abajo). |
| `estado_resultados` | El informe nunca viaja por el chat. |
| `escalar_humano` | `pending → open` en Chatwoot + nota privada. |

---

## 4. Las precondiciones: dónde vive la seguridad

Esto es lo que separa una regla de una sugerencia. El prompt *pide* al modelo que no agende sin screening; el **ejecutor lo impide**, y lo evalúa contra el estado del servidor — no contra lo que el modelo afirme en los argumentos:

```js
case 'agendar_cita': {
  if (!st.consentimiento)                          → SIN_CONSENTIMIENTO
  if (esRM && st.screening !== 'aprobado')         → SCREENING_NO_APROBADO
  if (!st.cupos.some(c => c.cupo_id === input.cupo_id)) → CUPO_DESCONOCIDO
```

La tercera es la más interesante: **si el modelo alucina un horario, el cupo no existe en el estado de la sesión y la llamada se rechaza.** No hay forma de que un cupo inventado llegue a la agenda. El rechazo vuelve al modelo como `tool_result` con `is_error: true` y un mensaje que le dice qué hacer, así que el agente se corrige solo en la siguiente iteración.

---

## 5. Privacidad: qué ve el modelo

El enmascarado de PII ocurre **antes** de construir el mensaje:

```
paciente escribe:  "mi cédula es 8-123-4567 y mi correo ana@mail.com"
el modelo recibe:  "mi cédula es [CEDULA_1] y mi correo [EMAIL_1]"
el servidor guarda: { cedula: "8-123-4567", email: "ana@mail.com" }
```

El system prompt le explica al modelo qué son esos marcadores para que no le pida al paciente repetir el dato. Bajo la Ley 81 esto importa: los datos sensibles no se transfieren a terceros —incluido el proveedor del modelo— sin base legal.

---

## 6. Verificación

```bash
npm run test:loop   # 41 comprobaciones del loop agéntico
npm test            # 16 casos del motor de reglas
```

`server/tests-loop.mjs` ejercita el **loop real** sustituyendo solo la llamada HTTP por un transporte simulado. Sin gastar un token, verifica:

- encadenado de herramientas y acumulación de tokens/caché
- `tool_result` paralelos en un único mensaje
- las tres precondiciones de `agendar_cita`, incluida la del cupo alucinado
- ciclo completo válido → cita creada
- marcapasos → `bloqueado` → escalamiento a `tecnologia_rm`
- triage: **cero llamadas a la API** en emergencia, petición de humano e interpretación
- PII que nunca llega al modelo
- filtro anti-diagnóstico que bloquea una respuesta del modelo
- alerta de anclaje cuando el modelo afirma un precio sin herramienta
- `refusal`, `pause_turn`, error de API, límite de iteraciones
- recorte de historial sin `tool_result` huérfanos

---

## 7. Arrancar

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start           # http://localhost:3000
```

Sin credencial el servidor arranca igual y la página cae al motor de reglas local; el badge del encabezado indica en qué modo está.

Variables: `OPENSIDE_MODEL` (por defecto `claude-opus-5`), `OPENSIDE_EFFORT` (`medium`), `PORT` (`3000`).

---

## 8. Lo que falta para producción

1. **Streaming al frontend** (SSE) para que el primer token aparezca antes. Con respuestas de 2-4 líneas el turno es corto, pero en móvil se nota.
2. **Estado en Postgres/Redis** — hoy las sesiones viven en un `Map` en memoria y se pierden al reiniciar.
3. **Webhook de Chatwoot** — `server/index.js` expone `/api/chat`; falta el endpoint que recibe `message_created` del agent bot, **valida la firma HMAC** y responde por la Application API.
4. **Evals automatizadas contra el modelo real** — los 41 casos usan transporte simulado, que prueba el andamiaje pero no el juicio del modelo. Hace falta una suite que corra contra la API con un juez, especialmente en los casos de seguridad.
5. **Rate limiting y reintentos** por contacto.
6. **Observabilidad** — las trazas existen en memoria; falta exportarlas (OpenTelemetry) y un dashboard.
