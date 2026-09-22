# 09 · Paridad con Chatwoot

Inventario contra el repo clonado (`chatwoot/chatwoot` v4.18.0), no de memoria. Sirve para saber qué falta sin adivinar.

## Lo que ya tenemos

### Bandeja y conversación
| Función | Estado |
|---|---|
| Estados `pending` / `open` / `snoozed` / `resolved` | ✅ |
| Asignación a agente y a equipo | ✅ |
| Prioridad en cuatro niveles | ✅ |
| Posponer con reingreso automático | ✅ |
| Labels editables desde catálogo | ✅ |
| Notas privadas | ✅ |
| Custom attributes de contacto y conversación | ✅ |
| Contador de no leídos | ✅ |
| Reloj de espera con semáforo (SLA básico) | ✅ |
| Tiempo a primera respuesta | ✅ |
| Vistas de bandeja con contadores | ✅ |
| Ordenación por reciente / espera / prioridad | ✅ |
| **Selección múltiple y acciones en bloque** | ✅ |
| **Menú contextual (clic derecho)** | ✅ |
| **Macros** (secuencias de acciones) | ✅ |
| **Respuestas rápidas** con variables | ✅ |
| **Menciones `@`** en notas privadas | ✅ |
| **Responder a un mensaje concreto** | ✅ |
| **Buscador global** (⌘K) | ✅ |
| Separadores de día en el hilo | ✅ |
| Atajos de teclado | ✅ (14) |

### Secciones
Conversaciones · Pacientes · Informes · Ajustes — todas funcionales sobre datos reales.

## Lo que falta

Ordenado por lo que más se nota en el día a día de un centro de imágenes:

### Alto valor
| Función | Qué es en Chatwoot | Por qué importa aquí |
|---|---|---|
| **Adjuntos** | `SharedAttachments`, subida en `ReplyBox` | Los pacientes mandan fotos de su orden médica. Hoy no hay forma de recibirlas |
| **Automatización** | `settings/automation` — reglas *si esto, entonces aquello* | Auto-etiquetar, auto-asignar por estudio o aseguradora sin intervención |
| **Filtros avanzados** | `advancedFilterItems` — condiciones combinables | "RM pendientes de ASSA sin autorización" |
| **Vistas guardadas** | `customviews` | Guardar ese filtro como carpeta propia |
| **SLA configurable** | `settings/sla` — políticas con umbrales | Hoy el semáforo tiene umbrales fijos en el código |

### Valor medio
| Función | Qué es en Chatwoot |
|---|---|
| **CSAT** | Encuesta de satisfacción al resolver |
| **Política de asignación** | `assignmentPolicy` — reparto automático, round robin |
| **Registro de auditoría** | `auditlogs` — quién cambió qué y cuándo |
| **Atributos personalizados configurables** | `settings/attributes` — hoy están fijos en el código |
| **Plantillas de WhatsApp** | `WhatsappTemplates` — las plantillas aprobadas por Meta |
| **Campañas** | Envíos masivos programados |
| **Silenciar conversación** | `mute_conversation` |
| **Transcripción por correo** | `EmailTranscriptModal` |

### Fuera de alcance por ahora
Equipos y roles personalizados, Help Center, integraciones (Shopify, Linear…), Captain (su copiloto de IA — nosotros tenemos el nuestro), llamadas de voz, facturación.

## El límite real

Ninguna de las que faltan es difícil por sí sola. Lo que las bloquea es el mismo cuello de botella de siempre:

> **Todo vive en `localStorage` del navegador.**

Sin backend no hay adjuntos (no hay dónde guardarlos), ni automatización (no hay quién evalúe las reglas cuando nadie mira), ni auditoría real, ni bandeja compartida entre dos personas. Las plantillas de WhatsApp y las campañas necesitan además el canal conectado.

De las cinco de alto valor, **filtros avanzados y vistas guardadas** son las únicas que se pueden hacer enteras en el frontend. Las otras tres piden backend.
