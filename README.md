# Agentes conversacionales · Open Side

Sistema de diseño, arquitectura y banco de pruebas de un **agente conversacional de WhatsApp con CRM tipo Chatwoot** para [Open Side](https://www.open-side.com/), centro de diagnóstico por imagen en Ciudad de Panamá.

> ⚠ **Demostración.** Esta página no es un canal real de Open Side y no envía mensajes a nadie.
> Precios, convenios, preparaciones y disponibilidad son **datos ficticios** marcados como tales.
> Sedes, horarios y catálogo de estudios provienen del sitio público de Open Side.

---

## El caso

Open Side ya usa WhatsApp como canal de conversión: su CTA principal es *"Agenda una Cita"* → WhatsApp. Pero el sitio **no publica precios, preparaciones ni requisitos**, así que todo eso se resuelve hoy en conversaciones humanas, una por una. Ese es exactamente el volumen repetitivo que un agente absorbe:

cotizar · verificar seguro · explicar preparación · **screening de seguridad de resonancia** · agendar · recordar · avisar resultados.

## El principio que ordena todo el diseño

> **El modelo entiende. Las herramientas deciden.**

El LLM interpreta intención y selecciona herramientas. Cupos, precios, coberturas y decisiones de seguridad vienen de sistemas deterministas que el modelo **no puede sobreescribir**. Encima de eso: triage determinista *antes* del modelo para emergencias, guardrails de entrada y salida, y escalamiento a humano con contexto completo.

---

## Contenido

| Documento | Qué contiene |
|---|---|
| [`docs/01-investigacion.md`](docs/01-investigacion.md) | Quién es Open Side, estado del arte de agentes en salud, Chatwoot, WhatsApp Cloud API, Ley 81 de Panamá, y los 10 principios que salen de ahí. Con fuentes. |
| [`docs/02-arquitectura.md`](docs/02-arquitectura.md) | Diagrama del sistema, los 7 pasos del turno, modelo de datos en Chatwoot, reglas que el LLM no puede sobreescribir, política de escalamiento, plantillas, stack, métricas y roadmap. |
| [`docs/03-design-system.md`](docs/03-design-system.md) | Tokens de color/tipografía/espaciado, UI del paciente (WhatsApp), UI del equipo (consola), accesibilidad y **diseño conversacional**: persona, vocabulario, estructura de turno, manejo de error. |
| [`docs/04-agente-playbook.md`](docs/04-agente-playbook.md) | Prompt de sistema listo para producción, catálogo de intenciones, esquemas JSON de herramientas, guiones de consentimiento y emergencia, 15 casos de prueba. |
| [`docs/05-agente-ia.md`](docs/05-agente-ia.md) | **El agente real**: decisiones de API (modelo, thinking, effort, `strict`, fallbacks, caché), las 12 herramientas, las precondiciones de servidor, privacidad y qué falta para producción. |
| [`server/`](server/) | El agente de IA: Claude con tool-calling. |
| [`demo/`](demo/) | El simulador y el motor de reglas de respaldo. |

---

## Arrancar

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...     # activa el agente de IA
npm start                                # http://localhost:3000
```

Sin credencial el servidor arranca igual y la página cae a un **motor de reglas local** equivalente, útil para probar el flujo sin gastar tokens. El badge del encabezado indica en qué modo estás.

También puedes abrir solo el frontend, sin backend:

```bash
cd demo && python3 -m http.server 8000
```

**Izquierda:** lo que ve el paciente — réplica de WhatsApp con burbujas, colitas, checks de leído, indicador de escritura, botones de respuesta rápida, modo claro y oscuro.

**Derecha:** lo que ve el equipo —

- **Inspector del agente** · por cada turno: intención + confianza, si el triage determinista disparó, cada llamada a herramienta con argumentos, resultado y latencia, qué guardrails se evaluaron y la decisión de escalamiento.
- **CRM · Chatwoot** · el contacto y la conversación como *custom attributes*, labels, estado `pending`/`open`/`resolved` y la **nota privada** que recibe el agente humano en un handoff.
- **Escenarios** · 10 conversaciones reproducibles con un clic, incluidos los casos bloqueantes de release.
- **Métricas** · turnos, herramientas, latencia, escalamientos y **mensajes por resolución** (la métrica que importa bajo el cobro per-message de WhatsApp).

### Escenarios incluidos

| Escenario | Qué demuestra |
|---|---|
| Agendar resonancia | Ciclo completo: consentimiento → screening → cupos → cita confirmada |
| Contraindicación: marcapasos | El screening **bloquea** el agendamiento y escala a tecnología RM |
| Emergencia médica | Triage determinista: no pasa por el modelo, escala urgente |
| Pide interpretar su informe | Rehúsa dar diagnóstico, deriva al médico tratante |
| Inyección de prompt | Intento de manipulación neutralizado |
| Cotización y seguro | Precio desde herramienta + convenio con autorización previa |
| Preparación con ayuno | Consulta informativa (RAG), sin transacción |
| Consulta de resultados | El informe nunca viaja por el chat |
| Pide hablar con una persona | Handoff inmediato, sin insistir |
| Dos mensajes incomprensibles | Escala a la segunda vez, nunca a la tercera |

---

## Pruebas

```bash
npm run test:loop   # 41 comprobaciones del agente de IA
npm test            # 16 casos del motor de reglas
```

`server/tests-loop.mjs` ejercita el **loop agéntico real** sustituyendo solo la llamada HTTP por un transporte simulado: verifica precondiciones, triage (cero llamadas a la API en una emergencia), PII que nunca llega al modelo, `refusal`, `pause_turn`, límite de iteraciones y recorte de historial — sin gastar un token.

Los casos de seguridad (emergencia, marcapasos, embarazo, diagnóstico, inyección de prompt, consentimiento) son **bloqueantes de release**: si alguno falla, no se despliega.

> Las pruebas cubren el andamiaje alrededor del modelo, no su juicio. Antes del piloto hace falta una suite de evals contra la API real, con especial atención a los casos de seguridad — ver `docs/05-agente-ia.md` §8.

---

## Cómo está montado

```
server/
  agent-ai.js      · el agente: triage pre-LLM → guardrails → Claude con tool-calling
                     → ejecutor con precondiciones → guardrails de salida → escalamiento
  tool-schemas.js  · las 12 herramientas en formato Anthropic, todas con strict:true
  index.js         · HTTP: estáticos + /api/chat + /api/health + /api/reset
  tests-loop.mjs   · 41 comprobaciones del loop con transporte simulado

demo/
  src/kb.js      · catálogo, sedes, horarios, screening, términos de triage
  src/tools.js   · herramientas deterministas (precios, cupos, screening, escalamiento)
  src/agent.js   · motor de reglas de respaldo, misma arquitectura sin modelo
  src/ui.js      · render del chat y del inspector
  src/app.js     · wiring, escenarios y detección de modo
  tests.mjs      · 16 casos del motor de reglas
```

**El modelo entiende; el ejecutor decide.** Tres precondiciones se evalúan contra el estado del servidor, no contra lo que el modelo afirme:

```js
if (!st.consentimiento)                                → SIN_CONSENTIMIENTO
if (esResonancia && st.screening !== 'aprobado')       → SCREENING_NO_APROBADO
if (!st.cupos.some(c => c.cupo_id === input.cupo_id))  → CUPO_DESCONOCIDO
```

La tercera es la que cierra el hueco de las alucinaciones: **si el modelo inventa un horario, ese cupo no existe en el estado de la sesión y la llamada se rechaza.** El rechazo vuelve como `tool_result` con `is_error: true`, y el agente se corrige en la siguiente iteración.

## Antes de cualquier piloto

Falta recibir de Open Side los datos reales: lista de precios, protocolos de preparación, duraciones y bloques de agenda, convenios de aseguradoras, reglas de reprogramación, acceso al RIS, URL de la política de privacidad y el **cuestionario de screening de RM validado por su radiólogo**. La lista completa está al final de [`docs/04-agente-playbook.md`](docs/04-agente-playbook.md).
