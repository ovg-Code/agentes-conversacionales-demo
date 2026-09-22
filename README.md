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
| [`demo/`](demo/) | El simulador. |

---

## El simulador

```bash
cd demo
python3 -m http.server 8000
# abrir http://localhost:8000
```

No hay build, ni dependencias, ni instalación. Es HTML, CSS y JavaScript con módulos ES.

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
cd demo
node tests.mjs
```

16 casos, de los cuales los de seguridad (emergencia, marcapasos, embarazo, diagnóstico, inyección de prompt, consentimiento) son **bloqueantes de release**: si alguno falla, no se despliega.

---

## De la demo a producción

La demo implementa la **misma arquitectura** que el diseño de producción. La única diferencia está en `demo/src/agent.js`: donde iría una llamada a Claude con tool-calling, hay un motor de reglas en la función `interpretar()`.

Lo que **no** cambia al conectar el modelo real:

- el triage determinista pre-LLM
- los guardrails de entrada (PII, anti-inyección) y de salida (anti-diagnóstico, anclaje a herramientas)
- las herramientas como única fuente de verdad
- las precondiciones de seguridad en el ejecutor
- la política de escalamiento
- el formato de la traza

```
demo/src/
  kb.js      · catálogo, sedes, horarios, screening, términos de triage
  tools.js   · herramientas deterministas (precios, cupos, screening, escalamiento)
  agent.js   · orquestador: triage → guardrails → intención → herramientas → escalamiento
  ui.js      · render del chat y del inspector
  app.js     · wiring y escenarios
```

## Antes de cualquier piloto

Falta recibir de Open Side los datos reales: lista de precios, protocolos de preparación, duraciones y bloques de agenda, convenios de aseguradoras, reglas de reprogramación, acceso al RIS, URL de la política de privacidad y el **cuestionario de screening de RM validado por su radiólogo**. La lista completa está al final de [`docs/04-agente-playbook.md`](docs/04-agente-playbook.md).
