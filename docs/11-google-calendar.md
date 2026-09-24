# 11 · Google Calendar como agenda

> **Decisión tomada:** la agenda de Open Side vive en Google Calendar. No es un
> espejo de otro sistema: es el sistema. Lo que sigue es cómo se hace eso sin
> que dos pacientes se queden con la misma hora.

---

## 1. El problema que hay que resolver primero

La API de Google Calendar **no tiene reservas**. No existe un "retener esta
franja", no hay bloqueo optimista sobre un hueco, no hay `capacity`, y no
devuelve error cuando dos eventos se solapan. Dos llamadas simultáneas insertan
dos citas encima del mismo equipo de resonancia y las dos responden `200`.

Para un calendario de reuniones da igual: la gente resuelve el solape hablando.
Para un centro de imagen no: hay un equipo, un tecnólogo y 45 minutos. Una doble
cita es un paciente que hizo ayuno de seis horas, pidió permiso en el trabajo y
llegó para que le digan que vuelva mañana.

Así que antes de nada hacía falta construir un candado sobre lo único que
Calendar sí garantiza.

## 2. El candado

> **El id de un evento es único dentro de un calendario.**

Esa es la primitiva. Si el id se deriva de **la franja** —no de la cita—
entonces dos reservas del mismo inicio chocan en el mismo id y Google devuelve
`409` a la segunda. Eso es un compare-and-set atómico, servido por Google, sin
base de datos propia ni cola ni Redis.

```
sede 75E + 2026-10-05 07:00  →  r75esf1lg
```

`Number#toString(32)` produce exactamente los dígitos `0-9` y las letras `a-v`,
que es el alfabeto base32hex que Google acepta para los ids de evento. La
conversión es literalmente gratuita.

**Pero el candado no basta**, y es importante decirlo: un estudio de 45 minutos
a las 7:00 y uno de 25 a las 7:30 tienen ids distintos, así que el `409` no los
separa. Tampoco detecta el bloqueo que la administración acaba de poner a mano,
que tiene un id aleatorio. Por eso el protocolo tiene tres pasos:

```
1. INSERTAR   evento tentativo con id = f(sede, inicio)
              → 409 significa que otro ya tomó ese mismo inicio. Se pierde.

2. RELEER     los eventos de la ventana [inicio-90min, fin+90min]

3. RESOLVER   ¿algo solapa?
              · evento ajeno        → se suelta y se pierde
                (quien está delante del paciente manda)
              · reserva nuestra con id MENOR → se suelta y se pierde
              · nada                → la franja es nuestra
```

El desempate por id menor es lo que evita el bloqueo mutuo. Las dos partes de
una carrera leen el mismo orden y llegan a conclusiones opuestas: una se queda,
la otra se retira. No hace falta coordinación.

**Está probado bajo concurrencia real**, no razonado sobre el papel:
`server/tests-calendario-e2e.mjs` levanta un doble de la API que respeta la
unicidad de ids, lanza **veinte reservas simultáneas** sobre la misma franja y
comprueba que gana exactamente una. También comprueba el caso que el `409` no
cubre: dos estudios que se solapan a medias.

### Detalles que muerden

- **Un id borrado sigue reservado.** Si la franja se liberó antes, el evento
  existe pero cancelado y hay que revivirlo con `PATCH`, no insertar otro id.
- **Reservar es tentativo.** El evento entra con `status: tentative`. Sigue
  contando como ocupado en `freeBusy`, así que retiene de verdad, pero se
  distingue de una cita cerrada: el CRM lo pinta como *Reserva en curso*.
- **Liberar borra, no cancela.** Un evento cancelado sigue apareciendo en la
  sincronización incremental; borrarlo devuelve el hueco a `freeBusy` de
  inmediato.

## 3. Quién manda sobre qué

```
Google Calendar  →  el CUÁNDO y el DÓNDE     (la franja, el equipo, la ocupación)
Nuestro sistema  →  el QUIÉN                  (paciente, cédula, seguro, conversación)
                    unidos por cita_id
```

No es una concesión: es obligatorio. Un calendario compartido se ve en el
teléfono de todo el que tenga acceso, se sincroniza a clientes de correo y se
indexa en la búsqueda de Workspace. Los datos de salud son **datos sensibles**
bajo la Ley 81 de 2019 y el Decreto Ejecutivo 285 de 2021. Lo que se escribe es:

```
Título:  RM de rodilla · OS-2026-04871
Cuerpo:  Cita gestionada por el sistema de Open Side.
         Los datos del paciente están en el CRM, no en este calendario.
         Referencia: OS-2026-04871
```

Sin nombre, sin teléfono, sin cédula, sin aseguradora. **La regla la protegen
dos pruebas**: una serializa el evento y falla si aparece cualquiera de esos
campos; la de extremo a extremo lo vuelve a comprobar sobre lo que quedó
realmente guardado en el doble de la API.

El estudio sí va en el título, para que la recepción prepare la sala. Es la
única concesión del diseño, y se reduce a la modalidad (`RM · OS-2026-04871`)
cambiando una línea en `demo/src/calendario-mapeo.js`.

## 4. La disponibilidad ya no se inventa

Antes `buscar_cupos` generaba horarios plausibles. Ahora:

```
horario del centro  −  lo ocupado en Calendar  =  lo que se ofrece
```

- Rejilla de **15 minutos**, no de 30: una RM de 25 minutos encajaría mal en
  media hora y se perderían huecos reales.
- **Margen de 2 horas**: nadie agenda una resonancia para dentro de veinte
  minutos. Hay que llegar, registrarse y, si toca, ayunar.
- Lunes a viernes 7:00–20:00, sábados 7:00–14:00, domingo cerrado — y la franja
  entera tiene que caber antes del cierre.
- Los tres cupos que se ofrecen se **reparten en días distintos**, que es lo que
  hace una recepcionista, en vez de tres horas seguidas del mismo martes.

**Zona horaria.** Panamá es UTC-5 todo el año, sin horario de verano, así que la
conversión es una resta. Lo que no se puede hacer es usar `setHours`: el
servidor corre en UTC y las 7:00 de la mañana acabarían a las 2:00. Toda la
rejilla se construye en hora civil panameña y se emite en UTC, y las etiquetas
que lee el paciente tienen su propio formateador por el mismo motivo.

**Si una sede no se puede leer, no se ofrece.** En un diseño de espejo se podía
asumir libre; aquí no. Si Calendar *es* la agenda, no poder leerla es no saber
nada, y ofrecer a ciegas es exactamente como se produce la doble cita.

## 5. El turno del agente

Dos enganches alrededor del ejecutor, y el orden entre ellos es lo importante:

| Momento | Qué pasa |
|---|---|
| **antes** de `agendar_cita` | Se toma la franja en Calendar. Si ya está tomada, el ejecutor **ni siquiera corre** y el modelo recibe `CUPO_NO_VIGENTE` con la instrucción de volver a consultar |
| **después** de `buscar_cupos` | Los cupos ofrecidos son los de Calendar; los que generó la herramienta local se descartan |
| **después** de `agendar_cita` ok | La reserva se convierte en la cita — mismo id, así que el candado sigue puesto mientras la cita exista |
| **después** de `agendar_cita` rechazada | La franja **se suelta**: no se retiene una hora por una cita que un guardrail impidió crear |

Reservar antes y confirmar después es lo que evita el caso feo (una cita creada
para una hora que otro acababa de ocupar). Soltar en el camino de rechazo evita
el otro (una franja retenida por una cita que nunca existió). Los dos están
cubiertos por pruebas.

Las precondiciones del ejecutor **no se duplican** en el enganche: un `cupo_id`
alucinado por el modelo no llega a escribir en Calendar porque no está en los
cupos ofrecidos del turno, y de eso ya se encargaba `agendar_cita`.

## 6. La agenda del CRM

`GET /api/agenda` devuelve lo que hay en Calendar. El navegador cruza cada
evento con sus conversaciones por `cita_id` y resuelve el nombre. Tres casos:

| Lo que hay en Calendar | Cómo se ve en el CRM |
|---|---|
| Evento con `cita_id` y ficha en el CRM | La cita completa, con paciente, seguro y enlace a su conversación |
| Evento con `cita_id` sin ficha | El estudio, marcado **sin ficha en el CRM** — una cita tomada por teléfono o anterior al sistema |
| Evento sin `cita_id` | **Bloqueo del centro**: ocupa el equipo, no hay paciente detrás |
| Evento `tentative` | **Reserva en curso**: alguien está agendando ahora mismo |

La cabecera de la agenda dice de dónde salen los datos: `Google Calendar`,
`Calendar sin responder` o `Datos locales · demo`. Importa decirlo — una agenda
que parece la del centro y no lo es hace que alguien prometa una hora.

Sin `GCAL_*` configurado nada de esto se activa: el CRM lee lo local y el agente
usa sus herramientas de siempre. No hay condicionales repartidos por el código,
porque `CalendarioMemoria` implementa la misma interfaz.

## 7. La vuelta: cambios hechos en Google

Si la recepción arrastra una cita en Calendar, el CRM tiene que enterarse.

**`events.watch`** abre un canal push a un webhook nuestro. La notificación **no
trae el cambio**: solo avisa, con `X-Goog-Resource-State`. Hay que venir a
listar.

**`syncToken`** hace la lista incremental. Se guarda el `nextSyncToken` y se
manda en la siguiente llamada. Un `410 GONE` significa que caducó: resincronizar
completo, y el módulo lo señala en vez de fallar callado. Se pide
`showDeleted=true` a propósito: una cancelación es el cambio que más importa.

De la vuelta solo se aceptan **cambio de horario y cancelación**. Nadie edita
datos clínicos desde un calendario.

**Conflictos.** Si alguien movió el evento desde que lo leímos, el `PATCH` con
`If-Match: <etag>` devuelve `412` y **no se pisa su cambio**: se marca
`requiere_revision_humana`. Un agente que le gana siempre la carrera a la
persona que está delante del paciente es un agente mal diseñado.

## 8. Puesta en marcha

1. Proyecto en Google Cloud → habilitar **Google Calendar API**.
2. Crear una **cuenta de servicio** y descargar su clave privada JSON.
3. En el Workspace de Open Side, crear **un calendario por sede** (75E y 76E) y
   compartir cada uno con el correo de la cuenta de servicio con permiso de
   **"Hacer cambios en los eventos"**.
4. En el entorno del servidor:

```bash
GCAL_SEDE_75E=xxxxx@group.calendar.google.com
GCAL_SEDE_76E=yyyyy@group.calendar.google.com
GCAL_SA_EMAIL=agenda@openside-xxxx.iam.gserviceaccount.com
GCAL_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…"
# GCAL_SA_SUBJECT=agenda@open-side.com   # solo con delegación de dominio
# GCAL_BASE=http://127.0.0.1:4455        # para apuntar a un doble en pruebas
```

`GCAL_SA_PRIVATE_KEY` es **un secreto**: va en el entorno, nunca en el
repositorio, y se rota como se rota una contraseña.

Autenticación por **service account con JWT RS256**, no OAuth de usuario: nadie
va a reautorizar una pantalla de consentimiento a las 3 de la mañana. Los
permisos son los mínimos, `calendar.events` y `calendar.freebusy`.
Deliberadamente **no** se pide `calendar.readonly`, que daría acceso al
contenido de los eventos ajenos de toda la cuenta.

**Un calendario por sede**, no uno solo: la recepción de la 75E ve su día sin el
ruido de la otra. Si Open Side tiene dos resonancias y un TAC y quiere
agendarlos por separado, el mapeo pasa de sede a equipo y es el mismo código: un
calendario más en la configuración.

## 9. Modos de fallo

| Fallo | Qué hace el sistema | Qué ve el paciente |
|---|---|---|
| Calendar no responde al buscar cupos | **No ofrece nada** y escala a una persona | Que lo atiende alguien del equipo |
| Un calendario no está compartido | Esa sede no se ofrece | Solo horarios de la otra sede |
| La franja se tomó mientras conversaban | El ejecutor no corre; el modelo vuelve a consultar | "Ese horario lo acaban de tomar, ¿te sirve…?" |
| Un guardrail rechaza la cita | La franja se suelta | Lo que corresponda al guardrail |
| `confirmarReserva` falla | La cita es válida y la franja **sigue retenida**: nadie más la toma. Se reintenta fuera del turno | Su cita confirmada |
| Alguien movió el evento en Google | `412` por `If-Match`: no se pisa. Revisión humana | Nada hasta que una persona decida |
| El `syncToken` caducó | Resincronización completa | Nada |

## 10. Qué está hecho y qué falta

**Hecho** — 162 comprobaciones entre las dos suites:

- El candado de franja completo: insertar, reverificar, desempatar, soltar
- Revivir un id borrado en vez de perder la franja para siempre
- Disponibilidad calculada contra Calendar, en hora de Panamá, con margen
- `freeBusy`, `events.insert/patch/delete/list`, `watch`, sync incremental
- Token de service account con JWT RS256, cacheado con 60 s de margen
- Los dos enganches del turno del agente
- `GET /api/agenda` y el CRM leyendo de ahí, con bloqueos y reservas en curso
- `CalendarioMemoria` con la misma interfaz para funcionar sin credenciales
- Una suite de extremo a extremo con veinte reservas simultáneas

**Falta:**

- El webhook receptor de `events.watch` (`POST /api/calendario/notificacion`),
  con verificación del token del canal y proceso asíncrono: Google corta a los
  pocos segundos, igual que Chatwoot (ver `06-integracion-chatwoot.md`)
- La renovación del canal por cron: los canales de Calendar caducan en días
- Un barrido de reservas tentativas huérfanas: si el proceso muere entre
  reservar y confirmar, la franja queda retenida. El evento lleva
  `reserva_desde` justo para eso; falta el trabajo que lo limpia
- La cola de reintento de `confirmarReserva`
- Cancelar y reprogramar desde el CRM (el adaptador ya tiene los métodos; falta
  la interfaz)
- **Probarlo contra la API real.** Todo está verificado contra un doble que
  respeta el contrato de la v3. La primera ejecución contra Google dirá lo que
  la documentación calla: límites de cuota, latencia real de `freeBusy` con dos
  semanas de rejilla, y si el `409` por id duplicado llega tan rápido como
  suponemos bajo carga
