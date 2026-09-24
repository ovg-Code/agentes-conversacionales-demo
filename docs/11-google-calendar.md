# 11 · Sincronización con Google Calendar

> Pregunta que originó este documento: *"¿Eso va a estar conectado o sincronizado
> de alguna forma con Google Calendar?"*

**Respuesta corta:** hoy no. La agenda del CRM lee las citas que crea el agente y
vive en el navegador. Pero sí está preparado, y la conexión ya está escrita:
`server/calendario.js`, con 97 comprobaciones en `server/tests-calendario.mjs`.
Falta un dato que solo Open Side puede dar: **dónde vive hoy su agenda de verdad.**

---

## 1. La pregunta que decide el diseño

No es "¿se puede conectar?" — se puede. Es **quién manda cuando los dos no
coinciden.** Hay tres escenarios y dan tres sistemas distintos:

| Escenario | Dónde vive la verdad | Qué hace Google Calendar | Riesgo principal |
|---|---|---|---|
| **A · Open Side ya tiene RIS con agenda** | El RIS | Nada, o un espejo de lectura para el equipo | Duplicar la agenda en dos sitios que se desincronizan |
| **B · Open Side agenda en Google Calendar hoy** | Google Calendar | Es el sistema real: el agente escribe ahí | Google no sabe bloquear una franja: se puede sobreagendar |
| **C · Este sistema es la agenda** | Nuestra base de datos | Espejo de escritura + lector de bloqueos ajenos | Ninguno estructural. Es el que recomendamos |

El escenario **B** es el que la gente pide y el que más problemas da. Conviene
explicarlo con precisión, porque no es una opinión de diseño:

> La API de Google Calendar **no tiene reservas ni retención de franjas.** Dos
> llamadas simultáneas pueden insertar dos eventos encima del mismo equipo de
> resonancia y ninguna de las dos falla. No hay un `409` por solapamiento, no hay
> bloqueo optimista sobre el hueco, no hay `capacity`.

Un centro de imagen no puede sobreagendar una RM: hay un equipo, un tecnólogo y
45 minutos. Por eso el diseño que implementamos es el **C**, y la regla que lo
resume está en la cabecera del módulo:

```
Google Calendar NUNCA es la fuente de verdad de la capacidad.
Es un espejo que escribimos y un lector de bloqueos ajenos.
```

La retención del cupo se queda de nuestro lado — ya está, con TTL de 10 minutos,
en `demo/src/tools.js` — y Google recibe el evento **cuando la cita ya existe**.

---

## 2. Qué se lee de Google y qué se escribe

### Se lee: la ocupación que no pasa por nuestro sistema

`freeBusy.query` responde a una sola pregunta, que es la correcta: *¿esta hora
está ocupada?* No devuelve el contenido de los eventos, solo bloques.

```http
POST https://www.googleapis.com/calendar/v3/freeBusy
{ "timeMin": "...", "timeMax": "...", "timeZone": "America/Panama",
  "items": [{ "id": "cal-75e@group.calendar.google.com" },
            { "id": "cal-76e@group.calendar.google.com" }] }
```

```json
{ "calendars": { "cal-75e@…": { "busy": [{ "start": "…", "end": "…" }] } } }
```

Eso cubre lo que ningún sistema nuestro sabe: mantenimiento del equipo,
vacaciones del tecnólogo, un bloqueo que administración puso a mano el viernes.
Se resta de los cupos **antes** de ofrecerlos al paciente
(`espejarEnCalendario`, paso `buscar_cupos`).

Dos detalles que son decisiones, no accidentes:

- Un calendario que devuelve `errors` (no compartido, mal id) **no se trata como
  "sin ocupación"**. Es información que falta, y se marca así. Asumir que está
  libre es exactamente el error que produce una doble cita.
- Si `freeBusy` no responde, no se deja al paciente sin opciones: se ofrece el
  horario pero el modelo recibe la instrucción de presentarlo **sujeto a
  confirmación**. Prometer una hora que el equipo tiene en mantenimiento cuesta
  más que pedir una confirmación.

### Se escribe: un espejo sin datos del paciente

`events.insert`, con el identificador del evento **derivado del `cita_id`**:

```
OS-2026-04871  →  os202604871     (base32hex: [a-v0-9], 5–1024 caracteres)
```

Eso da idempotencia gratis. Un reintento no duplica el evento: Google responde
`409` y lo tratamos como éxito. Sin esto haría falta una tabla de deduplicación
y un `idempotency_key` propio.

El `cita_id` y la sede viajan además en `extendedProperties.private`, que es
consultable con `privateExtendedProperty` — así se encuentra el evento de una
cita sin guardar el id de Google en ninguna parte.

---

## 3. Ley 81 de 2019: lo que no sale del sistema

Un calendario compartido se ve en el teléfono de todo el que tenga acceso, se
sincroniza a clientes de correo y se indexa en la búsqueda de Workspace. Los
datos de salud son **datos sensibles** bajo la Ley 81 de 2019 y el Decreto
Ejecutivo 285 de 2021. Meter ahí "María Fernanda Quintero · RM de rodilla ·
ASSA" es tratamiento de datos sensibles en un tercero, con una base legal que
nadie firmó.

Lo que se escribe es esto y nada más:

```
Título:  RM de rodilla · OS-2026-04871
Cuerpo:  Cita gestionada por el sistema de Open Side.
         Los datos del paciente están en el CRM, no en este calendario.
         Referencia: OS-2026-04871
```

Sin nombre, sin teléfono, sin cédula, sin aseguradora. El nombre se resuelve al
abrir el CRM, donde hay control de acceso y trazabilidad. **La regla está
protegida por pruebas**, no por buena voluntad: `tests-calendario.mjs` serializa
el evento y falla si aparece cualquiera de esos cuatro campos.

El estudio sí va en el título, y es una concesión discutible: es lo mínimo para
que la recepción prepare la sala. Si Open Side lo prefiere, se reduce a la
modalidad (`RM · OS-2026-04871`) cambiando una línea en
`demo/src/calendario-mapeo.js`.

---

## 4. La vuelta: cambios hechos en Google

Si la recepción mueve una cita arrastrándola en Google Calendar, el CRM tiene
que enterarse. Dos piezas:

**`events.watch`** abre un canal de notificaciones push a un webhook nuestro. La
notificación **no trae el cambio**: solo avisa, con `X-Goog-Resource-State`. Hay
que venir a listar.

**`syncToken`** hace la lista incremental. Se guarda el `nextSyncToken` de cada
respuesta y se manda en la siguiente. Un `410 GONE` significa que el token
caducó: toca resincronización completa, y el módulo lo señala con
`resincronizar: true` en vez de fallar en silencio.

Se pide `showDeleted=true` a propósito: **una cancelación es un cambio**, y es
justamente el que más importa.

De la vuelta solo aceptamos dos cosas: **cambio de horario y cancelación**.
Nadie edita datos clínicos desde un calendario. Un evento sin `cita_id` en
`extendedProperties` se marca como **ajeno** — es un bloqueo hecho a mano, y
entra como ocupación, no como cita.

**Conflictos.** Si alguien movió el evento en Google desde que lo leímos, el
`PATCH` con `If-Match: <etag>` devuelve `412` y **no se pisa su cambio**: se
marca `requiere_revision_humana`. Un agente que gana siempre la carrera contra
la persona que está delante del paciente es un agente mal diseñado.

---

## 5. Autenticación

Service account con JWT RS256, no OAuth de usuario. El motivo es operativo:
nadie va a estar reautorizando una pantalla de consentimiento a las 3 de la
mañana cuando caduque un refresh token.

Pasos de puesta en marcha:

1. Proyecto en Google Cloud → habilitar **Google Calendar API**.
2. Crear una **cuenta de servicio** y descargar su clave privada JSON.
3. En la cuenta de Workspace de Open Side, crear **un calendario por sede**
   (75E y 76E) y compartir cada uno con el correo de la cuenta de servicio con
   permiso de **"Hacer cambios en los eventos"**.
4. Poner en el entorno del servidor:

```bash
GCAL_SEDE_75E=xxxxx@group.calendar.google.com
GCAL_SEDE_76E=yyyyy@group.calendar.google.com
GCAL_SA_EMAIL=agenda@openside-xxxx.iam.gserviceaccount.com
GCAL_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…"
# GCAL_SA_SUBJECT=agenda@open-side.com   # solo con delegación de dominio
```

`GCAL_SA_PRIVATE_KEY` es **un secreto**: va en el entorno, nunca en el
repositorio, y se rota como se rota una contraseña.

Los permisos pedidos son los mínimos: `calendar.events` y `calendar.freebusy`.
Deliberadamente **no** se pide `calendar.readonly`, que daría acceso al contenido
de los eventos ajenos de toda la cuenta.

**Un calendario por sede** y no uno solo: la recepción de la 75E ve su día sin el
ruido de la otra sede, y `freeBusy` se consulta por separado sin filtrar nada
después.

**Zona horaria:** `America/Panama`, UTC-5 todo el año. Panamá no usa horario de
verano, lo que elimina la clase de errores más molesta de una agenda: la cita que
se mueve una hora sola dos veces al año. Aun así las marcas se guardan en UTC y
`timeZone` viaja en cada evento, porque el día que Open Side atienda a alguien
desde otra zona eso deja de ser gratis.

---

## 6. Modos de fallo y qué pasa en cada uno

| Fallo | Qué hace el sistema | Qué ve el paciente |
|---|---|---|
| `freeBusy` no responde | Ofrece el cupo marcado como sujeto a confirmación; queda en la traza | Un horario, con la advertencia de que se confirma |
| Un calendario no está compartido | Esa sede se marca sin dato; **no** se asume libre | Nada distinto |
| `events.insert` falla | **La cita sigue siendo válida**: existe en nuestro sistema, que es la verdad. Se marca `espejo_pendiente` para reintento | Su cita confirmada, sin mención del problema |
| `events.insert` devuelve 409 | Idempotencia: el evento ya estaba | Nada |
| Alguien movió el evento en Google | `412` por `If-Match`: no se pisa. Revisión humana | Nada hasta que una persona decide |
| El `syncToken` caducó (`410`) | Resincronización completa | Nada |
| Nada libre en el rango | Cero cupos, no un cupo inventado | "No hay hueco, ¿probamos otra fecha?" |

El orden de escritura **no es negociable**: primero la cita en nuestro sistema,
después el evento en Google. Invertirlo deja, ante un fallo de red, un evento sin
cita: una hora bloqueada que nadie reclama y que nadie va a limpiar.

---

## 7. Qué está hecho y qué falta

**Hecho** (`server/calendario.js`, `demo/src/calendario-mapeo.js`, 97 pruebas):

- `freeBusy.query` por sede, con la ventana derivada de los cupos ofrecidos
- `events.insert` con id derivado del `cita_id` → idempotente
- `events.patch` con `If-Match` → detección de conflicto
- `events.delete` tolerante al 404/410
- `events.list` incremental con `syncToken` y caducidad por `410`
- `events.watch` para abrir el canal push
- Token de service account con JWT RS256, cacheado con 60 s de margen
- El pegamento dentro del turno del agente (`espejarEnCalendario`), conectado al
  loop en `server/agent-ai.js`
- `CalendarioMemoria` con la misma interfaz: sin credenciales el sistema funciona
  igual y no hay condicionales repartidos por el código
- En el CRM, la ficha de cada cita dice si está sincronizada y **muestra
  exactamente lo que se escribiría afuera**

**Falta, y necesita decisiones de Open Side o backend real:**

- El webhook receptor de `events.watch` (`POST /api/calendario/notificacion`),
  con verificación del `token` del canal y proceso asíncrono: Google corta a los
  pocos segundos, igual que Chatwoot (ver `06-integracion-chatwoot.md`)
- La renovación del canal por cron: los canales de Calendar caducan en días
- La cola de reintento del espejo pendiente
- Aplicar al CRM los cambios que vuelven de Google (hoy se traducen, pero no hay
  base de datos donde escribirlos: la agenda vive en `localStorage`)
- **Probarlo contra la API real.** Esta sesión no tiene conector de Google
  Calendar, así que todo está verificado con transporte inyectado, no con
  tráfico real. El contrato está tomado de la referencia de la API v3; la
  primera ejecución contra Google es la que dirá lo que la documentación calla.

---

## 8. Lo que hace falta preguntar a Open Side

1. **¿Dónde vive hoy su agenda?** ¿RIS, Google Calendar, un cuaderno, un Excel?
   Es lo que elige entre el escenario A, B y C.
2. Si ya usan Google Calendar: **¿un calendario por sede o uno por equipo?** Un
   centro con dos resonancias y un TAC probablemente quiera uno por equipo, y el
   mapeo pasa de sede a recurso.
3. **¿El estudio puede aparecer en el título del evento**, o solo la modalidad?
   Es la única concesión de privacidad del diseño y es de ellos, no nuestra.
