/* ============================================================
   Extremo a extremo contra un doble de Google Calendar
   ------------------------------------------------------------
   Las pruebas con fetch inyectado verifican que mandamos lo
   correcto. Esta verifica lo otro: que el protocolo funciona
   cuando hay concurrencia real y un servidor que se comporta como
   Calendar —ids únicos por calendario, 409 en el duplicado,
   freeBusy derivado de los eventos que hay.

   La comprobación central es la última: veinte reservas lanzadas
   a la vez sobre la misma franja, y una sola gana.

   Ejecutar: node server/tests-calendario-e2e.mjs
   ============================================================ */

import http from 'node:http';

let fallos = 0, n = 0;
function ok(cond, nombre, detalle) {
  n++;
  console.log((cond ? '✅' : '❌') + ' ' + nombre);
  if (!cond) { fallos++; if (detalle !== undefined) console.log('   →', typeof detalle === 'string' ? detalle : JSON.stringify(detalle).slice(0, 500)); }
}

/* ------------------------------------------------------------ */
/* Doble de la API de Calendar                                   */
/* ------------------------------------------------------------ */
const calendarios = new Map([['cal75', new Map()], ['cal76', new Map()]]);
let peticiones = 0;

const servidor = http.createServer(async (req, res) => {
  peticiones++;
  const url = new URL(req.url, 'http://x');
  const cuerpo = await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
  const responder = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj || {})); };

  if (url.pathname === '/token') return responder(200, { access_token: 'tok', expires_in: 3600 });

  if (url.pathname === '/calendar/v3/freeBusy') {
    const { timeMin, timeMax, items } = JSON.parse(cuerpo);
    const out = {};
    for (const it of items) {
      const cal = calendarios.get(it.id);
      if (!cal) { out[it.id] = { errors: [{ reason: 'notFound' }] }; continue; }
      out[it.id] = { busy: [...cal.values()]
        .filter(e => e.status !== 'cancelled' && e.transparency !== 'transparent')
        .map(e => ({ start: e.start.dateTime, end: e.end.dateTime }))
        .filter(b => new Date(b.end) > new Date(timeMin) && new Date(b.start) < new Date(timeMax)) };
    }
    return responder(200, { calendars: out });
  }

  const m = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
  if (!m) return responder(404, { error: { message: 'ruta desconocida' } });
  const cal = calendarios.get(decodeURIComponent(m[1]));
  if (!cal) return responder(404, { error: { message: 'calendario no existe' } });
  const id = m[2];

  if (req.method === 'POST' && !id) {
    const ev = JSON.parse(cuerpo);
    /* La garantía de Google sobre la que se construye el candado:
       el id es único dentro del calendario. */
    if (cal.has(ev.id)) return responder(409, { error: { message: 'The requested identifier already exists.' } });
    cal.set(ev.id, { ...ev, etag: `"${Math.random().toString(36).slice(2)}"` });
    return responder(200, cal.get(ev.id));
  }
  if (req.method === 'GET' && id) {
    if (!cal.has(id)) return responder(404, {});
    return responder(200, cal.get(id));
  }
  if (req.method === 'PATCH' && id) {
    if (!cal.has(id)) return responder(404, {});
    cal.set(id, { ...cal.get(id), ...JSON.parse(cuerpo) });
    return responder(200, cal.get(id));
  }
  if (req.method === 'DELETE' && id) {
    if (!cal.has(id)) return responder(410, {});
    cal.delete(id);
    return responder(204);
  }
  if (req.method === 'GET' && !id) {
    const timeMin = new Date(url.searchParams.get('timeMin'));
    const timeMax = new Date(url.searchParams.get('timeMax'));
    const items = [...cal.values()].filter(e =>
      new Date(e.end.dateTime) > timeMin && new Date(e.start.dateTime) < timeMax);
    return responder(200, { items, nextSyncToken: 'tok-' + cal.size });
  }
  return responder(405, {});
});

await new Promise(r => servidor.listen(0, r));
const puerto = servidor.address().port;
process.env.GCAL_BASE = `http://127.0.0.1:${puerto}`;
process.env.GCAL_OAUTH = `http://127.0.0.1:${puerto}/token`;
process.env.GCAL_SEDE_75E = 'cal75';
process.env.GCAL_SEDE_76E = 'cal76';

/* El módulo lee GCAL_BASE al cargarse, así que se importa después. */
const { CalendarioGoogle, idReservaDeFranja, horaPanama, antesDeCalendario, despuesDeCalendario } =
  await import('./calendario.js');

const cal = new CalendarioGoogle({
  calendarios: { '75E': 'cal75', '76E': 'cal76' },
  token: async () => 'tok'
});

const AHORA = Date.now();
const DESDE = new Date(AHORA + 3 * 864e5).toISOString().slice(0, 10);

/* ============================================================ */
console.log('\n— Disponibilidad contra un calendario vivo —');

let d = await cal.disponibilidad({ duracionMin: 45, desde: DESDE, limite: 3, ahora: AHORA });
ok(d.ok && d.cupos.length === 3, 'con el calendario vacío ofrece tres cupos', d.cupos && d.cupos.length);
ok(d.cupos.every(c => { const h = horaPanama(c.inicio); return h.dia !== 0 && h.hora >= 7; }),
   'todos dentro del horario del centro');

const elegido = d.cupos[0];
const r1 = await cal.reservar({ sede: elegido.sede, inicio: elegido.inicio, duracionMin: 45 });
ok(r1.ok, 'se retiene la primera franja', r1);

d = await cal.disponibilidad({ duracionMin: 45, desde: DESDE, limite: 3, ahora: AHORA });
ok(!d.cupos.some(c => c.cupo_id === elegido.cupo_id),
   'la franja retenida deja de ofrecerse: freeBusy ya la ve ocupada');

await cal.liberar({ sede: elegido.sede, inicio: elegido.inicio });
d = await cal.disponibilidad({ duracionMin: 45, desde: DESDE, limite: 3, ahora: AHORA });
ok(d.cupos.some(c => c.cupo_id === elegido.cupo_id), 'al liberarla vuelve a estar disponible');

/* ============================================================ */
console.log('\n— La reserva se convierte en cita —');

await cal.reservar({ sede: elegido.sede, inicio: elegido.inicio, duracionMin: 45 });
const conf = await cal.confirmarReserva({
  sede: elegido.sede, inicio: elegido.inicio,
  cita: { cita_id: 'OS-2026-09001', estudio: 'RM de rodilla', estudio_id: 'rm-rodilla',
          duracion_min: 45, paciente: 'Ana Sofía Vargas', telefono: '+507 6000-0000' }
});
ok(conf.ok, 'la retención pasa a cita', conf);
ok(conf.evento_id === idReservaDeFranja(elegido.sede, elegido.inicio),
   'sin cambiar de id: el candado sigue puesto mientras exista la cita');

const guardado = [...calendarios.get('cal75').values(), ...calendarios.get('cal76').values()]
  .find(e => e.id === conf.evento_id);
ok(guardado.status === 'confirmed', 'y deja de ser tentativa');
ok(!JSON.stringify(guardado).includes('Ana Sofía'), 'el nombre del paciente no llegó al calendario');
ok(!JSON.stringify(guardado).includes('6000-0000'), 'ni el teléfono');
ok(guardado.extendedProperties.private.cita_id === 'OS-2026-09001', 'la referencia sí, para poder cruzarla');

const citas = await cal.citasEntre({
  desde: new Date(AHORA).toISOString(), hasta: new Date(AHORA + 20 * 864e5).toISOString()
});
const mia = citas.find(c => c.cita_id === 'OS-2026-09001');
ok(Boolean(mia), 'la agenda del CRM la encuentra en el calendario');
ok(mia.duracion_min === 45 && mia.sede === elegido.sede, 'con su duración y su sede', mia);

/* ============================================================ */
console.log('\n— Un bloqueo puesto a mano gana —');

const libre = (await cal.disponibilidad({ duracionMin: 45, desde: DESDE, limite: 5, ahora: AHORA })).cupos
  .find(c => c.sede === '76E');
/* Alguien crea a mano un evento que solapa a medias: no comparte
   el id de la franja, así que el 409 no lo detecta. */
calendarios.get('cal76').set('bloqueomanual', {
  id: 'bloqueomanual', summary: 'Mantenimiento equipo', status: 'confirmed',
  start: { dateTime: new Date(new Date(libre.inicio).getTime() + 15 * 60000).toISOString() },
  end:   { dateTime: new Date(new Date(libre.inicio).getTime() + 90 * 60000).toISOString() }
});
const rMan = await cal.reservar({ sede: '76E', inicio: libre.inicio, duracionMin: 45 });
ok(rMan.ok === false && rMan.motivo === 'bloqueo_del_centro',
   'el solape parcial lo caza la reverificación, no el 409', rMan);
ok(!calendarios.get('cal76').has(idReservaDeFranja('76E', libre.inicio)),
   'y la retención se soltó: no queda basura en el calendario');
calendarios.get('cal76').delete('bloqueomanual');

/* ============================================================ */
console.log('\n— Veinte reservas simultáneas de la misma hora —');

const objetivo = (await cal.disponibilidad({ duracionMin: 45, desde: DESDE, limite: 8, ahora: AHORA })).cupos
  .find(c => c.sede === '75E');
const antes = peticiones;
const intentos = await Promise.all(Array.from({ length: 20 }, () =>
  cal.reservar({ sede: '75E', inicio: objetivo.inicio, duracionMin: 45 })));
const ganadores = intentos.filter(x => x.ok);

ok(ganadores.length === 1, `exactamente una reserva gana (ganaron ${ganadores.length})`,
   intentos.map(x => x.ok ? 'OK' : x.motivo || x.error));
ok(intentos.filter(x => !x.ok).every(x => x.error === 'FRANJA_TOMADA'),
   'las otras diecinueve reciben FRANJA_TOMADA, que el agente sabe manejar');
ok(calendarios.get('cal75').has(idReservaDeFranja('75E', objetivo.inicio)),
   'y en el calendario queda un solo evento para esa franja');
console.log(`   (${peticiones - antes} peticiones al doble de la API)`);

/* Solapamiento parcial entre dos reservas nuestras: ids distintos,
   así que el 409 no las separa. Las separa el desempate. */
const a = objetivo.inicio;
const b = new Date(new Date(a).getTime() + 15 * 60000).toISOString();
await cal.liberar({ sede: '75E', inicio: a });
const cruzadas = await Promise.all([
  cal.reservar({ sede: '75E', inicio: a, duracionMin: 45 }),
  cal.reservar({ sede: '75E', inicio: b, duracionMin: 45 })
]);
ok(cruzadas.filter(x => x.ok).length === 1,
   'dos estudios que se solapan a medias tampoco caben los dos',
   cruzadas.map(x => x.ok ? 'OK' : x.motivo));

/* ============================================================ */
console.log('\n— El turno del agente, de punta a punta —');

const franja = (await cal.disponibilidad({ duracionMin: 25, desde: DESDE, limite: 3, ahora: AHORA })).cupos[0];
const st = { cupos: [{ cupo_id: franja.cupo_id, inicio: franja.inicio, sede: franja.sede, duracion_min: 25 }], cita: {} };
const trace = { tools: [], guardrails: [] };

let previo = await antesDeCalendario('agendar_cita', { cupo_id: franja.cupo_id, estudio_id: 'rm-rodilla' }, st, cal, trace);
ok(previo === null && st.reserva, 'antes de ejecutar, la franja queda retenida');

/* Un guardrail rechaza: la franja tiene que volver */
let res = await despuesDeCalendario('agendar_cita', {}, { ok: false, error: 'SIN_CONSENTIMIENTO' }, st, cal, trace);
ok(res.error === 'SIN_CONSENTIMIENTO', 'el rechazo llega intacto');
ok(!calendarios.get(franja.sede === '75E' ? 'cal75' : 'cal76').has(franja.cupo_id),
   'y la hora vuelve a la agenda: no se retiene por una cita que no existió');

/* Ahora sí */
st.cupos = [{ cupo_id: franja.cupo_id, inicio: franja.inicio, sede: franja.sede, duracion_min: 25 }];
previo = await antesDeCalendario('agendar_cita', { cupo_id: franja.cupo_id, estudio_id: 'rm-rodilla' }, st, cal, trace);
res = await despuesDeCalendario('agendar_cita', {},
  { ok: true, cita_id: 'OS-2026-09002', estudio: 'RM de rodilla', estudio_id: 'rm-rodilla',
    inicio: franja.inicio, duracion_min: 25, sede: franja.sede, paciente: 'Omar Jaén' },
  st, cal, trace);
ok(res.google_evento_id === franja.cupo_id, 'la cita queda escrita en Calendar', res.google_evento_id);
ok(st.cita.googleEventoId === franja.cupo_id, 'y el CRM recibe el identificador del evento');

const finales = await cal.citasEntre({
  desde: new Date(AHORA).toISOString(), hasta: new Date(AHORA + 20 * 864e5).toISOString()
});
ok(finales.some(c => c.cita_id === 'OS-2026-09002'), 'y aparece en la agenda del centro');
ok(finales.every(c => !String(c.titulo || '').includes('Jaén')), 'sin el apellido del paciente, en ninguna');

/* ============================================================ */
console.log(`\n${n - fallos}/${n} comprobaciones pasaron`);
servidor.close();
process.exit(fallos ? 1 : 0);
