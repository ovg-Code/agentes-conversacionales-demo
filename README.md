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
| [`docs/06-integracion-chatwoot.md`](docs/06-integracion-chatwoot.md) | El contrato real de Chatwoot, extraído de su código fuente (v4.18.0): cómo firma los webhooks, el límite de 5 s, el fail-safe que escala solo, los eventos y los endpoints del handoff. |
| [`server/`](server/) | El agente de IA: Claude con tool-calling. |
| [`demo/index.html`](demo/) | El chat: simulador de WhatsApp + inspector del agente. |
| [`demo/crm.html`](demo/) | El CRM: la bandeja del equipo humano. |

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

### Dos aplicaciones, no una

El chat y el CRM son cosas distintas y viven separadas:

| | `index.html` — **el chat** | `crm.html` — **el CRM** |
|---|---|---|
| Quién lo usa | el paciente | el equipo de Open Side |
| Qué muestra | réplica de WhatsApp: burbujas, colitas, checks de leído, indicador de escritura, quick replies | bandeja de tres columnas: conversaciones, hilo, datos del paciente |
| Extra | inspector con la traza del agente, escenarios y métricas | asignación, prioridad, posponer, SLA, labels, respuestas rápidas, atajos |

**El CRM** tiene cuatro secciones tras un rail de navegación: **Conversaciones**, **Pacientes** (agrupados por cédula o teléfono, con su historial y sus citas), **Informes** (métricas calculadas sobre las conversaciones reales) y **Ajustes** (equipo, labels, respuestas rápidas).

En la bandeja, con el modelo de datos de Chatwoot y código propio:

- **Seis vistas** con contadores en vivo: Activas · Mías · Libres · Bot · Pospuestas · Listas.
- **Asignación** a agentes y equipos · **prioridad** en cuatro niveles · **posponer** con reingreso automático.
- **Reloj de espera** con semáforo (verde <5 min, ámbar <15, rojo por encima) y **contador de no leídos**.
- **Respuestas rápidas**: se abren con `/`, se filtran al teclear y **rellenan los datos del paciente**.
- **Labels editables**, **historial del paciente** e **hilo con separadores de día**.
- **Atajos**: `j`/`k` navegar, `a` asignarme, `e` resolver, `p` devolver al bot, `n` nota, `r` responder, `/` buscar, `?` ayuda.

Se comunican por `demo/src/bus.js`, que hace en local lo que en producción hace el webhook de Chatwoot. Ábrelas en dos pestañas y pruébalo:

1. Escribe en el chat → la conversación aparece en el CRM en vivo, en estado `pending` (la atiende el bot).
2. Pulsa **Tomar conversación** → el chat avisa al paciente y el bot deja de responder.
3. Responde desde el CRM → llega al chat como mensaje de una persona, con su propia identidad visual.
4. Cambia a **Nota privada** → queda en el CRM y **no llega al paciente**.
5. **Devolver al bot** → el agente virtual retoma.

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
  src/app.js     · wiring del chat, escenarios y detección de modo
  src/bus.js     · canal entre el chat y el CRM (sustituto local del webhook)
  src/crm.js     · el CRM: bandeja, hilo, notas privadas, cambios de estado
  tests.mjs      · 16 casos del motor de reglas
```

### Sobre Chatwoot

Chatwoot (MIT, Rails 7.2 + Vue 3) es la **referencia**: se clona y se levanta para estudiar cómo resuelve la bandeja, el modelo de datos y el ciclo `pending → open → resolved`. El CRM de este repo es **nuestra propia versión**, con el mismo modelo de estados pero código propio y la marca de Open Side.

```bash
git clone --depth 1 https://github.com/chatwoot/chatwoot.git
cd chatwoot && cp .env.example .env     # SECRET_KEY_BASE y POSTGRES_PASSWORD
docker compose -f docker-compose.production.yaml up -d postgres redis
docker compose -f docker-compose.production.yaml run --rm rails bundle exec rails db:chatwoot_prepare
docker compose -f docker-compose.production.yaml up -d      # localhost:3000
```

⚠ El `docker-compose.production.yaml` trae `POSTGRES_PASSWORD=` vacío y **sobreescribe el `.env`**: hay que ponerle valor en el propio compose o postgres reinicia en bucle.

**El modelo entiende; el ejecutor decide.** Tres precondiciones se evalúan contra el estado del servidor, no contra lo que el modelo afirme:

```js
if (!st.consentimiento)                                → SIN_CONSENTIMIENTO
if (esResonancia && st.screening !== 'aprobado')       → SCREENING_NO_APROBADO
if (!st.cupos.some(c => c.cupo_id === input.cupo_id))  → CUPO_DESCONOCIDO
```

La tercera es la que cierra el hueco de las alucinaciones: **si el modelo inventa un horario, ese cupo no existe en el estado de la sesión y la llamada se rechaza.** El rechazo vuelve como `tool_result` con `is_error: true`, y el agente se corrige en la siguiente iteración.

## Antes de cualquier piloto

Falta recibir de Open Side los datos reales: lista de precios, protocolos de preparación, duraciones y bloques de agenda, convenios de aseguradoras, reglas de reprogramación, acceso al RIS, URL de la política de privacidad y el **cuestionario de screening de RM validado por su radiólogo**. La lista completa está al final de [`docs/04-agente-playbook.md`](docs/04-agente-playbook.md).
