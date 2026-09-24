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
