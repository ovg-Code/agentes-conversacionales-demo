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

### Alto valor — resueltas en esta tanda
| Función | Estado |
|---|---|
| **Filtros avanzados** | ✅ 15 atributos, 9 operadores, unión Y/O |
| **Vistas guardadas** | ✅ con nombre, persistentes, borrables |
| **Adjuntos** | ✅ imágenes y archivos, con el límite que impone el navegador |
| **SLA configurable** | ✅ umbrales editables desde Ajustes |
| **Exportar transcripción** | ✅ descarga en texto, notas y adjuntos incluidos |

### Alto valor — sigue faltando
| Función | Qué es en Chatwoot | Por qué necesita backend |
|---|---|---|
| **Automatización** | `settings/automation` — reglas *si esto, entonces aquello* | Alguien tiene que evaluar las reglas cuando nadie mira la pantalla |

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

## Dónde está el techo del frontend

Se exprimió hasta donde da. Lo que queda no es difícil: es que **el navegador no es el sitio**.

> **Todo vive en `localStorage`.**

| Lo que no se puede hacer aquí | Por qué |
|---|---|
| Automatización | Nadie evalúa las reglas si la pestaña está cerrada |
| Bandeja compartida | Dos agentes en dos equipos no se ven |
| Auditoría real | Un registro que el propio usuario puede borrar no es auditoría |
| Adjuntos de verdad | `localStorage` ronda los 5 MB **en total**: por eso el límite por archivo es de 400 KB y se avisa al superarlo |
| Plantillas de WhatsApp y campañas | Necesitan además el canal conectado |
| Informes con rango de fechas | Solo existe lo de esta sesión |

Los adjuntos son el ejemplo más claro del techo: **funcionan**, pero con un límite que en producción sería absurdo. La pieza está hecha; lo que falta es dónde guardar el archivo.
