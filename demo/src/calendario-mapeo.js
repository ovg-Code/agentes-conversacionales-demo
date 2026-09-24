/* ============================================================
   Mapeo cita <-> evento de calendario · funciones puras
   ------------------------------------------------------------
   Vive en demo/src/ por una razón práctica: lo usan los dos
   lados. El servidor (server/calendario.js) para escribir en
   Google Calendar, y el CRM para mostrar en la ficha de la cita
   qué se sincronizaría y con qué identificador, sin inventar nada.

   Aquí está la regla de privacidad que hace el sistema defendible
   ante la Ley 81 de 2019: lo que sale hacia un calendario de un
   tercero no lleva nombre, teléfono, cédula ni aseguradora. Solo
   el estudio y la referencia de la cita. Si esta regla se rompe,
   la rompe una prueba (server/tests-calendario.mjs).
   ============================================================ */

export const ZONA = 'America/Panama';   // UTC-5 todo el año: Panamá no usa horario de verano

/* Google acepta ids de evento en base32hex: [a-v0-9], 5 a 1024
   caracteres. Derivarlo del cita_id da idempotencia gratis: el
   segundo insert de la misma cita devuelve 409 en vez de duplicar. */
export function idEventoDesdeCita(citaId) {
  const limpio = String(citaId ?? '').toLowerCase().replace(/[^a-v0-9]/g, '');
  if (limpio.length < 5) throw new Error('CITA_ID_DEMASIADO_CORTO');
  return limpio.slice(0, 1024);
}

/* El título es lo que se ve en el teléfono de cualquiera con acceso
   al calendario. Por eso no lleva nombre, cédula ni teléfono. */
export function tituloEvento(cita) {
  return `${cita.estudio || cita.estudio_id || cita.estudioId || 'Estudio'} · ${cita.cita_id || cita.id}`;
}

export function eventoDesdeCita(cita) {
  if (!cita || !cita.cita_id || !cita.inicio) throw new Error('CITA_INCOMPLETA');
  const fin = new Date(new Date(cita.inicio).getTime() + (cita.duracion_min || 30) * 60000);
  return {
    id: idEventoDesdeCita(cita.cita_id),
    summary: tituloEvento(cita),
    description: [
      'Cita gestionada por el sistema de Open Side.',
      'Los datos del paciente están en el CRM, no en este calendario.',
      `Referencia: ${cita.cita_id}`
    ].join('\n'),
    start: { dateTime: new Date(cita.inicio).toISOString(), timeZone: ZONA },
    end:   { dateTime: fin.toISOString(), timeZone: ZONA },
    status: cita.estado === 'cancelada' ? 'cancelled' : 'confirmed',
    transparency: 'opaque',              // ocupa: cuenta en freeBusy
    visibility: 'private',
    extendedProperties: {
      private: {
        cita_id: cita.cita_id,
        sede: cita.sede || '',
        estudio_id: cita.estudio_id || '',
        modalidad: cita.modalidad || '',
        origen: cita.origen || 'agente-openside'
      }
    }
  };
}

/* La vuelta: un evento tocado en Google se traduce a un parche de
   cita. Solo aceptamos cambios de horario y cancelaciones; nadie
   edita datos clínicos desde un calendario. */
export function citaDesdeEvento(ev) {
  const priv = (ev.extendedProperties && ev.extendedProperties.private) || {};
  const citaId = priv.cita_id || null;
  const inicio = (ev.start && (ev.start.dateTime || ev.start.date)) || null;
  const fin = (ev.end && (ev.end.dateTime || ev.end.date)) || null;
  return {
    cita_id: citaId,
    ajeno: !citaId,                       // bloqueo creado a mano en Google
    cancelada: ev.status === 'cancelled',
    inicio: inicio ? new Date(inicio).toISOString() : null,
    duracion_min: inicio && fin ? Math.round((new Date(fin) - new Date(inicio)) / 60000) : null,
    etag: ev.etag || null,
    titulo: ev.summary || null
  };
}

/* Resta de los cupos las franjas ocupadas. Dos intervalos chocan si
   uno empieza antes de que el otro termine, por los dos lados.
   Un bloqueo que empieza justo cuando el cupo acaba no lo invalida. */
export function filtrarCuposOcupados(cupos, ocupado = []) {
  const bloques = ocupado.map(b => [new Date(b.start).getTime(), new Date(b.end).getTime()]);
  return cupos.filter(c => {
    const ini = new Date(c.inicio).getTime();
    const fin = ini + (c.duracion_min || 30) * 60000;
    return !bloques.some(([bi, bf]) => ini < bf && bi < fin);
  });
}

/* ============================================================
   Modo "la agenda es Calendar"
   ------------------------------------------------------------
   Cuando Google Calendar deja de ser un espejo y pasa a ser el
   sistema real, aparece el problema que su API no resuelve: no
   hay reservas. Dos pacientes pueden quedarse con las 7:30 del
   martes y ninguna llamada falla.

   La primitiva que sí existe es que **el id de un evento es único
   dentro de un calendario**. Si el id se deriva de la franja —no
   de la cita— entonces dos reservas simultáneas del mismo inicio
   chocan en el mismo id y Google devuelve 409 a la segunda. Eso
   es un compare-and-set atómico, y es el candado.

   No cubre los solapamientos parciales (un estudio de 45 min a
   las 7:00 y otro de 25 a las 7:30 tienen ids distintos), así que
   el candado va acompañado de una reverificación. El protocolo
   completo está en server/calendario.js → reservar().
   ============================================================ */

import { HORARIO } from './kb.js';

/* Base32hex usa exactamente los dígitos 0-9 y las letras a-v, que
   es el alfabeto que Google acepta: Number#toString(32) sirve tal
   cual. Los minutos desde la época dan un id corto y estable. */
export function idReservaDeFranja(sede, inicio) {
  const s = String(sede).toLowerCase().replace(/[^a-v0-9]/g, '');
  const minutos = Math.floor(new Date(inicio).getTime() / 60000);
  const id = `r${s}${minutos.toString(32)}`;
  if (id.length < 5) throw new Error('ID_RESERVA_INVALIDO');
  return id;
}

/* ¿Es nuestro o lo puso una persona a mano? Un evento ajeno
   siempre gana: quien está delante del paciente manda. */
export function esNuestro(ev) {
  const priv = (ev.extendedProperties && ev.extendedProperties.private) || {};
  return priv.origen === 'agente-openside' || Boolean(priv.cita_id);
}

/* Evento tentativo: retiene la franja mientras el paciente decide.
   Sin datos del paciente, igual que el confirmado. */
export function eventoReserva({ sede, inicio, duracionMin, estudioId }) {
  const fin = new Date(new Date(inicio).getTime() + duracionMin * 60000);
  return {
    id: idReservaDeFranja(sede, inicio),
    summary: 'Reserva en curso · Open Side',
    description: 'Franja retenida mientras se completa el agendamiento. Si sigue aquí pasados 15 minutos, se puede borrar.',
    start: { dateTime: new Date(inicio).toISOString(), timeZone: ZONA },
    end:   { dateTime: fin.toISOString(), timeZone: ZONA },
    status: 'tentative',
    transparency: 'opaque',
    visibility: 'private',
    extendedProperties: { private: {
      origen: 'agente-openside',
      sede: String(sede),
      estudio_id: estudioId || '',
      reserva_desde: new Date().toISOString()
    } }
  };
}

/* ------------------------------------------------------------
   Rejilla de franjas candidatas
   ------------------------------------------------------------
   Con Calendar como agenda, la disponibilidad ya no se inventa:
   se parte del horario real del centro y se le resta lo ocupado.
   Esta función produce el "antes"; la resta la hace freeBusy.

   Paso de 15 minutos y no de 30: una RM de 25 min encajaría mal
   en una rejilla de media hora y se perderían huecos reales.
   ------------------------------------------------------------ */
/* Panamá es UTC-5 todo el año, sin horario de verano. Eso permite
   convertir con una resta en vez de arrastrar una librería de zonas
   —y, sobre todo, evita depender del TZ del servidor, que en un
   contenedor es UTC y colocaría las 7:00 de la mañana a las 2:00. */
const OFFSET_PANAMA_MIN = -5 * 60;
const aPanama = (instante) => new Date(new Date(instante).getTime() + OFFSET_PANAMA_MIN * 60000);
const desdePanama = (civil) => new Date(civil.getTime() - OFFSET_PANAMA_MIN * 60000);

export function generarFranjas({
  desde, dias = 14, duracionMin = 30, paso = 15,
  preferencia = 'cualquiera', sedes = ['75E', '76E'],
  horario = HORARIO, ahora = Date.now(), margenMin = 120
} = {}) {
  const franjas = [];
  /* El calendario civil se recorre en hora de Panamá: el día de la
     semana y la hora de apertura son los del centro, no los del
     servidor. Las marcas resultantes vuelven a UTC. */
  /* Un 'YYYY-MM-DD' es un día del centro, no un instante UTC: si se
     interpretara como instante, "desde el 5" empezaría el 4 a las
     7 de la tarde y devolvería un día de más. */
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(desde))
    ? new Date(`${desde}T00:00:00.000Z`)
    : aPanama(desde || ahora);
  base.setUTCHours(0, 0, 0, 0);
  /* Nadie agenda una resonancia para dentro de veinte minutos: hace
     falta llegar, registrarse y, si toca, ayunar. */
  const minimo = ahora + margenMin * 60000;

  for (let d = 0; d < dias; d++) {
    const dia = new Date(base);
    dia.setUTCDate(dia.getUTCDate() + d);
    const rango = horario.dias[dia.getUTCDay()];
    if (!rango) continue;                       // domingo cerrado
    const [abre, cierra] = rango;

    for (let min = abre * 60; min + duracionMin <= cierra * 60; min += paso) {
      const hora = Math.floor(min / 60);
      if (preferencia === 'manana' && hora >= 12) continue;
      if (preferencia === 'tarde' && hora < 12) continue;
      const civil = new Date(dia);
      civil.setUTCHours(hora, min % 60, 0, 0);
      const inicio = desdePanama(civil);
      if (inicio.getTime() < minimo) continue;
      for (const sede of sedes) {
        franjas.push({ inicio: inicio.toISOString(), duracion_min: duracionMin, sede });
      }
    }
  }
  return franjas;
}

/* Hora civil panameña de una marca, para etiquetas y pruebas. */
export function horaPanama(instante) {
  const c = aPanama(instante);
  return { dia: c.getUTCDay(), hora: c.getUTCHours(), minuto: c.getUTCMinutes(),
           fecha: c.toISOString().slice(0, 10) };
}

/* ------------------------------------------------------------
   Etiquetas en hora del centro
   ------------------------------------------------------------
   No se puede reutilizar el formateador de tools.js: usa la hora
   local del proceso, que en el servidor es UTC. Una cita de las
   7:00 a.m. se le anunciaría al paciente como las 12:00.
   ------------------------------------------------------------ */
const DIAS_PA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_PA = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

function doceHoras(hora, minuto) {
  const h = hora % 12 === 0 ? 12 : hora % 12;
  return { h, min: String(minuto).padStart(2, '0'), ampm: hora < 12 ? 'a.m.' : 'p.m.' };
}

export function etiquetaPanama(instante) {
  const c = aPanama(instante);
  const { h, min, ampm } = doceHoras(c.getUTCHours(), c.getUTCMinutes());
  return `${DIAS_PA[c.getUTCDay()]} ${c.getUTCDate()} de ${MESES_PA[c.getUTCMonth()]}, ${h}:${min} ${ampm}`;
}

export function etiquetaCortaPanama(instante) {
  const c = aPanama(instante);
  const { h, min, ampm } = doceHoras(c.getUTCHours(), c.getUTCMinutes());
  return `${DIAS_PA[c.getUTCDay()].slice(0, 3)} ${c.getUTCDate()} · ${h}:${min}${ampm === 'a.m.' ? 'am' : 'pm'}`;
}
