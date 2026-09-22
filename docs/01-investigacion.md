# 01 · Investigación: agentes conversacionales para Open Side

> Fecha de investigación: septiembre 2026. Todas las afirmaciones externas llevan fuente al final.

## 1. El cliente: quién es Open Side

Contrario a lo que sugiere el nombre, **Open Side no es una empresa de software**: es un **centro de diagnóstico por imagen en Panamá**, con más de 15 años de operación.

| Dato | Valor |
|---|---|
| Rubro | Diagnóstico por imagen (radiología ambulatoria) |
| País | Panamá — San Francisco, Ciudad de Panamá |
| Sedes | Calle 75E · Calle 76E ("Cubo de Vidrio") |
| Horario | Lun–Vie 7:00–20:00 · Sáb 7:00–14:00 |
| Teléfonos | 226-2332 / 302-0309 (75E) · 388-2313 / 388-0413 (76E) |
| WhatsApp | 6480-0336 |
| Correos | resonancia@open-side.com · resonanciasucursal2@open-side.com |
| Idioma | Español (Panamá) |

**Catálogo de estudios publicado:**

- **Resonancia Magnética (1.5T y 3.0T)** — cerebro, columna (cervical/dorsal/lumbar/sacra), articulaciones, abdomen y pelvis, mama, próstata.
- **Tomografía Computarizada (128 cortes, Philips)** — cerebro, tórax, abdomen y pelvis, senos paranasales, columna.
- **Estudios especiales** — angiorresonancia, resonancia de mama, estudios vasculares, enterorresonancia, defecorresonancia.
- Variantes: **simple** y **con contraste**.

**Propuesta de valor declarada:** "Diagnóstico por Imagen Preciso y Confiable" — resultados rápidos, **agendamiento por WhatsApp**, entrega digital de resultados, convenios con aseguradoras y precios especiales para pacientes privados.

**CTA principal del sitio:** *"Agenda una Cita"* → **WhatsApp**.

### Conclusión estratégica

El canal de conversión primario de Open Side **ya es WhatsApp**, y su CTA principal apunta ahí. El sitio **no publica precios, preparaciones ni requisitos** — es decir, *toda* esa información se resuelve hoy en una conversación humana. Eso es exactamente el volumen repetitivo que un agente conversacional absorbe:

1. ¿Cuánto cuesta una resonancia de columna lumbar?
2. ¿Aceptan mi seguro? ¿Necesito autorización?
3. ¿Tengo que estar en ayunas? ¿Me van a poner contraste?
4. Quiero agendar / cambiar / cancelar mi cita.
5. ¿Ya están mis resultados?

> **Nota de alcance:** el sitio no publica precios ni políticas de preparación. Todos los precios, duraciones y reglas de preparación en esta demo son **placeholders marcados como ficticios** y deben ser reemplazados por los datos reales de Open Side antes de cualquier uso productivo.

---

## 2. Arquitectura de agentes: lo que dice el estado del arte (2026)

### 2.1 El patrón dominante

El flujo canónico para un agente de atención en WhatsApp es:

```
WhatsApp Cloud API → webhook → gestor de contexto (historial) →
clasificación de intención → LLM con tool-calling → herramientas deterministas →
respuesta → registro en CRM
```

### 2.2 La regla de oro: el LLM **no** inventa la verdad transaccional

El hallazgo más consistente en la literatura y en las implementaciones reales:

> El modelo **no debe "agendar citas"** inventando cupos. Debe interpretar la intención, recolectar el contexto requerido y **llamar herramientas deterministas que son dueñas de la verdad de los cupos**.

Esto se formaliza como el enfoque **neuro-simbólico**: el LLM aporta comprensión de lenguaje natural y selección de herramientas; **reglas simbólicas deterministas** aplican las de negocio y **no pueden ser sobreescritas** por el modelo.

### 2.3 Tres innovaciones arquitectónicas de seguridad

Las arquitecturas maduras para salud combinan:

1. **Clasificación de intención determinista *pre-LLM*** que cortocircuita escenarios críticos de seguridad **antes** de invocar al modelo (ej.: emergencia médica → respuesta fija + escalamiento inmediato).
2. **Orquestación de herramientas restringida por esquema**, con verificaciones de integridad embebidas (JSON Schema + validación).
3. **Pipeline híbrido RAG + herramientas**, que **separa la recuperación informativa de las operaciones transaccionales**.

### 2.4 Guardrails en producción

Ningún mecanismo aislado cubre todos los modos de falla. Una arquitectura de guardrails de producción incluye: verificaciones basadas en modelo, validación determinista, autenticación, autorización, *allowlists* de herramientas, compuertas de aprobación, esquemas, límites de acción, filtros de salida, observabilidad y evaluación continua.

Para agentes tipo grafo (LangGraph y similares): estado tipado, aristas condicionales, *checkpointing* para persistencia/reanudación, y **puntos de interrupción explícitos para supervisión humana**.

### 2.5 Impacto de negocio reportado

- Agendamiento con IA + recordatorios automáticos: **reducción de 25–35% en inasistencias (no-shows)**.
- Casos de estudio: **91.8% de tareas completadas**, **96.0% de cumplimiento de seguridad**, **23× de reducción de costo** frente al agendamiento manual.

---

## 3. El CRM: Chatwoot

El usuario pidió explícitamente un CRM "tipo Chatwoot". Chatwoot encaja bien porque es **open source, self-hosteable** (relevante para datos de salud bajo ley panameña) y tiene un mecanismo de bot nativo.

### 3.1 Mecanismo clave: Agent Bots

Chatwoot permite conectar **agentes de IA externos** directamente a un inbox:

| Aspecto | Detalle |
|---|---|
| Configuración | Settings → Bots → Add Bot (nombre, avatar, **webhook URL**), luego conectar al inbox |
| Eventos entrantes | `widget_triggered`, `message_created`, `message_updated` |
| Payload `message_created` | id, `content`, fecha de creación, `message_type` (`incoming`/`outgoing`/`template`), atributos |
| Respuesta del bot | POST de vuelta vía Application API a la conversación |
| Verificación | Chatwoot genera un **secreto** y **firma los webhooks** del canal API y de los agent bots |

### 3.2 El patrón de handoff (crítico)

Este es el corazón del diseño:

- Con un agent bot conectado, las conversaciones se crean en estado **`pending`** → el bot **tría** antes de pasarla a un humano.
- Si el bot determina que se necesita un humano, usa la **Conversation Update API** para cambiar el estado a **`open`** → entra a la cola humana.
- Un agente humano puede **devolver** la conversación al bot cambiando el estado a `pending` de nuevo.
- El flujo de handoff **V2 muestra el mensaje de handoff al cliente** (no es silencioso).
- **Notas internas**: visibles solo para el equipo, no para el paciente — el vehículo ideal para pasar el contexto del handoff.

### 3.3 Superficie de API relevante

| Categoría | Uso en este proyecto |
|---|---|
| **Platform API** | Administración de la instalación, creación de AgentBots |
| **Application API** | El grueso: Contacts (crear/buscar/actualizar/fusionar), Conversations (crear, cambiar `status`/`priority`, asignar), Messages (crear, incl. notas privadas), **Labels**, **Custom Attributes**, Teams, Inboxes, Canned Responses, Automation Rules, Webhooks, Reporting |
| **Client API** | Solo si se construye un widget propio |

Autenticación por token en header; especificaciones OpenAPI publicadas para application/client/platform.

**Decisión de diseño:** los datos clínicos-operativos del paciente (tipo de estudio, sede, cita, aseguradora, estado del *screening* de RM) se modelan como **Custom Attributes** del contacto/conversación + **Labels** para enrutamiento y reportería. Eso convierte a Chatwoot en el CRM operativo sin necesidad de una segunda base de datos de cara al agente humano.

---

## 4. WhatsApp Cloud API: restricciones que moldean el producto

### 4.1 La ventana de 24 horas y el modelo per-message

- Desde **julio de 2025** WhatsApp pasó a un modelo **per-message**; Meta **ya no cobra por ventana de conversación de 24h**.
- Categorías: **marketing** (tarifa más alta), **utility**, **authentication** (más baja), **service** (respuestas libres en conversaciones iniciadas por el cliente).
- Históricamente, cualquier mensaje no-plantilla enviado en respuesta a una consulta iniciada por el usuario era **gratis dentro de la ventana de servicio de 24h**.
- **Cambio importante — 1 de octubre de 2026:** Meta comenzará a cobrar **mensajes utility dentro de la ventana abierta** y también **mensajes de servicio** (a tarifas de utility/authentication por mercado), introduciendo un **tramo gratuito mensual de 1,000 mensajes de servicio por número**.

### 4.2 Implicaciones de diseño directas

1. **Fuera de la ventana de 24h solo se puede iniciar con plantilla aprobada.** Recordatorios de cita, avisos de "resultados listos" y confirmaciones ⇒ **plantillas `utility` pre-aprobadas**, no texto libre.
2. **El costo ya no premia "alargar" conversaciones.** Con cobro per-message, la métrica a optimizar es **mensajes por resolución**: cada turno extra del bot cuesta dinero. Esto favorece **respuestas densas con quick replies** sobre interrogatorios de una pregunta por mensaje.
3. **Presupuestar el cambio de octubre 2026**: el tramo gratuito de 1,000 mensajes de servicio/mes se consume rápido en un centro con volumen; el ROI del agente debe calcularse con tarifas de servicio incluidas.

---

## 5. Marco legal: Panamá, Ley 81 de 2019

Los datos de salud son **datos sensibles** bajo la Ley 81 de 2019, reglamentada por el Decreto Ejecutivo 285 de 2021.

| Requisito | Consecuencia de diseño |
|---|---|
| El consentimiento para datos sensibles de salud debe ser **previo, indubitable y expreso** | El agente **pide consentimiento explícito** antes de recolectar cualquier dato clínico (motivo del estudio, implantes, embarazo) |
| El consentimiento debe ser **informado, inequívoco y trazable** | Se registra el consentimiento con **timestamp + texto exacto mostrado + canal**, como custom attribute inmutable en el CRM |
| El responsable debe **poder demostrar** que la persona consintió | Log de auditoría append-only; el consentimiento electrónico es válido si es demostrable |
| Los datos sensibles **no se transfieren sin consentimiento explícito** | Ningún dato clínico sale hacia terceros (incluido el proveedor de LLM) sin base legal; ver mitigación abajo |

### Mitigaciones técnicas adoptadas en el diseño

- **Minimización en el prompt:** el agente trabaja con el *mínimo* dato clínico necesario. El motivo del estudio y el detalle clínico **no se envían al LLM** salvo que sean imprescindibles; el *screening* de seguridad de RM es un **cuestionario determinista**, no una conversación libre con el modelo.
- **Redacción/enmascaramiento (PII scrubbing)** de cédula, teléfono y nombre antes de cualquier llamada al modelo; re-hidratación local al responder.
- **Chatwoot self-hosted** en infraestructura controlada, con retención definida.
- **Sin diagnóstico ni interpretación**: el agente nunca interpreta imágenes ni resultados — guardrail duro, no una sugerencia del prompt.

---

## 6. Síntesis: los 10 principios de diseño que salen de esta investigación

1. **WhatsApp primero.** Es donde ya está el paciente y donde apunta el CTA del sitio.
2. **El LLM entiende; las herramientas deciden.** Cupos, precios y coberturas vienen de sistemas, nunca del modelo.
3. **Triage determinista antes del modelo.** Emergencia, solicitud de humano y temas clínicos críticos se cortocircuitan pre-LLM.
4. **Separar RAG de transacciones.** Informar ≠ ejecutar.
5. **Handoff visible y con contexto.** Estado `pending`→`open` en Chatwoot + nota interna con el resumen.
6. **Consentimiento explícito y trazable** antes de cualquier dato sensible (Ley 81).
7. **Nunca interpretar resultados ni dar consejo médico.** Guardrail duro.
8. **Plantillas utility para todo lo proactivo.** Recordatorios, resultados, confirmaciones.
9. **Optimizar mensajes-por-resolución**, no tiempo de sesión — el cobro es per-message.
10. **Todo evento observable.** Cada turno emite intención, herramientas llamadas, latencia y confianza; sin esto no hay forma de depurar ni de evaluar.

---

## Fuentes

- [Open Side — sitio oficial](https://www.open-side.com/) · [Servicios](https://www.open-side.com/servicios) · [Contacto](https://www.open-side.com/contacto)
- [Chatwoot — Agent Bots: Bring Your Own AI Agent](https://www.chatwoot.com/features/chatbots)
- [Chatwoot — How to use Agent bots](https://www.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots)
- [Chatwoot — How to use webhooks](https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks)
- [Chatwoot Developers — API](https://developers.chatwoot.com/introduction) · [índice llms.txt](https://developers.chatwoot.com/llms.txt)
- [Chatwoot — WhatsApp for Business](https://www.chatwoot.com/features/whatsapp-for-business)
- [Meta for Developers — Pricing on the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [YCloud — WhatsApp Service Messages Will Be Charged: 24-Hour Window Cost Guide](https://www.ycloud.com/blog/whatsapp-service-messages-24-hour-window-pricing)
- [Blueticks — WhatsApp Business API Pricing in 2026](https://blueticks.co/blog/whatsapp-business-api-pricing-2026)
- [Wati — WhatsApp API Templates: Types, Pricing & Best Practices](https://www.wati.io/en/blog/whatsapp-api-templates-guide/)
- [Toward Trustworthy Large Language Model Agents in Healthcare (arXiv)](https://arxiv.org/pdf/2607.05055)
- [Agent Design Pattern Catalogue (arXiv 2405.10467)](https://arxiv.org/pdf/2405.10467)
- [Design Patterns for Securing LLM Agents against Prompt Injections (arXiv 2506.08837)](https://arxiv.org/pdf/2506.08837)
- [Augment Code — Agentic Design Patterns: 2026 Pattern Catalog](https://www.augmentcode.com/guides/agentic-design-patterns)
- [Mintec — AI Agents for Appointment Scheduling](https://mintec.co/blog/ai-agents-appointment-scheduling-booking/)
- [respond.io — WhatsApp Chatbot for Healthcare](https://respond.io/blog/whatsapp-chatbot-for-healthcare)
- [Ley 81 de 2019 — Asamblea Nacional de Panamá (PDF oficial)](https://s3-legispan.asamblea.gob.pa/legispan/NORMAS/2010/2019/LEY/Administrador%20Legispan_28743-A_2019_3_29_ASAMBLEA%20NACIONAL_81.pdf)
- [Decreto Ejecutivo 285 de 2021 (Gaceta Oficial, PDF)](http://gacetas.procuraduria-admon.gob.pa/29296-A_56425.pdf)
- [Icaza, González-Ruiz & Alemán — Protección de Datos en Panamá](https://www.icazalaw.com/wp-content/uploads/2021/07/MEMO-PROTECCION-DE-DATOS-EN-PANAMA-1-de-julio-de-2021.pdf)
- [RadiologyInfo / guías de preparación de RM con y sin contraste (Quirónsalud, PDF)](https://www.quironsalud.com/malaga/es/pacientes-visitantes/pautas-preparacion-pruebas-diagnosticas-imagen.ficheros/2137521-Preparaci%C3%B3n%20RM%20con%20y%20sin%20contraste.pdf)
