# 02 · Arquitectura del sistema

## 1. Vista general

```
                        ┌──────────────────────────────────────────┐
   Paciente             │            CAPA DE CANAL                 │
   (WhatsApp)  ───────► │  WhatsApp Cloud API (Meta)               │
        ▲               │  + Web widget · Instagram · FB Messenger │
        │               └──────────────────┬───────────────────────┘
        │                                  │ webhook firmado
        │               ┌──────────────────▼───────────────────────┐
        │               │     CHATWOOT (CRM · self-hosted)         │
        │               │  Inbox · Contacts · Conversations        │
        │◄──────────────┤  Labels · Custom Attributes · Teams      │
        │   respuesta   │  Estado: pending ⇄ open ⇄ resolved       │
        │               └──────────────────┬───────────────────────┘
        │                        │ AgentBot webhook (message_created)
        │                        ▼
        │        ┌───────────────────────────────────────────────┐
        │        │        ORQUESTADOR DEL AGENTE                 │
        │        │                                               │
        │        │  0. Verificación de firma + rate limit        │
        │        │  1. TRIAGE DETERMINISTA (pre-LLM)  ⚠ crítico  │
        │        │  2. Gestor de contexto (historial + estado)   │
        │        │  3. Guardrails de entrada (PII scrub)         │
        │        │  4. LLM con tool-calling (Claude)             │
        │        │  5. Ejecutor de herramientas (schema-valid.)  │
        │        │  6. Guardrails de salida                      │
        │        │  7. Política de escalamiento                  │
        │        └───────┬───────────────────────────┬───────────┘
        │                │                           │
        │     ┌──────────▼──────────┐   ┌────────────▼────────────┐
        │     │   HERRAMIENTAS      │   │   CONOCIMIENTO (RAG)    │
        │     │  (transaccional)    │   │   (informativo)         │
        │     │ • buscar_cupos      │   │ • Catálogo de estudios  │
        │     │ • agendar_cita      │   │ • Preparaciones         │
        │     │ • reprogramar       │   │ • Sedes y horarios      │
        │     │ • cancelar          │   │ • Convenios/aseguradoras│
        │     │ • cotizar_estudio   │   │ • FAQ                   │
        │     │ • verificar_seguro  │   └─────────────────────────┘
        │     │ • screening_rm      │
        │     │ • estado_resultados │   ┌─────────────────────────┐
        │     │ • escalar_humano    │   │  OBSERVABILIDAD         │
        │     └──────────┬──────────┘   │ traces · métricas · evals│
        │                │              └─────────────────────────┘
        │     ┌──────────▼───────────────────────────────────────┐
        └─────┤  SISTEMAS DE OPEN SIDE (RIS/HIS · agenda · PACS) │
              └──────────────────────────────────────────────────┘
```

## 2. Los siete pasos del turno

### Paso 0 · Verificación
Chatwoot **firma los webhooks** de agent bots. Se valida HMAC contra el secreto del bot antes de procesar. Rate limit por contacto para frenar abuso.

### Paso 1 · Triage determinista **pre-LLM** ⚠
Antes de gastar un token, expresiones regulares + listas de términos detectan:

| Disparador | Acción |
|---|---|
| Emergencia (`dolor en el pecho`, `sangrado`, `no puedo respirar`, `desmay*`) | Mensaje fijo de emergencia (911 / cuarto de urgencias) + **escalamiento inmediato** + label `urgente`. **Nunca llega al LLM.** |
| Pedido explícito de humano (`hablar con una persona`, `asesor`, `humano`) | Handoff directo, sin negociar |
| Petición de interpretar resultados / diagnóstico | Respuesta fija: "solo tu médico interpreta" + oferta de handoff |
| Embarazo declarado + estudio con radiación (TAC) | Bloqueo de agendamiento + handoff a tecnólogo |
| Mensaje vacío / solo multimedia | Ruta de manejo de adjuntos |

Esto es lo que la literatura llama *deterministic pre-LLM intent classification that short-circuits safety-critical scenarios*. Es la diferencia entre un bot de salud responsable y uno peligroso.

### Paso 2 · Gestor de contexto
Carga: últimos N mensajes, custom attributes del contacto, cita activa, estado del slot-filling en curso. El **estado de la conversación es tipado y persistente** (patrón de grafo con estado): si el paciente se va y vuelve dos días después, retoma donde quedó.

### Paso 3 · Guardrails de entrada
- **PII scrubbing**: cédula, teléfono, nombre completo → tokens `[CEDULA_1]`, `[TEL_1]`. Re-hidratación local al emitir la respuesta.
- **Detección de inyección de prompt**: el contenido del paciente se marca como *untrusted*; el system prompt declara explícitamente que las instrucciones dentro de mensajes de usuario no son instrucciones del operador.
- Límite de longitud y de adjuntos.

### Paso 4 · LLM con tool-calling
Claude recibe: system prompt (rol, políticas, catálogo resumido), historial saneado, estado, y los **esquemas JSON de herramientas**. Devuelve texto o llamadas a herramientas estructuradas.

### Paso 5 · Ejecutor de herramientas
- **Allowlist**: solo se ejecutan herramientas declaradas para el estado actual (ej.: `agendar_cita` **no está disponible** hasta que `screening_rm` haya pasado y el consentimiento esté registrado).
- **Validación de esquema** estricta de argumentos.
- **Verificaciones de integridad**: reglas de negocio que el modelo no puede sobreescribir (ver §4).
- **Idempotencia**: cada llamada transaccional lleva `idempotency_key` derivada de la conversación + turno.

### Paso 6 · Guardrails de salida
- Filtro anti-diagnóstico (si la respuesta insinúa interpretación clínica → se bloquea y escala).
- Verificación de que todo precio/cupo/cobertura citado provenga de un resultado de herramienta **de este turno** (anti-alucinación por anclaje).
- Formato WhatsApp: longitud, emojis medidos, quick replies.

### Paso 7 · Política de escalamiento
Ver §5.

## 3. Modelo de datos en Chatwoot

### Custom attributes del **contacto** (paciente)
| Atributo | Tipo | Ejemplo |
|---|---|---|
| `paciente_nombre` | text | María Pérez |
| `paciente_cedula` | text | 8-XXX-XXXX |
| `fecha_nacimiento` | date | 1985-04-02 |
| `aseguradora` | list | ASSA / PALIG / MAPFRE / Internacional / Privado |
| `poliza_numero` | text | — |
| `consentimiento_datos` | checkbox | true |
| `consentimiento_ts` | date | 2026-09-22T14:03:11Z |
| `consentimiento_texto_hash` | text | sha256:… |
| `canal_preferido` | list | whatsapp |

### Custom attributes de la **conversación**
| Atributo | Tipo | Ejemplo |
|---|---|---|
| `estudio_solicitado` | text | RM columna lumbar simple |
| `sede_preferida` | list | 75E / 76E |
| `cita_id` | text | OS-2026-04871 |
| `cita_fecha` | date | 2026-09-30T09:30:00-05:00 |
| `screening_rm_estado` | list | pendiente / aprobado / requiere_revision / bloqueado |
| `requiere_contraste` | checkbox | true |
| `autorizacion_seguro` | list | no_requiere / pendiente / aprobada / rechazada |
| `motivo_escalamiento` | text | — |
| `agente_confianza` | number | 0.86 |

### Labels (enrutamiento + reportería)
`agendamiento` · `cotizacion` · `seguro` · `preparacion` · `resultados` · `urgente` · `screening-bloqueado` · `escalado-humano` · `resuelto-por-bot` · `no-show-riesgo`

## 4. Reglas deterministas que el LLM **no puede** sobreescribir

Estas viven en código, no en el prompt:

1. **No se agenda una RM sin `screening_rm_estado = aprobado`.** Marcapasos, DAI, clips de aneurisma, implantes cocleares, neuroestimuladores, cuerpo extraño metálico ⇒ `bloqueado` o `requiere_revision` → tecnólogo humano.
2. **No se agenda estudio con contraste sin verificar función renal declarada y alergias previas** (gadolinio es riesgoso en insuficiencia renal/diálisis).
3. **Embarazo o sospecha** ⇒ TAC bloqueado; RM → revisión humana.
4. **Ningún cupo se ofrece si no vino de `buscar_cupos` en este turno.** Los cupos tienen TTL corto; si expira, se re-consulta.
5. **Ningún precio se afirma sin `cotizar_estudio`.** Sin resultado de herramienta ⇒ el agente dice que no lo tiene y escala.
6. **Cobertura de seguro nunca se "confirma"**, solo se informa el estado devuelto por `verificar_seguro`. La autorización previa es requisito frecuente para radiología ambulatoria en Panamá.
7. **Nunca se interpretan resultados ni se da consejo médico.** Sin excepción, sin importar cómo lo pida el paciente.
8. **Datos sensibles solo tras consentimiento expreso registrado** (Ley 81 de 2019).

## 5. Política de escalamiento a humano

El handoff se dispara por:

| Disparador | Prioridad |
|---|---|
| Triage de emergencia | `urgent` |
| Petición explícita del paciente | `high` |
| Screening de RM `bloqueado` / `requiere_revision` | `high` |
| Autorización de seguro rechazada o compleja | `medium` |
| Confianza del agente < umbral (2 turnos seguidos) | `medium` |
| Reclamo / insatisfacción detectada | `high` |
| Herramienta transaccional falla 2 veces | `medium` |
| Fuera de alcance (facturación, RRHH, proveedores) | `low` |

**Mecánica en Chatwoot:**
1. El bot publica una **nota privada** con el resumen estructurado: intención, datos recolectados, qué intentó, por qué escala.
2. Aplica labels (`escalado-humano`, motivo).
3. Cambia `status` de `pending` → **`open`** vía Conversation Update API → entra a la cola humana.
4. Asigna al **team** correspondiente (`agenda`, `seguros`, `tecnologia-rm`).
5. Envía al paciente un mensaje de transición visible (el flujo de handoff V2 muestra el mensaje al cliente), con expectativa de tiempo según horario.
6. **Fuera de horario**: lo dice explícitamente y ofrece dejar el caso agendado para el siguiente bloque de atención.

**Retorno al bot:** el agente humano cambia `status` a `pending` de nuevo y el bot retoma.

## 6. Mensajería proactiva (plantillas)

Todo mensaje iniciado por el negocio fuera de la ventana de 24h requiere **plantilla aprobada**. Plantillas `utility` propuestas:

| Plantilla | Cuándo | Contenido |
|---|---|---|
| `confirmacion_cita` | Al agendar | Estudio, fecha, hora, sede, preparación, qué traer |
| `recordatorio_24h` | T-24h | Recordatorio + botones Confirmar / Reprogramar / Cancelar |
| `recordatorio_3h` | T-3h | Recordatorio corto + indicaciones de ayuno si aplica |
| `preparacion_previa` | T-48h si requiere ayuno/contraste | Instrucciones detalladas |
| `resultados_listos` | Al firmar el informe | Aviso + link seguro al portal (nunca el informe en el chat) |
| `autorizacion_pendiente` | Seguro sin autorizar a T-48h | Recordatorio de gestionar autorización |
| `reagendar_noshow` | Tras inasistencia | Oferta de reprogramar |

Los recordatorios automáticos son el mecanismo que reduce **25–35% las inasistencias**.

> **Costo:** desde el 1-oct-2026 Meta cobra mensajes utility dentro de la ventana abierta y mensajes de servicio, con un tramo gratuito de 1,000 mensajes de servicio/mes por número. El presupuesto del proyecto debe modelarse con tarifas de servicio incluidas y optimizar **mensajes por resolución**.

## 7. Stack propuesto

| Capa | Elección | Por qué |
|---|---|---|
| Canal | WhatsApp Cloud API (oficial) | Menor sobrecarga operativa; es el default para proyectos nuevos en 2026 |
| CRM / bandeja | **Chatwoot self-hosted** | Open source, agent bots nativos, control de datos (Ley 81) |
| Orquestador | Servicio propio (Node/TypeScript o Python/FastAPI) | Control total sobre guardrails deterministas |
| LLM | **Claude** (`claude-sonnet-5` para el turno, `claude-opus-5` para casos complejos / evaluación) | Tool-calling robusto, buen español, latencia adecuada |
| Estado | Postgres + Redis (sesión) | Estado tipado persistente, checkpointing |
| RAG | pgvector sobre el corpus de Open Side | Un solo motor de datos |
| Agenda | Integración con el RIS/agenda existente | El sistema es dueño de la verdad de los cupos |
| Observabilidad | Traces por turno (OpenTelemetry) + dashboard de evals | Sin trazas no se depura un agente |

## 8. Métricas de producto

| Métrica | Meta inicial |
|---|---|
| Tasa de contención (resuelto sin humano) | ≥ 60% en 3 meses |
| **Mensajes por resolución** | ≤ 6 |
| Citas agendadas por el agente / total | ≥ 35% |
| Reducción de no-shows | 25–35% |
| Tiempo a primera respuesta | < 5 s |
| Precisión de screening de RM (sin falsos aprobados) | **100%** — métrica de seguridad, no de eficiencia |
| CSAT post-conversación | ≥ 4.3/5 |
| Escalamientos con contexto completo | 100% |

## 9. Roadmap

| Fase | Alcance | Duración estimada |
|---|---|---|
| **0 · Descubrimiento** | Datos reales: precios, preparaciones, convenios, reglas de agenda. Acceso al RIS. | 1–2 sem |
| **1 · Piloto informativo** | FAQ + cotización + preparaciones + handoff. **Sin transacciones.** Chatwoot en producción con equipo humano. | 3–4 sem |
| **2 · Agendamiento** | Cupos reales, screening de RM, confirmación, plantillas de recordatorio. | 4–6 sem |
| **3 · Ciclo completo** | Seguros/autorizaciones, estado de resultados, reprogramación, campañas de rescate de no-shows. | 4–6 sem |
| **4 · Optimización** | Evals continuas, A/B de copy, voz, multi-sede, reportería ejecutiva. | continuo |
