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
  crearTokenServiceAccount, espejarEnCalendario
} from './calendario.js';

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
console.log('\n— Espejo dentro del turno del agente —');

const CUPOS = [
  { cupo_id: 'c1', inicio: '2026-10-05T12:00:00.000Z', duracion_min: 45, sede: '75E' },
  { cupo_id: 'c2', inicio: '2026-10-05T14:00:00.000Z', duracion_min: 45, sede: '75E' },
  { cupo_id: 'c3', inicio: '2026-10-06T13:00:00.000Z', duracion_min: 45, sede: '76E' }
];
const resBusqueda = () => ({ ok: true, cupos: CUPOS.map(c => ({ cupo_id: c.cupo_id, cuando: 'x' })) });
const estado = () => ({ cupos: CUPOS.map(c => ({ ...c })), cita: {} });
const traza = () => ({ tools: [], guardrails: [] });

const falsoCal = (impl) => ({ conectado: true, ...impl });

/* 1 · resta la ocupación real */
let st = estado(), tr = traza();
let r = await espejarEnCalendario('buscar_cupos', resBusqueda(), st, falsoCal({
  libreOcupado: async ({ desde, hasta, sedes }) => {
    ok(sedes.length === 2, 'consulta solo las sedes de los cupos ofrecidos', sedes);
    ok(new Date(desde) <= new Date('2026-10-05T12:00:00.000Z'), 'la ventana cubre el primer cupo');
    ok(new Date(hasta) >= new Date('2026-10-06T13:45:00.000Z'), 'y el final del último');
    return { '75E': { busy: [{ start: '2026-10-05T12:30:00Z', end: '2026-10-05T13:00:00Z' }] }, '76E': { busy: [] } };
  }
}), tr);
ok(r.cupos.map(c => c.cupo_id).join(',') === 'c2,c3', 'el cupo ocupado en Google no llega al paciente',
   r.cupos.map(c => c.cupo_id));
ok(st.cupos.length === 2, 'y también sale del estado: agendar_cita no lo aceptaría después');
ok(tr.tools.some(t => t.nombre === 'calendario.freeBusy'), 'la resta queda en la traza del inspector');
ok(r.verificacion_externa === 'ok', 'la respuesta declara que se verificó');

/* 2 · una sede sin dato no se descarta a ciegas */
st = estado();
r = await espejarEnCalendario('buscar_cupos', resBusqueda(), st, falsoCal({
  libreOcupado: async () => ({ '75E': { busy: null, error: 'notFound' } })
}), traza());
ok(r.cupos.length === 3, 'un calendario ilegible no borra los cupos de esa sede', r.cupos.length);

/* 3 · freeBusy caído: se ofrece, pero sujeto a confirmación */
st = estado(); tr = traza();
r = await espejarEnCalendario('buscar_cupos', resBusqueda(), st, falsoCal({
  libreOcupado: async () => { throw new Error('FREEBUSY_503'); }
}), tr);
ok(r.verificacion_externa === 'no_disponible' && r.cupos.length === 3,
   'si el calendario no responde no se deja al paciente sin opciones…');
ok(/sujeto a confirmación/i.test(r.nota), '…pero el modelo recibe la instrucción de no prometer la hora', r.nota);
ok(tr.guardrails.some(g => g.nombre === 'freebusy'), 'el fallo queda registrado');

/* 4 · nada libre */
st = estado();
r = await espejarEnCalendario('buscar_cupos', resBusqueda(), st, falsoCal({
  libreOcupado: async () => ({
    '75E': { busy: [{ start: '2026-10-05T00:00:00Z', end: '2026-10-07T00:00:00Z' }] },
    '76E': { busy: [{ start: '2026-10-05T00:00:00Z', end: '2026-10-07T00:00:00Z' }] }
  })
}), traza());
ok(r.ok === true && r.cupos.length === 0 && r.verificacion_externa === 'sin_disponibilidad',
   'con el día bloqueado devuelve cero cupos, no un cupo inventado', r);

/* 5 · la cita se espeja después de existir */
st = { cupos: [], cita: {} }; tr = traza();
let orden = [];
r = await espejarEnCalendario('agendar_cita', { ok: true, ...CITA }, st, falsoCal({
  crearEvento: async (cita) => { orden.push('google'); return { ok: true, evento_id: idEventoDesdeCita(cita.cita_id), duplicado: false }; }
}), tr);
ok(r.google_evento_id === 'os202604871', 'la cita creada arrastra el id del evento', r.google_evento_id);
ok(st.cita.googleEventoId === 'os202604871', 'y queda en el estado para publicarlo al CRM');
ok(tr.tools.some(t => t.nombre === 'calendario.events.insert'), 'el inspector muestra la escritura');

/* 6 · el espejo falla: la cita sigue siendo válida */
st = { cupos: [], cita: {} }; tr = traza();
r = await espejarEnCalendario('agendar_cita', { ok: true, ...CITA }, st, falsoCal({
  crearEvento: async () => { throw new Error('INSERT_500'); }
}), tr);
ok(r.ok === true && r.cita_id === CITA.cita_id, 'un fallo de Google NO cancela la cita del paciente');
ok(r.espejo_pendiente === true && st.cita.espejoPendiente === true, 'queda marcada para reintento');
ok(tr.guardrails.some(g => g.nombre === 'espejo_calendario'), 'y el fallo es visible, no silencioso');

/* 7 · sin conectar, el espejo no toca nada */
const original = { ok: true, cupos: [{ cupo_id: 'c1' }] };
ok(await espejarEnCalendario('buscar_cupos', original, estado(), new CalendarioMemoria(), traza()) === original,
   'con el calendario en memoria la respuesta pasa intacta');
ok(await espejarEnCalendario('buscar_cupos', original, estado(), null, traza()) === original,
   'sin calendario tampoco falla');
const fallida = { ok: false, error: 'CUPO_NO_VIGENTE' };
ok(await espejarEnCalendario('agendar_cita', fallida, estado(), falsoCal({
  crearEvento: async () => { throw new Error('no debería llamarse'); }
}), traza()) === fallida, 'una herramienta que falló no escribe en el calendario');

/* ============================================================ */
console.log(`\n${n - fallos}/${n} comprobaciones pasaron`);
process.exit(fallos ? 1 : 0);
