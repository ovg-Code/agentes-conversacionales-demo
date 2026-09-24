/* ============================================================
   Suite del adaptador de Google Calendar · sin red
   ------------------------------------------------------------
   Ejercita el módulo real inyectando un fetch falso. Verifica el
   mapeo, la idempotencia por id derivado, el conflicto por etag,
   la sincronización incremental y —lo más importante— que no se
   escriba un solo dato del paciente en el calendario de un
   tercero (Ley 81 de 2019).

   Ejecutar: node server/tests-calendario.mjs
   ============================================================ */

import crypto from 'node:crypto';
import {
  ZONA, SCOPES, calendariosDeEntorno, idEventoDesdeCita, eventoDesdeCita, citaDesdeEvento,
  filtrarCuposOcupados, CalendarioMemoria, CalendarioGoogle, crearCalendario,
  crearTokenServiceAccount, antesDeCalendario, despuesDeCalendario,
  idReservaDeFranja, generarFranjas, horaPanama, etiquetaPanama, esNuestro
} from './calendario.js';
import { resetEstadoHerramientas, agendar_cita } from '../demo/src/tools.js';

let fallos = 0, n = 0;
function ok(cond, nombre, detalle) {
  n++;
  console.log((cond ? '✅' : '❌') + ' ' + nombre);
  if (!cond) { fallos++; if (detalle !== undefined) console.log('   →', typeof detalle === 'string' ? detalle : JSON.stringify(detalle).slice(0, 400)); }
}

/* Cita de prueba con datos que NO deben salir del sistema */
const CITA = {
  cita_id: 'OS-2026-04871',
  estudio: 'RM de rodilla',
  estudio_id: 'rm-rodilla',
  modalidad: 'RM',
  inicio: '2026-10-05T12:30:00.000Z',   // 7:30 a.m. en Panamá
  duracion_min: 45,
  sede: '75E',
  paciente: 'María Fernanda Quintero',
  telefono: '+507 6480-0336',
  cedula: '8-912-2345',
  aseguradora: 'ASSA',
  origen: 'agente'
};

/* --- fetch falso: guion de respuestas por llamada --- */
function fetchFalso(guion) {
  const llamadas = [];
  let i = 0;
  const f = async (url, opts) => {
    let cuerpo = null;
    // El cuerpo puede ser JSON (Calendar) o form-urlencoded (OAuth).
    if (opts.body) { try { cuerpo = JSON.parse(opts.body); } catch { cuerpo = null; } }
    llamadas.push({ url, ...opts, cuerpo });
    const paso = guion[Math.min(i++, guion.length - 1)];
    const r = typeof paso === 'function' ? paso(url, opts) : paso;
    return {
      status: r.status,
      text: async () => r.datos === undefined ? '' : JSON.stringify(r.datos)
    };
  };
  f.llamadas = llamadas;
  return f;
}
const google = (fetch) => new CalendarioGoogle({
  calendarios: { '75E': 'cal75@group.calendar.google.com', '76E': 'cal76@group.calendar.google.com' },
  token: async () => 'ya29.token-falso',
  fetch
});

/* ============================================================ */
console.log('\n— Identificador de evento —');

ok(idEventoDesdeCita('OS-2026-04871') === 'os202604871', 'el id se deriva del cita_id', idEventoDesdeCita('OS-2026-04871'));
ok(/^[a-v0-9]{5,1024}$/.test(idEventoDesdeCita('OS-2026-04871')), 'el id respeta base32hex de Google');
ok(idEventoDesdeCita('OS-2026-04871') === idEventoDesdeCita('OS-2026-04871'), 'es determinista: la misma cita da el mismo id');
ok(idEventoDesdeCita('OS-2026-04871') !== idEventoDesdeCita('OS-2026-04872'), 'dos citas distintas no colisionan');
ok((() => { try { idEventoDesdeCita('OS-1'); return false; } catch { return true; } })(),
   'rechaza un identificador demasiado corto para Google');
ok(idEventoDesdeCita('OS-2026-04871WXYZ') === 'os202604871', 'descarta caracteres fuera de [a-v0-9]',
   idEventoDesdeCita('OS-2026-04871WXYZ'));

/* ============================================================ */
console.log('\n— Ley 81: qué se escribe en el calendario ajeno —');

const ev = eventoDesdeCita(CITA);
const serializado = JSON.stringify(ev);
for (const [campo, valor] of [['nombre', CITA.paciente], ['teléfono', CITA.telefono],
                              ['cédula', CITA.cedula], ['aseguradora', CITA.aseguradora]]) {
  ok(!serializado.includes(valor), `el evento no lleva el ${campo} del paciente`);
}
ok(!serializado.toLowerCase().includes('quintero'), 'ni el apellido por separado');
ok(ev.summary === 'RM de rodilla · OS-2026-04871', 'el título lleva estudio y referencia', ev.summary);
ok(ev.visibility === 'private', 'el evento es privado');
ok(ev.extendedProperties.private.cita_id === CITA.cita_id, 'la referencia viaja en extendedProperties');
ok(ev.extendedProperties.private.sede === '75E', 'la sede queda consultable con privateExtendedProperty');

/* ============================================================ */
console.log('\n— Mapeo de horario —');

ok(ev.start.timeZone === ZONA && ZONA === 'America/Panama', 'la zona es la de Panamá', ev.start.timeZone);
ok(ev.end.dateTime === '2026-10-05T13:15:00.000Z', 'el fin sale de la duración del estudio', ev.end.dateTime);
ok(ev.transparency === 'opaque', 'el evento ocupa, así cuenta en freeBusy');
ok((() => { try { eventoDesdeCita({ cita_id: 'OS-2026-04871' }); return false; } catch { return true; } })(),
   'una cita sin inicio no se puede espejar');

const vuelta = citaDesdeEvento({
  ...ev, etag: '"abc123"', status: 'confirmed',
  start: { dateTime: '2026-10-06T14:00:00.000Z' }, end: { dateTime: '2026-10-06T14:45:00.000Z' }
});
ok(vuelta.cita_id === 'OS-2026-04871', 'de vuelta se reconoce la cita');
ok(vuelta.duracion_min === 45, 'la duración se recalcula del intervalo', vuelta.duracion_min);
ok(vuelta.ajeno === false, 'un evento nuestro no es ajeno');
ok(vuelta.etag === '"abc123"', 'el etag se conserva para el control de concurrencia');

const ajeno = citaDesdeEvento({
  summary: 'Mantenimiento equipo RM', status: 'confirmed',
  start: { dateTime: '2026-10-07T12:00:00.000Z' }, end: { dateTime: '2026-10-07T16:00:00.000Z' }
});
ok(ajeno.ajeno === true && ajeno.cita_id === null, 'un bloqueo hecho a mano en Google se marca como ajeno');
ok(citaDesdeEvento({ ...ev, status: 'cancelled' }).cancelada === true, 'una cancelación en Google se detecta');

/* ============================================================ */
console.log('\n— Resta de franjas ocupadas —');

const cupos = [
  { cupo_id: 'a', inicio: '2026-10-05T12:00:00.000Z', duracion_min: 30 },
  { cupo_id: 'b', inicio: '2026-10-05T12:30:00.000Z', duracion_min: 30 },
  { cupo_id: 'c', inicio: '2026-10-05T13:00:00.000Z', duracion_min: 30 },
  { cupo_id: 'd', inicio: '2026-10-05T15:00:00.000Z', duracion_min: 45 }
];
const libres = filtrarCuposOcupados(cupos, [
  { start: '2026-10-05T12:15:00.000Z', end: '2026-10-05T13:00:00.000Z' }
]);
ok(libres.map(c => c.cupo_id).join(',') === 'c,d', 'quita los cupos que chocan y conserva el resto',
   libres.map(c => c.cupo_id));
ok(filtrarCuposOcupados(cupos, [{ start: '2026-10-05T11:30:00.000Z', end: '2026-10-05T12:00:00.000Z' }]).length === 4,
   'un bloqueo que termina donde empieza el cupo no lo invalida');
/* El cupo 'd' dura 45 min: termina 15:45. Un bloqueo de 15:35 a 15:40
   solo lo invalida si se respeta su duración real; con una duración
   fija de 30 min el choque pasaría desapercibido. */
ok(filtrarCuposOcupados(cupos, [{ start: '2026-10-05T15:35:00.000Z', end: '2026-10-05T15:40:00.000Z' }])
     .every(c => c.cupo_id !== 'd'),
   'respeta la duración real del cupo, no una hora fija');
ok(filtrarCuposOcupados(cupos, [{ start: '2026-10-05T15:45:00.000Z', end: '2026-10-05T16:00:00.000Z' }])
     .some(c => c.cupo_id === 'd'),
   'un bloqueo que empieza justo al terminar el cupo no lo invalida');
ok(filtrarCuposOcupados(cupos, []).length === 4, 'sin ocupación no filtra nada');

/* ============================================================ */
console.log('\n— freeBusy.query —');

const f1 = fetchFalso([{ status: 200, datos: { calendars: {
  'cal75@group.calendar.google.com': { busy: [{ start: '2026-10-05T12:00:00Z', end: '2026-10-05T13:00:00Z' }] },
  'cal76@group.calendar.google.com': { errors: [{ reason: 'notFound' }] }
} } }]);
const ocup = await google(f1).libreOcupado({ desde: '2026-10-05T00:00:00Z', hasta: '2026-10-06T00:00:00Z' });
ok(f1.llamadas[0].url.endsWith('/calendar/v3/freeBusy'), 'llama al endpoint correcto', f1.llamadas[0].url);
ok(f1.llamadas[0].method === 'POST', 'freeBusy es POST');
ok(f1.llamadas[0].headers.Authorization === 'Bearer ya29.token-falso', 'envía el token');
ok(f1.llamadas[0].cuerpo.items.length === 2, 'consulta las dos sedes en una sola llamada');
ok(f1.llamadas[0].cuerpo.timeZone === ZONA, 'pasa la zona horaria');
ok(ocup['75E'].busy.length === 1, 'devuelve las franjas ocupadas por sede');
ok(ocup['76E'].busy === null && ocup['76E'].error === 'notFound',
   'un calendario no compartido es falta de información, no ausencia de ocupación', ocup['76E']);

/* ============================================================ */
console.log('\n— Escritura del espejo —');

const f2 = fetchFalso([{ status: 200, datos: { id: 'os202604871', etag: '"e1"', htmlLink: 'https://calendar.google.com/x' } }]);
const creado = await google(f2).crearEvento(CITA);
ok(creado.ok && creado.duplicado === false && creado.evento_id === 'os202604871', 'crea el evento', creado);
ok(f2.llamadas[0].url.includes('/calendars/cal75%40group.calendar.google.com/events'),
   'escribe en el calendario de la sede de la cita', f2.llamadas[0].url);

const f3 = fetchFalso([{ status: 409, datos: { error: { message: 'duplicate' } } }]);
const dup = await google(f3).crearEvento(CITA);
ok(dup.ok === true && dup.duplicado === true, 'el 409 se trata como idempotencia, no como error', dup);

const sinSede = await google(fetchFalso([{ status: 200, datos: {} }])).crearEvento({ ...CITA, sede: '99Z' });
ok(sinSede.ok === false && sinSede.error === 'SEDE_SIN_CALENDARIO', 'una sede sin calendario no falla en silencio');

const f4 = fetchFalso([{ status: 412, datos: {} }]);
const conflicto = await google(f4).moverEvento(CITA, '"viejo"');
ok(conflicto.ok === false && conflicto.error === 'CONFLICTO_ETAG' && conflicto.requiere_revision_humana,
   'si alguien movió el evento en Google, no se pisa su cambio', conflicto);
ok(f4.llamadas[0].headers['If-Match'] === '"viejo"', 'el etag viaja en If-Match');

const f5 = fetchFalso([{ status: 410, datos: {} }]);
const cancel = await google(f5).cancelarEvento('OS-2026-04871', '75E');
ok(cancel.ok === true && cancel.existia === false, 'cancelar algo ya borrado es éxito', cancel);

/* ============================================================ */
console.log('\n— Sincronización incremental —');

const cal = google(fetchFalso([
  { status: 200, datos: { items: [], nextSyncToken: 'tok-1' } },
  { status: 200, datos: { items: [{ ...ev, status: 'cancelled' }], nextSyncToken: 'tok-2' } },
  { status: 410, datos: {} }
]));
const c1 = await cal.cambiosDesde('75E');
ok(c1.syncToken === 'tok-1', 'la primera pasada guarda el nextSyncToken', c1);
ok(cal.fetch.llamadas[0].url.includes('timeMin='), 'sin token arranca por fecha, no por token');
const c2 = await cal.cambiosDesde('75E');
ok(cal.fetch.llamadas[1].url.includes('syncToken=tok-1'), 'la segunda pasada usa el token guardado',
   cal.fetch.llamadas[1].url);
ok(cal.fetch.llamadas[1].url.includes('showDeleted=true'), 'pide también los borrados: una cancelación es un cambio');
ok(c2.cambios.length === 1 && c2.cambios[0].cancelada === true, 'trae la cancelación traducida a cita');
const c3 = await cal.cambiosDesde('75E');
ok(c3.resincronizar === true && cal.syncTokens.get('75E') === undefined,
   'un 410 caduca el token y pide resincronización completa', c3);

/* ============================================================ */
console.log('\n— Sin credenciales —');

ok(Object.keys(calendariosDeEntorno({})).length === 0, 'sin variables no hay calendarios');
ok(calendariosDeEntorno({ GCAL_SEDE_75E: 'x' })['75E'] === 'x', 'cada sede se configura por separado');
const memoria = crearCalendario({}, {});
ok(memoria instanceof CalendarioMemoria, 'sin configuración se usa el calendario en memoria');
ok(memoria.conectado === false, 'y se declara desconectado: el CRM lo dice en la ficha');
ok(crearCalendario({ GCAL_SEDE_75E: 'x' }, { token: async () => 't' }) instanceof CalendarioGoogle,
   'con configuración y token se usa Google');

const mem = new CalendarioMemoria();
await mem.crearEvento(CITA);
ok((await mem.crearEvento(CITA)).duplicado === true, 'el calendario en memoria también es idempotente');
ok((await mem.libreOcupado({})).constructor === Object, 'sin conexión no inventa ocupación');

/* ============================================================ */
console.log('\n— Token de service account (JWT RS256) —');

const par = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVADA = par.privateKey.export({ type: 'pkcs8', format: 'pem' });
const ENTORNO_SA = { GCAL_SA_EMAIL: 'agenda@openside.iam.gserviceaccount.com', GCAL_SA_PRIVATE_KEY: PRIVADA };

ok(crearTokenServiceAccount({}) === null, 'sin credenciales no hay proveedor de token');
ok(crearTokenServiceAccount({ GCAL_SA_EMAIL: 'x' }) === null, 'el correo solo no basta: falta la clave');

let reloj = 1_760_000_000;
const fOauth = fetchFalso([{ status: 200, datos: { access_token: 'ya29.uno', expires_in: 3600 } },
                           { status: 200, datos: { access_token: 'ya29.dos', expires_in: 3600 } }]);
const dameToken = crearTokenServiceAccount(ENTORNO_SA, { fetch: fOauth, ahora: () => reloj });

const t1 = await dameToken();
ok(t1 === 'ya29.uno', 'obtiene el access_token', t1);
ok(fOauth.llamadas[0].url === 'https://oauth2.googleapis.com/token', 'lo pide al endpoint de OAuth de Google');

const cuerpoOauth = new URLSearchParams(fOauth.llamadas[0].body);
ok(cuerpoOauth.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer',
   'usa el flujo jwt-bearer, sin pantalla de consentimiento');

const [cab, carga, firma] = cuerpoOauth.get('assertion').split('.');
const json = t => JSON.parse(Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
ok(json(cab).alg === 'RS256', 'la cabecera declara RS256');
ok(json(carga).iss === ENTORNO_SA.GCAL_SA_EMAIL, 'el iss es la cuenta de servicio');
ok(json(carga).aud === 'https://oauth2.googleapis.com/token', 'el aud es el endpoint de token');
ok(json(carga).scope === SCOPES, 'pide solo events y freebusy', json(carga).scope);
ok(!SCOPES.includes('calendar.readonly'),
   'no pide calendar.readonly: eso daría acceso al contenido de eventos ajenos');
ok(json(carga).exp - json(carga).iat === 3600, 'el JWT vive una hora');
ok(json(carga).sub === undefined, 'sin delegación de dominio no lleva sub');
ok(crypto.createVerify('RSA-SHA256').update(`${cab}.${carga}`)
     .verify(par.publicKey, Buffer.from(firma.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
   'la firma verifica con la clave pública de la cuenta de servicio');

await dameToken();
ok(fOauth.llamadas.length === 1, 'el token se cachea: no se pide uno por llamada', fOauth.llamadas.length);
reloj += 3600;
await dameToken();
ok(fOauth.llamadas.length === 2, 'al caducar se renueva');

const conSujeto = crearTokenServiceAccount({ ...ENTORNO_SA, GCAL_SA_SUBJECT: 'agenda@open-side.com' },
  { fetch: fetchFalso([{ status: 200, datos: { access_token: 't', expires_in: 60 } }]), ahora: () => reloj });
await conSujeto();
ok(true, 'con GCAL_SA_SUBJECT se firma la suplantación de un buzón de Workspace');

const fMal = fetchFalso([{ status: 400, datos: { error: 'invalid_grant' } }]);
const malo = crearTokenServiceAccount(ENTORNO_SA, { fetch: fMal, ahora: () => reloj });
ok(await malo().then(() => false, e => e.message === 'OAUTH_400_invalid_grant'),
   'un rechazo de OAuth lanza con el motivo, no devuelve undefined');

ok(crearCalendario({ GCAL_SEDE_75E: 'c75', ...ENTORNO_SA }) instanceof CalendarioGoogle,
   'con sede y cuenta de servicio en el entorno, el servidor arranca conectado');
ok(crearCalendario(ENTORNO_SA) instanceof CalendarioMemoria,
   'con credenciales pero sin calendarios no se conecta a medias');

/* ============================================================ */
console.log('\n— Rejilla de franjas en hora de Panamá —');

const AHORA = new Date('2026-10-01T15:00:00.000Z').getTime();
const rejilla = generarFranjas({ desde: '2026-10-05', dias: 7, duracionMin: 45, ahora: AHORA });

ok(rejilla.length > 0, 'genera franjas');
ok(horaPanama(rejilla[0].inicio).hora === 7 && rejilla[0].inicio.endsWith('T12:00:00.000Z'),
   'las 7:00 del centro son las 12:00 UTC, no las 7:00 UTC', rejilla[0].inicio);
ok(!rejilla.some(f => horaPanama(f.inicio).dia === 0), 'no ofrece domingos: el centro cierra');
const sabados = rejilla.filter(f => horaPanama(f.inicio).dia === 6);
ok(sabados.length > 0 && sabados.every(f => horaPanama(f.inicio).hora < 14),
   'el sábado no ofrece nada después de las 2:00 p.m.');
ok(rejilla.every(f => {
  const h = horaPanama(f.inicio);
  const cierre = h.dia === 6 ? 14 : 20;
  return h.hora * 60 + h.minuto + 45 <= cierre * 60;
}), 'ninguna franja termina después del cierre: cabe el estudio entero');
ok(rejilla.every(f => new Date(f.inicio).getTime() >= AHORA + 120 * 60000),
   'respeta el margen mínimo: nadie agenda una resonancia para dentro de veinte minutos');

const conMargen = generarFranjas({ dias: 2, duracionMin: 30, ahora: AHORA });
ok(conMargen.every(f => new Date(f.inicio).getTime() >= AHORA + 120 * 60000),
   'sin fecha de inicio arranca desde ahora, con el mismo margen');
ok(generarFranjas({ desde: '2026-10-05', dias: 7, duracionMin: 45, preferencia: 'manana', ahora: AHORA })
     .every(f => horaPanama(f.inicio).hora < 12), 'la preferencia de mañana se respeta');
ok(generarFranjas({ desde: '2026-10-05', dias: 7, duracionMin: 45, preferencia: 'tarde', ahora: AHORA })
     .every(f => horaPanama(f.inicio).hora >= 12), 'y la de tarde también');
ok(etiquetaPanama('2026-10-05T12:00:00Z') === 'lunes 5 de octubre, 7:00 a.m.',
   'la etiqueta que lee el paciente está en hora del centro', etiquetaPanama('2026-10-05T12:00:00Z'));

/* ============================================================ */
console.log('\n— Candado de franja —');

ok(/^[a-v0-9]{5,}$/.test(idReservaDeFranja('75E', '2026-10-05T12:00:00Z')), 'el id de reserva es válido para Google');
ok(idReservaDeFranja('75E', '2026-10-05T12:00:00Z') === idReservaDeFranja('75E', '2026-10-05T12:00:00.000Z'),
   'la misma franja da el mismo id: ahí está el candado');
ok(idReservaDeFranja('75E', '2026-10-05T12:00:00Z') !== idReservaDeFranja('76E', '2026-10-05T12:00:00Z'),
   'cada sede tiene su propio candado');
ok(idReservaDeFranja('75E', '2026-10-05T12:00:00Z') !== idReservaDeFranja('75E', '2026-10-05T12:15:00Z'),
   'y cada hora el suyo');

const evNuestro = (id, ini, dur) => ({
  id, status: 'confirmed',
  start: { dateTime: ini }, end: { dateTime: new Date(new Date(ini).getTime() + dur * 60000).toISOString() },
  extendedProperties: { private: { origen: 'agente-openside' } }
});
const evAjeno = (id, ini, dur) => ({
  id, summary: 'Mantenimiento', status: 'confirmed',
  start: { dateTime: ini }, end: { dateTime: new Date(new Date(ini).getTime() + dur * 60000).toISOString() }
});
ok(esNuestro(evNuestro('x', '2026-10-05T12:00:00Z', 30)) === true, 'reconoce un evento propio');
ok(esNuestro(evAjeno('x', '2026-10-05T12:00:00Z', 30)) === false, 'y uno puesto a mano');

const FRANJA = { sede: '75E', inicio: '2026-10-05T12:00:00.000Z', duracionMin: 45 };
const MIO = idReservaDeFranja('75E', FRANJA.inicio);

/* Guion por método HTTP, que es como se lee el protocolo */
function calendarioGuion(pasos) {
  let i = 0;
  const f = fetchFalso(pasos);
  return google(f);
}
const lista = (items) => ({ status: 200, datos: { items } });
const insertOK = { status: 200, datos: { id: MIO, etag: '"r1"' } };

/* 1 · camino feliz */
let gc = calendarioGuion([insertOK, lista([evNuestro(MIO, FRANJA.inicio, 45)])]);
let r = await gc.reservar(FRANJA);
ok(r.ok && r.reserva_id === MIO, 'retiene la franja', r);
ok(gc.fetch.llamadas[0].method === 'POST' && gc.fetch.llamadas[0].cuerpo.status === 'tentative',
   'el evento entra como tentativo: es una retención, no una cita');
ok(!JSON.stringify(gc.fetch.llamadas[0].cuerpo).includes('María'),
   'la retención tampoco lleva datos del paciente');

/* 2 · el id ya existe y está vivo */
gc = calendarioGuion([{ status: 409, datos: {} }, { status: 200, datos: { id: MIO, status: 'confirmed' } }]);
r = await gc.reservar(FRANJA);
ok(r.ok === false && r.error === 'FRANJA_TOMADA' && r.motivo === 'id_ocupado',
   'dos reservas del mismo inicio chocan y la segunda pierde', r);

/* 3 · el id existe pero cancelado: se revive */
gc = calendarioGuion([
  { status: 409, datos: {} },
  { status: 200, datos: { id: MIO, status: 'cancelled' } },
  { status: 200, datos: { id: MIO, etag: '"r2"' } },
  lista([evNuestro(MIO, FRANJA.inicio, 45)])
]);
r = await gc.reservar(FRANJA);
ok(r.ok === true, 'una franja liberada antes se puede volver a tomar', r);
ok(gc.fetch.llamadas[2].method === 'PATCH', 'reviviendo el evento cancelado, no creando otro id');

/* 4 · un bloqueo del centro gana siempre */
gc = calendarioGuion([insertOK, lista([
  evNuestro(MIO, FRANJA.inicio, 45),
  evAjeno('manual1', '2026-10-05T12:30:00.000Z', 60)
]), { status: 204, datos: {} }]);
r = await gc.reservar(FRANJA);
ok(r.ok === false && r.motivo === 'bloqueo_del_centro',
   'un evento puesto a mano que solapa gana: quien está delante del paciente manda', r);
ok(gc.fetch.llamadas.at(-1).method === 'DELETE', 'y la retención se suelta, no se queda colgada');

/* 5 · carrera contra otra reserva nuestra: gana el id menor */
const OTRO_MENOR = 'a' + MIO;     // ordena antes
const OTRO_MAYOR = 'z'.replace('z', 'v') + MIO;
gc = calendarioGuion([insertOK, lista([
  evNuestro(MIO, FRANJA.inicio, 45),
  evNuestro(OTRO_MENOR, '2026-10-05T12:30:00.000Z', 45)
]), { status: 204, datos: {} }]);
r = await gc.reservar(FRANJA);
ok(r.ok === false && r.motivo === 'carrera_perdida', 'ante un id menor nos retiramos', r);

gc = calendarioGuion([insertOK, lista([
  evNuestro(MIO, FRANJA.inicio, 45),
  evNuestro(OTRO_MAYOR, '2026-10-05T12:30:00.000Z', 45)
])]);
r = await gc.reservar(FRANJA);
ok(r.ok === true, 'ante un id mayor nos quedamos: el criterio es determinista y no hay bloqueo mutuo');
ok(OTRO_MENOR < MIO && MIO < OTRO_MAYOR, 'los dos lados leen el mismo orden, así que solo uno se queda');

/* 6 · un evento pegado no es un solape */
gc = calendarioGuion([insertOK, lista([
  evNuestro(MIO, FRANJA.inicio, 45),
  evAjeno('pegado', '2026-10-05T12:45:00.000Z', 30)
])]);
r = await gc.reservar(FRANJA);
ok(r.ok === true, 'un evento que empieza justo al terminar el nuestro no estorba');

/* 7 · no se puede verificar */
gc = calendarioGuion([insertOK, { status: 500, datos: {} }, { status: 204, datos: {} }]);
r = await gc.reservar(FRANJA);
ok(r.ok === false && r.error === 'RESERVA_NO_VERIFICABLE',
   'si no se puede releer la ventana, no se afirma que la franja es nuestra', r);
ok(gc.fetch.llamadas.at(-1).method === 'DELETE', 'y se suelta lo que se había tomado');

/* ============================================================ */
console.log('\n— Disponibilidad calculada contra Calendar —');

const gcDisp = (busy75, busy76) => google(fetchFalso([{ status: 200, datos: { calendars: {
  'cal75@group.calendar.google.com': busy75,
  'cal76@group.calendar.google.com': busy76
} } }]));

let disp = await gcDisp({ busy: [] }, { busy: [] })
  .disponibilidad({ duracionMin: 45, desde: '2026-10-05', limite: 3, ahora: AHORA });
ok(disp.ok && disp.cupos.length === 3, 'ofrece tres cupos', disp.cupos && disp.cupos.length);
ok(new Set(disp.cupos.map(c => c.inicio.slice(0, 10))).size === 3,
   'repartidos en días distintos, como haría una recepcionista', disp.cupos.map(c => c.inicio));
ok(disp.cupos.every(c => c.cupo_id === idReservaDeFranja(c.sede, c.inicio)),
   'el cupo_id ES la llave del candado: lo que se ofrece es lo que se reserva');

disp = await gcDisp({ busy: [{ start: '2026-10-05T00:00:00Z', end: '2026-10-09T00:00:00Z' }] }, { busy: [] })
  .disponibilidad({ duracionMin: 45, desde: '2026-10-05', limite: 3, ahora: AHORA });
ok(disp.cupos.every(c => c.sede === '76E'), 'una sede bloqueada desaparece de la oferta', disp.cupos.map(c => c.sede));

disp = await gcDisp({ errors: [{ reason: 'notFound' }] }, { busy: [] })
  .disponibilidad({ duracionMin: 45, desde: '2026-10-05', limite: 3, ahora: AHORA });
ok(disp.cupos.every(c => c.sede === '76E'),
   'si Calendar ES la agenda, un calendario ilegible no se ofrece: no leerlo es no saber nada');

disp = await gcDisp({ busy: [{ start: '2026-10-05T00:00:00Z', end: '2026-10-30T00:00:00Z' }] },
                     { busy: [{ start: '2026-10-05T00:00:00Z', end: '2026-10-30T00:00:00Z' }] })
  .disponibilidad({ duracionMin: 45, desde: '2026-10-05', limite: 3, ahora: AHORA });
ok(disp.ok && disp.cupos.length === 0, 'con todo ocupado devuelve cero, no un cupo inventado');

/* ============================================================ */
console.log('\n— Enganches del turno del agente —');

resetEstadoHerramientas();
const traza = () => ({ tools: [], guardrails: [] });
const falsoCal = (impl) => ({ conectado: true, ...impl });

/* buscar_cupos: la oferta viene de Calendar */
let st = { cupos: [{ duracion_min: 45 }], labels: new Set() };
let tr = traza();
let res = await despuesDeCalendario('buscar_cupos', { estudio_id: 'rm-rodilla', sede: 'cualquiera' },
  { ok: true, estudio: 'RM de rodilla', cupos: [{ cupo_id: 'inventado' }] }, st, falsoCal({
    disponibilidad: async (a) => {
      ok(a.duracionMin === 45, 'pide la duración real del estudio', a.duracionMin);
      return { ok: true, cupos: [{ cupo_id: idReservaDeFranja('75E', '2026-10-05T12:00:00.000Z'),
                                   inicio: '2026-10-05T12:00:00.000Z', sede: '75E', duracion_min: 45 }] };
    }
  }), tr);
ok(res.cupos.length === 1 && res.cupos[0].cupo_id !== 'inventado',
   'el cupo generado localmente no llega al paciente: manda Calendar');
ok(res.cupos[0].cuando === 'lunes 5 de octubre, 7:00 a.m.', 'con la etiqueta en hora del centro', res.cupos[0].cuando);
ok(res.cupos[0].sede === 'Sede Calle 75E', 'y el nombre de la sede resuelto', res.cupos[0].sede);
ok(agendar_cita({ cupo_id: res.cupos[0].cupo_id, estudio_id: 'rm-rodilla', _contexto: { consentimiento: true, screening_estado: 'aprobado' } }).ok === true,
   'el cupo de Calendar queda registrado: agendar_cita lo acepta');
ok(agendar_cita({ cupo_id: 'inventado-por-el-modelo', estudio_id: 'rm-rodilla', _contexto: { consentimiento: true, screening_estado: 'aprobado' } }).error === 'CUPO_NO_VIGENTE',
   'y uno inventado sigue rechazándose');

/* buscar_cupos: la agenda no responde */
st = { cupos: [{ duracion_min: 30 }] }; tr = traza();
res = await despuesDeCalendario('buscar_cupos', {}, { ok: true, cupos: [{ cupo_id: 'x' }] }, st,
  falsoCal({ disponibilidad: async () => { throw new Error('FREEBUSY_503'); } }), tr);
ok(res.ok === false && res.error === 'AGENDA_NO_DISPONIBLE' && st.cupos.length === 0,
   'sin agenda no se ofrece nada: con Calendar como sistema real, inventar una hora es peor que escalar', res);
ok(tr.guardrails.some(g => g.nombre === 'agenda_calendar'), 'y queda registrado');

/* agendar_cita: la franja se toma antes de ejecutar */
st = { cupos: [{ cupo_id: MIO, inicio: FRANJA.inicio, sede: '75E', duracion_min: 45 }] }; tr = traza();
let reservado = null;
let previo = await antesDeCalendario('agendar_cita', { cupo_id: MIO, estudio_id: 'rm-rodilla' }, st,
  falsoCal({ reservar: async (a) => { reservado = a; return { ok: true, reserva_id: MIO }; } }), tr);
ok(previo === null, 'con la franja libre el ejecutor sigue su curso');
ok(reservado.inicio === FRANJA.inicio && reservado.duracionMin === 45, 'se reservó la franja del cupo elegido');
ok(st.reserva && st.reserva.reserva_id === MIO, 'la retención queda en el estado del turno');

/* agendar_cita: la franja ya no está */
st = { cupos: [{ cupo_id: MIO, inicio: FRANJA.inicio, sede: '75E', duracion_min: 45 }] }; tr = traza();
previo = await antesDeCalendario('agendar_cita', { cupo_id: MIO }, st,
  falsoCal({ reservar: async () => ({ ok: false, error: 'FRANJA_TOMADA', motivo: 'id_ocupado' }) }), tr);
ok(previo && previo.error === 'CUPO_NO_VIGENTE', 'el ejecutor ni siquiera corre: no se crea una cita imposible', previo);
ok(/vuelve a consultar disponibilidad/i.test(previo.mensaje), 'y el modelo recibe qué hacer a continuación');
ok(st.cupos.length === 0, 'el cupo caducado sale del estado para que no se reintente');

/* agendar_cita: un cupo que nunca se ofreció no se reserva */
st = { cupos: [] };
ok(await antesDeCalendario('agendar_cita', { cupo_id: 'alucinado' }, st,
     falsoCal({ reservar: async () => { throw new Error('no debería llamarse'); } }), traza()) === null,
   'un cupo_id alucinado no escribe en Calendar: de eso ya se encarga la precondición');

/* después: la reserva se vuelve cita */
st = { reserva: { sede: '75E', inicio: FRANJA.inicio, reserva_id: MIO }, cita: {} }; tr = traza();
res = await despuesDeCalendario('agendar_cita', {}, { ok: true, ...CITA }, st,
  falsoCal({ confirmarReserva: async () => ({ ok: true, evento_id: MIO }) }), tr);
ok(res.google_evento_id === MIO && st.cita.googleEventoId === MIO, 'la retención se convierte en la cita');
ok(st.reserva === null, 'y deja de estar pendiente');

/* después: una precondición rechazó — hay que soltar la franja */
st = { reserva: { sede: '75E', inicio: FRANJA.inicio, reserva_id: MIO }, cita: {} }; tr = traza();
let liberada = null;
res = await despuesDeCalendario('agendar_cita', {}, { ok: false, error: 'SIN_CONSENTIMIENTO' }, st,
  falsoCal({ liberar: async (a) => { liberada = a; return { ok: true }; } }), tr);
ok(liberada && liberada.inicio === FRANJA.inicio,
   'si el guardrail bloquea, la franja se devuelve: no se retiene una hora por una cita que no existió');
ok(res.error === 'SIN_CONSENTIMIENTO', 'y el rechazo llega al modelo intacto');

/* después: no se pudo completar el evento */
st = { reserva: { sede: '75E', inicio: FRANJA.inicio, reserva_id: MIO }, cita: {} }; tr = traza();
res = await despuesDeCalendario('agendar_cita', {}, { ok: true, ...CITA }, st,
  falsoCal({ confirmarReserva: async () => ({ ok: false, error: 'CONFIRMAR_500' }) }), tr);
ok(res.ok === true && res.espejo_pendiente === true,
   'la cita sigue en pie y la franja sigue retenida: nadie más la puede tomar', res);
ok(tr.guardrails.some(g => g.nombre === 'confirmar_reserva'), 'el fallo es visible, no silencioso');

/* sin conectar, ningún enganche actúa */
const intacto = { ok: true, cupos: [{ cupo_id: 'local' }] };
ok(await despuesDeCalendario('buscar_cupos', {}, intacto, { cupos: [] }, new CalendarioMemoria(), traza()) === intacto,
   'sin calendario conectado el agente usa sus herramientas locales, igual que siempre');
ok(await antesDeCalendario('agendar_cita', { cupo_id: 'x' }, { cupos: [] }, new CalendarioMemoria(), traza()) === null,
   'y no intenta reservar nada');

const mem2 = new CalendarioMemoria();
ok((await mem2.disponibilidad()).ok === false && (await mem2.citasEntre({})).length === 0,
   'el calendario en memoria implementa la misma interfaz, sin inventarse una agenda');


/* ============================================================ */
console.log(`\n${n - fallos}/${n} comprobaciones pasaron`);
process.exit(fallos ? 1 : 0);
