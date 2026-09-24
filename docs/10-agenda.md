# 10 · Agenda de citas

Es el módulo que justifica el sistema. El agente agendaba, pero **no había dónde ver el resultado**: el centro no podía comprobar si la agenda se estaba llenando ni prepararse para el día siguiente.

## El arreglo de raíz

Las citas se guardaban con la fecha **como texto** (`"miércoles 23 de septiembre, 4:30 p.m."`). Sirve para leer en un chat, pero con eso no se puede construir un calendario. Ahora el agente guarda también la marca real:

```js
cita_inicio: "2026-09-25T09:30:00.000Z",   // la fecha como dato
cita_duracion: 25,
cita_sede: "75E",
cita_estudio_id: "rm-columna-lum"
```

El identificador del estudio se guarda aparte del nombre porque **el nombre puede variar y el id no**: así la ficha siempre encuentra la preparación que corresponde.

## Las tres vistas

| Vista | Para qué |
|---|---|
| **Semana** | La foto general: seis columnas (domingo cerrado), el sábado con su franja rayada a partir de las 14:00, hoy destacado |
| **Día** | **Una columna por sede**, que es como se trabaja de verdad: ver las dos salas en paralelo |
| **Lista** | Las próximas citas agrupadas por día, con aseguradora y estado |

En las tres: navegación adelante y atrás, botón *Hoy*, filtro por sede, y una línea roja marcando la hora actual cuando el centro está abierto.

## Lo que se lee de un vistazo

El color del bloque es el estado de la cita, no decoración:

| Color | Estado |
|---|---|
| Verde | Confirmada |
| Ámbar | Falta autorización del seguro o la orden médica |
| Rojo | Screening de resonancia sin aprobar |
| Gris | Ya realizada |

Y las métricas de arriba responden a la pregunta que importa: **cuántas citas, qué ocupación, cuántas tienen algo pendiente, y cuántas las agendó el agente**. Esa última es la que mide si el sistema aporta.

## Dos problemas de calendario que hubo que resolver

**Citas que se pisan.** Dos estudios a la misma hora se tapaban el uno al otro. Se reparte el ancho: se agrupan las citas que se solapan en el tiempo, cada una va a la primera columna libre, y el ancho se divide entre las columnas del grupo. Una comprobación recorre todos los pares de bloques y verifica que **ninguno se superpone** con otro.

**Texto cortado a media línea.** Un estudio de 25 minutos ocupa 25 píxeles: ahí no caben tres líneas. El bloque se adapta a su altura — bajo muestra hora y paciente en una línea, medio quita el estudio, y el detalle completo queda en el tooltip y en la ficha.

## De la conversación a la cita y vuelta

Una cita creada por el agente lleva la etiqueta **bot** en la lista, y su ficha ofrece **abrir la conversación** que la originó. El recorrido completo queda cerrado: el paciente escribe por WhatsApp → el agente agenda → aparece en la agenda → el equipo puede volver a la conversación con un clic.

## Un fallo que encontró la prueba

Los botones de respuesta rápida de mensajes antiguos **seguían activos**. Pulsar un "No" de un consentimiento anterior mandaba al agente a un paso ya superado. Ahora, cuando llega un mensaje nuevo con botones, los anteriores quedan inertes — que es lo que hace WhatsApp con sus botones interactivos.

## Los datos

La agenda combina:
- **Citas reales** creadas por el agente en las conversaciones
- **Una semilla de demostración** de unas 170 citas repartidas en dos semanas, generada una sola vez y guardada, con la densidad de un centro con dos equipos (13–16 al día, menos los sábados)

Sin la semilla la agenda estaría vacía y no se podría enseñar. Se marca como `origen: 'demo'` y las reales como `origen: 'agente'`.

## Pruebas

```bash
npm run test:agenda    # el modelo, sin navegador
```

Comprueba el reparto por día, que el domingo no aparece, la ocupación por sede y que no hay dos citas en la misma sede a la misma hora. En navegador, 22 comprobaciones más: las tres vistas, la ficha, la navegación, el filtro de sede, el enlace con la conversación y que ningún bloque se superpone.

## Google Calendar

La agenda de Open Side vive en Google Calendar. Este módulo la lee de ahí cuando
el servidor tiene `GCAL_*` configurado, y de `localStorage` cuando no. El
candado que impide que dos pacientes se queden con la misma hora —que la API de
Calendar no ofrece— está en [11-google-calendar.md](11-google-calendar.md).
