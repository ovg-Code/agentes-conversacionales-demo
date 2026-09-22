# 03 · Sistema de diseño

Este sistema cubre **dos superficies + una capa que la mayoría olvida**:

1. **Superficie del paciente** — la burbuja de WhatsApp (no controlamos el contenedor, sí el contenido).
2. **Superficie del equipo** — la consola/CRM estilo Chatwoot.
3. **Diseño conversacional** — el "sistema de diseño" real de un agente: tono, estructura de turno, manejo de error. §5.

---

## 1. Fundamentos de marca

Open Side es un centro médico: la paleta debe transmitir **precisión clínica y calma**, no entusiasmo comercial. Azul diagnóstico + cian de tecnología, sobre neutros fríos.

### 1.1 Color — marca

| Token | Hex | Uso |
|---|---|---|
| `--os-blue-900` | `#062A4A` | Texto sobre claro, fondos profundos |
| `--os-blue-800` | `#0A3D6B` | Encabezados |
| `--os-blue-700` | `#0E5490` | Hover de primario |
| `--os-blue-600` | `#1268B0` | **Primario** (botones, enlaces) |
| `--os-blue-500` | `#1A83D4` | Primario en modo oscuro |
| `--os-blue-400` | `#4DA3E3` | Bordes activos |
| `--os-blue-200` | `#C3E1F8` | Fondos de realce |
| `--os-blue-100` | `#E6F2FC` | Superficie de realce suave |
| `--os-cyan-500` | `#12B5CB` | **Acento** — tecnología, datos, IA |
| `--os-cyan-100` | `#DBF4F8` | Fondo de acento |

### 1.2 Color — semántico

| Token | Hex | Significado |
|---|---|---|
| `--sem-success` | `#128C5A` | Confirmado, aprobado, cita creada |
| `--sem-warning` | `#B26A00` | Requiere revisión, autorización pendiente |
| `--sem-danger` | `#C0322A` | Bloqueado, contraindicación, emergencia |
| `--sem-info` | `#1268B0` | Informativo |
| `--sem-ai` | `#7A4FE0` | **Acción del agente IA** — se distingue siempre del humano |
| `--sem-human` | `#0E7C7B` | Acción de agente humano |

> **Regla dura:** en la consola, todo lo que hizo la IA se marca con `--sem-ai` y todo lo humano con `--sem-human`. Un operador debe poder distinguir de un vistazo quién habló. Nunca se disfraza al bot de humano.

### 1.3 Neutros

`--n-0 #FFFFFF` · `--n-50 #F7F9FB` · `--n-100 #EDF1F5` · `--n-200 #DDE4EB` · `--n-300 #C2CDD8` · `--n-400 #96A5B4` · `--n-500 #6B7C8C` · `--n-600 #4E5E6D` · `--n-700 #37454F` · `--n-800 #232E36` · `--n-900 #141C22`

### 1.4 Tipografía

| Token | Valor |
|---|---|
| `--font-sans` | `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |
| `--font-mono` | `"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace` |

Escala (1.250 — tercera mayor): `--fs-xs 12px` · `--fs-sm 13px` · `--fs-base 15px` · `--fs-md 17px` · `--fs-lg 21px` · `--fs-xl 26px` · `--fs-2xl 33px`

Pesos: 400 cuerpo · 500 énfasis · 600 títulos · 700 datos críticos.
Altura de línea: 1.5 cuerpo · 1.25 títulos.

### 1.5 Espaciado, radios, elevación

Espaciado base 4px: `--sp-1 4` · `--sp-2 8` · `--sp-3 12` · `--sp-4 16` · `--sp-5 20` · `--sp-6 24` · `--sp-8 32` · `--sp-10 40` · `--sp-12 48`

Radios: `--r-sm 6px` · `--r-md 10px` · `--r-lg 14px` · `--r-xl 20px` · `--r-full 999px`

Elevación: `--e-1 0 1px 2px rgba(20,28,34,.08)` · `--e-2 0 2px 8px rgba(20,28,34,.10)` · `--e-3 0 8px 24px rgba(20,28,34,.14)`

Movimiento: `--dur-fast 120ms` · `--dur-base 200ms` · `--dur-slow 320ms`, curva `cubic-bezier(.4,0,.2,1)`. Todo respeta `prefers-reduced-motion`.

---

## 2. Superficie del paciente: WhatsApp

**No controlamos esta UI.** La replicamos fielmente en el simulador para que las pruebas sean representativas: longitud real de burbuja, cómo se ven los botones, cuántas líneas ocupa una lista.

### 2.1 Paleta WhatsApp (referencia, uso exclusivo del simulador)

| Elemento | Claro | Oscuro |
|---|---|---|
| Fondo de chat | `#E5DDD5` | `#0B141A` |
| Panel / encabezado | `#F0F2F5` | `#202C33` |
| Burbuja entrante (negocio) | `#FFFFFF` | `#202C33` |
| Burbuja saliente (paciente) | `#DCF8C6` | `#005C4B` |
| Texto primario | `#111B21` | `#E9EDEF` |
| Texto secundario / hora | `#667781` | `#8696A0` |
| Verde de marca | `#25D366` | `#25D366` |
| Verde oscuro clásico | `#075E54` | — |
| Enlaces | `#027EB5` | `#53BDEB` |
| Check leído | `#53BDEB` | `#53BDEB` |

### 2.2 Anatomía del mensaje del agente

Restricciones reales de WhatsApp que el diseño respeta:

| Elemento | Límite | Regla de diseño |
|---|---|---|
| Cuerpo de texto | 4096 car. | **Apuntar a ≤ 450** — móvil, lectura de una pantalla |
| Botones de respuesta rápida | **3 máx**, 20 car. c/u | Las tres opciones más probables; nunca "Otro" como botón |
| Lista interactiva | 10 ítems, 24 car. título | Para catálogo de estudios y selección de cupos |
| Encabezado de plantilla | 60 car. | — |
| Pie de plantilla | 60 car. | Aviso legal / identidad del bot |

**Estructura canónica de un turno del agente:**

```
[1] Reconocimiento (1 línea)      → "Perfecto, resonancia de columna lumbar."
[2] Sustancia (1–4 líneas)        → el dato, el precio, los cupos
[3] Una sola pregunta o acción    → "¿Cuál de estos horarios te sirve?"
[4] Quick replies (≤3)            → [Lun 9:30] [Mar 14:00] [Ver más]
```

**Anti-patrones prohibidos:**
- ❌ Muro de texto sin estructura.
- ❌ Dos preguntas en un mismo mensaje.
- ❌ Mensajes consecutivos del bot sin intervención del usuario (>2). Con cobro per-message, cada burbuja extra cuesta.
- ❌ Emojis decorativos en contenido clínico. Máximo 1 emoji funcional por mensaje (📍 sede, 🗓 fecha, ⚠ advertencia).
- ❌ Fingir ser humano.

### 2.3 Identidad del bot

Primer mensaje de toda conversación nueva, **siempre**:

> *"Hola, soy **Sofía**, la asistente virtual de Open Side 🤖 Te ayudo a agendar estudios, consultar precios y preparaciones. En cualquier momento escribe **'asesor'** para hablar con una persona."*

Tres cosas obligatorias: **es un bot**, **qué puede hacer**, **cómo salirse**.

---

## 3. Superficie del equipo: consola CRM

Layout de tres columnas (patrón Chatwoot):

```
┌──────────┬──────────────────────────┬────────────────────┐
│ Bandeja  │  Conversación            │  Panel de contexto │
│ (280px)  │  (fluido)                │  (320px)           │
│          │                          │                    │
│ filtros  │  mensajes + notas        │  datos del paciente│
│ labels   │  privadas                │  cita activa       │
│ colas    │  composer                │  screening RM      │
│          │                          │  labels · acciones │
└──────────┴──────────────────────────┴────────────────────┘
```

### 3.1 Componentes

| Componente | Especificación |
|---|---|
| **Fila de conversación** | Avatar 40px · nombre 15/600 · preview 13/400 `--n-500` · hora 12 · chips de label · punto de estado |
| **Punto de estado** | `pending` = `--sem-ai` (bot atendiendo) · `open` = `--sem-warning` · `resolved` = `--sem-success` |
| **Burbuja entrante** | `--n-0`, radio `--r-lg` (esquina inferior izq. 4px), sombra `--e-1` |
| **Burbuja saliente humana** | `--sem-human` 12% de fondo, borde izquierdo 3px `--sem-human` |
| **Burbuja saliente IA** | `--sem-ai` 10% de fondo, borde izq. 3px `--sem-ai`, **badge "IA"** obligatorio |
| **Nota privada** | Fondo `#FFF8E1`, borde punteado `--sem-warning`, ícono 🔒, nunca visible al paciente |
| **Chip de label** | `--r-full`, 12/500, fondo 14% del color semántico |
| **Tarjeta de herramienta** | Monoespaciada, colapsable: nombre, argumentos, resultado, latencia. Es el *trace* del turno |
| **Banner de escalamiento** | Franja `--sem-warning`, motivo + confianza + botón "Tomar conversación" |

### 3.2 El inspector de agente (diferenciador)

Panel que muestra, por cada turno del bot: **intención detectada + confianza**, **triage determinista** (disparó o no), **herramientas llamadas** con argumentos/resultado/latencia, **guardrails evaluados**, **estado de slots**, y **decisión de escalamiento**.

Sin esto, un agente en producción es una caja negra imposible de depurar. Es la implementación práctica del principio de *full state snapshots at each node*.

---

## 4. Accesibilidad

- Contraste **AA mínimo** (4.5:1 texto normal, 3:1 texto grande y elementos de UI). La paleta está construida para cumplirlo en ambos modos.
- **El color nunca es el único portador de significado**: todo estado lleva ícono + etiqueta de texto.
- Objetivos táctiles ≥ 44×44px.
- Foco visible: anillo de 2px `--os-cyan-500` con 2px de separación.
- Navegación completa por teclado en la consola; roles ARIA (`log`, `article`, `status`) en el hilo de mensajes.
- `prefers-reduced-motion`: sin animación de "escribiendo", sin transiciones.
- Modo oscuro nativo en ambas superficies.

---

## 5. Diseño conversacional (el sistema de diseño del agente)

### 5.1 Persona: "Sofía"

| Rasgo | Definición |
|---|---|
| Rol | Asistente virtual de agenda de Open Side |
| Tono | Cálido pero preciso. Español de Panamá, **tuteo**. Profesional de salud, no vendedor |
| Registro | Claro y llano. Términos médicos solo cuando el paciente los usa primero |
| Longitud | Corta. Dos a cuatro líneas. |
| Nunca | Diagnostica, interpreta, promete resultados, pide datos que no necesita, finge ser humana |
| Siempre | Confirma lo entendido, ofrece salida a humano, dice cuando no sabe |

### 5.2 Vocabulario controlado

| Decir | No decir |
|---|---|
| "estudio" | "examen", "prueba" (inconsistente) |
| "cita" | "turno", "reserva" |
| "sede Calle 75E" | "la sucursal 1" |
| "tu médico interpretará el resultado" | "tu resultado parece normal" |
| "no tengo ese dato, te comunico con una persona" | "creo que cuesta como…" |

### 5.3 Los cinco estados de la conversación

```
SALUDO ──► DESCUBRIMIENTO ──► RECOLECCIÓN ──► CONFIRMACIÓN ──► CIERRE
   │             │                 │                │            │
   └─────────────┴─────────────────┴────────────────┴────────────┘
                     cualquiera puede ir a ► ESCALAMIENTO
```

Cada estado define: **qué herramientas están permitidas**, qué slots faltan y cuál es la salida esperada.

### 5.4 Manejo de error (la parte que define la calidad)

| Situación | Respuesta de diseño |
|---|---|
| No entiende (1ª vez) | Reformula + ofrece 3 opciones concretas |
| No entiende (2ª vez) | **Escala.** No hay tercera vez |
| Herramienta falla | "Tuve un problema consultando la agenda" + reintento único + escala |
| Paciente frustrado | Reconoce → escala inmediato. No intenta salvar la conversación |
| Fuera de alcance | Lo dice claro + deriva al canal correcto |
| Fuera de horario | Lo declara y da expectativa real de respuesta |

> **Principio rector:** un escalamiento rápido y con contexto es una mejor experiencia que tres turnos de un bot tratando de adivinar.

### 5.5 Momentos que requieren cuidado especial

1. **Screening de seguridad de RM** — cuestionario determinista, sin ambigüedad, sin alarmismo. Cada pregunta es sí/no explícita. Ante duda: humano.
2. **Consentimiento de datos (Ley 81)** — texto claro, previo y expreso, con opción real de negarse (y ruta alternativa: llamar por teléfono).
3. **Resultados** — nunca en el chat; siempre link seguro al portal. Nunca se interpreta nada.
4. **Emergencia** — corta todo, mensaje fijo, escalamiento inmediato.

---

## 6. Implementación

Los tokens de este documento viven en [`demo/assets/tokens.css`](../demo/assets/tokens.css) como variables CSS. La UI de WhatsApp está en `whatsapp.css` y la consola en `console.css`. Cualquier cambio de marca se hace **solo en `tokens.css`**.
