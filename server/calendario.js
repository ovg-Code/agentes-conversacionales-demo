/* ============================================================
   Adaptador de agenda externa · Google Calendar API v3
   ------------------------------------------------------------
   Este módulo responde a una pregunta concreta: ¿la agenda del
   CRM se sincroniza con Google Calendar?

   La respuesta arquitectónica está en una sola frase:

     Google Calendar NUNCA es la fuente de verdad de la capacidad.
     Es un espejo que escribimos y un lector de bloqueos ajenos.

   El motivo es técnico, no de gusto: la API de Calendar no tiene
   reservas ni bloqueo optimista de franjas. Dos llamadas
   simultáneas pueden insertar dos eventos encima del mismo
   equipo y ninguna de las dos falla. Un centro de imagen no
   puede sobreagendar una resonancia. Por eso el cupo se retiene
   en nuestro lado (TTL de 10 min, ya implementado en tools.js) y
   Google recibe el evento cuando la cita ya existe.

   De Google SÍ leemos: freeBusy nos dice qué horas están
   ocupadas por cosas que no pasan por nuestro sistema —
   mantenimiento del equipo, vacaciones del tecnólogo, un bloqueo
   que la administración puso a mano. Eso se resta de los cupos
   ANTES de ofrecerlos al paciente.

   Ley 81 de 2019: los datos de salud son sensibles. Lo que se
   escribe en un calendario de un tercero no lleva nombre del
   paciente ni diagnóstico. Solo el identificador de la cita y el
   estudio. El nombre vive en nuestra base y se resuelve al abrir
   el CRM. Ver docs/11-google-calendar.md.

   Sin credenciales el servidor usa CalendarioMemoria, que
   implementa la misma interfaz. El resto del sistema no sabe cuál
   de los dos tiene enfrente.
   ============================================================ */

import crypto from 'node:crypto';
import { SEDES } from '../demo/src/kb.js';
import { registrarCupos } from '../demo/src/tools.js';

/* GCAL_BASE permite apuntar a un doble de la API —para pruebas de
   extremo a extremo o para un proxy corporativo— sin tocar código. */
const BASE = (process.env.GCAL_BASE || 'https://www.googleapis.com') + '/calendar/v3';
const OAUTH = process.env.GCAL_OAUTH || 'https://oauth2.googleapis.com/token';

/* Lo mínimo que hace falta: escribir eventos y leer ocupación.
   Nada de calendar.readonly completo, que daría acceso al contenido
   de los eventos ajenos de toda la cuenta. */
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy'
].join(' ');

/* El mapeo cita <-> evento es puro y lo comparten servidor y CRM:
   vive en demo/src/calendario-mapeo.js para que la ficha de la cita
   muestre exactamente lo que se escribiría, sin una segunda copia
   de la regla de privacidad que se pueda desviar. */
export {
  ZONA, idEventoDesdeCita, tituloEvento, eventoDesdeCita, citaDesdeEvento, filtrarCuposOcupados,
  idReservaDeFranja, eventoReserva, generarFranjas, esNuestro, horaPanama,
  etiquetaPanama, etiquetaCortaPanama
} from '../demo/src/calendario-mapeo.js';

import {
  ZONA, idEventoDesdeCita, eventoDesdeCita, citaDesdeEvento, filtrarCuposOcupados,
  idReservaDeFranja, eventoReserva, generarFranjas, esNuestro,
  etiquetaPanama, etiquetaCortaPanama
} from '../demo/src/calendario-mapeo.js';

/* Un calendario por sede. Así la recepción de la 75E ve su día sin
   el ruido de la otra sede, y freeBusy se consulta por separado. */
export function calendariosDeEntorno(env = process.env) {
  const mapa = {};
  if (env.GCAL_SEDE_75E) mapa['75E'] = env.GCAL_SEDE_75E;
  if (env.GCAL_SEDE_76E) mapa['76E'] = env.GCAL_SEDE_76E;
  return mapa;
}

/* ------------------------------------------------------------ */
/* CalendarioMemoria — misma interfaz, sin red                   */
/* ------------------------------------------------------------ */
export class CalendarioMemoria {
  constructor() { this.eventos = new Map(); this.conectado = false; }

  async libreOcupado() { return {}; }

  async crearEvento(cita) {
    const ev = eventoDesdeCita(cita);
    if (this.eventos.has(ev.id)) return { ok: true, duplicado: true, evento_id: ev.id };
    this.eventos.set(ev.id, ev);
    return { ok: true, duplicado: false, evento_id: ev.id, espejo: false };
  }

  async cancelarEvento(citaId) {
    const id = idEventoDesdeCita(citaId);
    const existia = this.eventos.delete(id);
    return { ok: true, existia };
  }

  async cambiosDesde() { return { cambios: [], syncToken: null }; }
}

/* ------------------------------------------------------------ */
/* CalendarioGoogle — HTTP real, transporte inyectable           */
/* ------------------------------------------------------------ */
export class CalendarioGoogle {
  /* @param calendarios  { '75E': 'id@group.calendar.google.com', … }
     @param token        () => Promise<string>  access token OAuth2
     @param fetch        inyectable para pruebas sin red */
  constructor({ calendarios, token, fetch: f = globalThis.fetch } = {}) {
    this.calendarios = calendarios || {};
    this.token = token;
    this.fetch = f;
    this.conectado = Object.keys(this.calendarios).length > 0;
    this.syncTokens = new Map();          // sede -> nextSyncToken
  }

  async _llamar(metodo, ruta, cuerpo, cabeceras = {}) {
    const bearer = await this.token();
    const res = await this.fetch(BASE + ruta, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        ...cabeceras
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    const texto = await res.text();
    const datos = texto ? JSON.parse(texto) : {};
    return { status: res.status, datos };
  }

  /* freeBusy.query — hasta 50 calendarios por llamada. Devuelve solo
     bloques ocupados, nunca el contenido de los eventos ajenos: es la
     consulta correcta para "¿puedo ofrecer esta hora?". */
  async libreOcupado({ desde, hasta, sedes }) {
    const ids = (sedes || Object.keys(this.calendarios))
      .map(s => this.calendarios[s]).filter(Boolean);
    if (!ids.length) return {};
    const { status, datos } = await this._llamar('POST', '/freeBusy', {
      timeMin: new Date(desde).toISOString(),
      timeMax: new Date(hasta).toISOString(),
      timeZone: ZONA,
      items: ids.map(id => ({ id }))
    });
    if (status !== 200) throw new Error(`FREEBUSY_${status}`);
    const porSede = {};
    for (const [sede, id] of Object.entries(this.calendarios)) {
      const c = datos.calendars && datos.calendars[id];
      if (!c) continue;
      /* Un calendario con errors (no compartido, inexistente) no es
         "sin ocupación": es información que falta. Se trata como tal. */
      if (c.errors && c.errors.length) { porSede[sede] = { error: c.errors[0].reason, busy: null }; continue; }
      porSede[sede] = { busy: c.busy || [] };
    }
    return porSede;
  }

  /* events.insert con id derivado: el 409 es la idempotencia. */
  async crearEvento(cita) {
    const calId = this.calendarios[cita.sede];
    if (!calId) return { ok: false, error: 'SEDE_SIN_CALENDARIO', sede: cita.sede };
    const ev = eventoDesdeCita(cita);
    const { status, datos } = await this._llamar(
      'POST', `/calendars/${encodeURIComponent(calId)}/events`, ev
    );
    if (status === 409) return { ok: true, duplicado: true, evento_id: ev.id, espejo: true };
    if (status >= 400) return { ok: false, error: `INSERT_${status}`, detalle: datos.error && datos.error.message };
    return { ok: true, duplicado: false, evento_id: datos.id, etag: datos.etag, espejo: true, enlace: datos.htmlLink };
  }

  /* If-Match con el etag: si alguien movió el evento en Google desde
     que lo leímos, el 412 nos avisa en vez de pisar su cambio. */
  async moverEvento(cita, etag) {
    const calId = this.calendarios[cita.sede];
    if (!calId) return { ok: false, error: 'SEDE_SIN_CALENDARIO' };
    const ev = eventoDesdeCita(cita);
    const { status, datos } = await this._llamar(
      'PATCH', `/calendars/${encodeURIComponent(calId)}/events/${ev.id}`,
      { start: ev.start, end: ev.end },
      etag ? { 'If-Match': etag } : {}
    );
    if (status === 412) return { ok: false, error: 'CONFLICTO_ETAG', requiere_revision_humana: true };
    if (status >= 400) return { ok: false, error: `PATCH_${status}` };
    return { ok: true, etag: datos.etag };
  }

  async cancelarEvento(citaId, sede) {
    const calId = this.calendarios[sede];
    if (!calId) return { ok: false, error: 'SEDE_SIN_CALENDARIO' };
    const id = idEventoDesdeCita(citaId);
    const { status } = await this._llamar('DELETE', `/calendars/${encodeURIComponent(calId)}/events/${id}`);
    /* 410 = ya estaba borrado. Para un cancelar, eso es éxito. */
    if (status === 404 || status === 410) return { ok: true, existia: false };
    if (status >= 400) return { ok: false, error: `DELETE_${status}` };
    return { ok: true, existia: true };
  }

  /* Sincronización incremental. La notificación push de Google no
     trae el cambio, solo avisa; hay que venir a listar con el
     syncToken guardado. Un 410 GONE significa que el token caducó:
     toca resincronización completa. */
  async cambiosDesde(sede) {
    const calId = this.calendarios[sede];
    if (!calId) return { cambios: [], syncToken: null, error: 'SEDE_SIN_CALENDARIO' };
    const token = this.syncTokens.get(sede);
    const params = new URLSearchParams(
      token
        ? { syncToken: token, showDeleted: 'true' }
        : { timeMin: new Date().toISOString(), singleEvents: 'true', showDeleted: 'true' }
    );
    const { status, datos } = await this._llamar(
      'GET', `/calendars/${encodeURIComponent(calId)}/events?${params}`
    );
    if (status === 410) { this.syncTokens.delete(sede); return { cambios: [], syncToken: null, resincronizar: true }; }
    if (status >= 400) return { cambios: [], syncToken: token || null, error: `LIST_${status}` };
    if (datos.nextSyncToken) this.syncTokens.set(sede, datos.nextSyncToken);
    return {
      cambios: (datos.items || []).map(citaDesdeEvento),
      syncToken: datos.nextSyncToken || null
    };
  }

  /* ==========================================================
     La agenda ES Calendar
     ----------------------------------------------------------
     Todo lo que sigue solo tiene sentido en el escenario donde
     Google Calendar no es un espejo sino el sistema real: la
     disponibilidad se calcula contra él y la cita se retiene con
     un candado construido sobre la única garantía que su API
     ofrece — que el id de un evento es único en un calendario.
     ========================================================== */

  /* events.list sobre una ventana. singleEvents expande las series
     periódicas: un mantenimiento "todos los martes" tiene que
     aparecer como el martes concreto que bloquea. */
  async listarEventos({ sede, desde, hasta }) {
    const calId = this.calendarios[sede];
    if (!calId) return { ok: false, error: 'SEDE_SIN_CALENDARIO', eventos: [] };
    const params = new URLSearchParams({
      timeMin: new Date(desde).toISOString(),
      timeMax: new Date(hasta).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500'
    });
    const { status, datos } = await this._llamar(
      'GET', `/calendars/${encodeURIComponent(calId)}/events?${params}`
    );
    if (status >= 400) return { ok: false, error: `LIST_${status}`, eventos: [] };
    return { ok: true, eventos: (datos.items || []).filter(e => e.status !== 'cancelled') };
  }

  /* Disponibilidad real: el horario del centro menos lo ocupado.
     Ya no se inventa un cupo; se descarta lo que Calendar dice que
     está tomado, venga de donde venga. */
  async disponibilidad({ duracionMin = 30, desde, dias = 14, preferencia = 'cualquiera',
                         sede = 'cualquiera', limite = 3, estudioId = null, ahora = Date.now() }) {
    const sedes = sede && sede !== 'cualquiera' ? [sede] : Object.keys(this.calendarios);
    if (!sedes.length) return { ok: false, error: 'SIN_CALENDARIOS', cupos: [] };

    const franjas = generarFranjas({ desde, dias, duracionMin, preferencia, sedes, ahora });
    if (!franjas.length) return { ok: true, cupos: [] };

    const marcas = franjas.map(f => new Date(f.inicio).getTime());
    const ocupacion = await this.libreOcupado({
      desde: new Date(Math.min(...marcas)),
      hasta: new Date(Math.max(...marcas) + duracionMin * 60000),
      sedes
    });

    const libres = franjas.filter(f => {
      const o = ocupacion[f.sede];
      /* Una sede cuyo calendario no se pudo leer no se ofrece. En
         modo espejo se podía asumir libre; aquí no: si Calendar es
         la agenda, no leerla es no saber nada. */
      if (!o || !o.busy) return false;
      return filtrarCuposOcupados([f], o.busy).length === 1;
    });

    return { ok: true, cupos: repartir(libres, limite).map(f => ({
      cupo_id: idReservaDeFranja(f.sede, f.inicio),
      inicio: f.inicio,
      sede: f.sede,
      duracion_min: f.duracion_min,
      estudio_id: estudioId
    })) };
  }

  /* ----------------------------------------------------------
     reservar() — el candado
     ----------------------------------------------------------
     1. Insertar un evento tentativo con id derivado de la franja.
        Dos reservas del mismo inicio chocan en el mismo id: la
        segunda recibe 409. Eso es atómico y lo garantiza Google.
     2. Releer la ventana. El paso 1 no cubre los solapamientos
        parciales —45 min a las 7:00 y 25 min a las 7:30 tienen
        ids distintos— ni los bloqueos que una persona acaba de
        poner a mano.
     3. Si hay conflicto: un evento ajeno gana siempre (quien está
        delante del paciente manda). Entre dos reservas nuestras
        gana la de id menor, que es un criterio determinista: la
        otra parte llega a la conclusión contraria y se retira, así
        que no hay ni bloqueo mutuo ni doble cita.
     ---------------------------------------------------------- */
  async reservar({ sede, inicio, duracionMin = 30, estudioId = null, ventanaMin = 90 }) {
    const calId = this.calendarios[sede];
    if (!calId) return { ok: false, error: 'SEDE_SIN_CALENDARIO' };

    const ev = eventoReserva({ sede, inicio, duracionMin, estudioId });
    const ruta = `/calendars/${encodeURIComponent(calId)}/events`;
    let r = await this._llamar('POST', ruta, ev);

    if (r.status === 409) {
      /* Un id de evento borrado sigue reservado en Google. Si la
         franja se liberó antes, el evento existe pero cancelado y
         se revive; si está vivo, la franja está tomada de verdad. */
      const previo = await this._llamar('GET', `${ruta}/${ev.id}`);
      if (previo.status < 400 && previo.datos.status === 'cancelled') {
        r = await this._llamar('PATCH', `${ruta}/${ev.id}`,
          { status: 'tentative', start: ev.start, end: ev.end,
            summary: ev.summary, extendedProperties: ev.extendedProperties });
      } else {
        return { ok: false, error: 'FRANJA_TOMADA', motivo: 'id_ocupado' };
      }
    }
    if (r.status >= 400) return { ok: false, error: `RESERVA_${r.status}` };

    // --- Reverificación ---
    const ini = new Date(inicio).getTime();
    const fin = ini + duracionMin * 60000;
    const lista = await this.listarEventos({
      sede, desde: new Date(ini - ventanaMin * 60000), hasta: new Date(fin + ventanaMin * 60000)
    });
    if (!lista.ok) {
      await this.liberar({ sede, inicio });
      return { ok: false, error: 'RESERVA_NO_VERIFICABLE', detalle: lista.error };
    }

    const choca = lista.eventos.filter(e => {
      if (e.id === ev.id) return false;
      const a = new Date(e.start && (e.start.dateTime || e.start.date)).getTime();
      const b = new Date(e.end && (e.end.dateTime || e.end.date)).getTime();
      return a < fin && ini < b;
    });

    const ajeno = choca.find(e => !esNuestro(e));
    const nuestroMenor = choca.find(e => esNuestro(e) && e.id < ev.id);
    if (ajeno || nuestroMenor) {
      await this.liberar({ sede, inicio });
      return { ok: false, error: 'FRANJA_TOMADA',
               motivo: ajeno ? 'bloqueo_del_centro' : 'carrera_perdida' };
    }

    return { ok: true, reserva_id: ev.id, inicio, sede, duracion_min: duracionMin,
             etag: r.datos.etag || null };
  }

  /* Liberar una franja retenida. Borrar y no cancelar a propósito:
     así el hueco vuelve a estar disponible en freeBusy de inmediato. */
  async liberar({ sede, inicio }) {
    const calId = this.calendarios[sede];
    if (!calId) return { ok: false, error: 'SEDE_SIN_CALENDARIO' };
    const id = idReservaDeFranja(sede, inicio);
    const { status } = await this._llamar('DELETE', `/calendars/${encodeURIComponent(calId)}/events/${id}`);
    if (status === 404 || status === 410) return { ok: true, existia: false };
    if (status >= 400) return { ok: false, error: `LIBERAR_${status}` };
    return { ok: true, existia: true };
  }

  /* La reserva se convierte en la cita. El evento no cambia de id:
     sigue siendo el de la franja, que es lo que mantiene el candado
     puesto mientras exista la cita. */
  async confirmarReserva({ sede, inicio, cita }) {
    const calId = this.calendarios[sede];
    if (!calId) return { ok: false, error: 'SEDE_SIN_CALENDARIO' };
    const id = idReservaDeFranja(sede, inicio);
    const plantilla = eventoDesdeCita({ ...cita, sede, inicio });
    const { status, datos } = await this._llamar(
      'PATCH', `/calendars/${encodeURIComponent(calId)}/events/${id}`,
      { summary: plantilla.summary, description: plantilla.description,
        status: 'confirmed', extendedProperties: plantilla.extendedProperties }
    );
    if (status >= 400) return { ok: false, error: `CONFIRMAR_${status}` };
    return { ok: true, evento_id: id, etag: datos.etag || null, enlace: datos.htmlLink || null };
  }

  /* Las citas de un rango, para la agenda del CRM. Los eventos sin
     cita_id son bloqueos del centro y se devuelven marcados: la
     recepción necesita verlos, pero no son pacientes. */
  async citasEntre({ desde, hasta, sedes }) {
    const destino = sedes && sedes.length ? sedes : Object.keys(this.calendarios);
    const out = [];
    for (const sede of destino) {
      const r = await this.listarEventos({ sede, desde, hasta });
      if (!r.ok) { out.push({ sede, error: r.error }); continue; }
      for (const e of r.eventos) {
        const c = citaDesdeEvento(e);
        if (c.cancelada) continue;
        out.push({ ...c, sede, evento_id: e.id, tentativa: e.status === 'tentative' });
      }
    }
    return out;
  }

  /* events.watch: el canal caduca (Calendar da días, no meses), así
     que se renueva con un cron. La notificación llega con
     X-Goog-Resource-State y sin cuerpo útil. */
  async observar({ sede, url, tokenCanal, canalId }) {
    const calId = this.calendarios[sede];
    if (!calId) return { ok: false, error: 'SEDE_SIN_CALENDARIO' };
    const { status, datos } = await this._llamar(
      'POST', `/calendars/${encodeURIComponent(calId)}/events/watch`,
      { id: canalId, type: 'web_hook', address: url, token: tokenCanal }
    );
    if (status >= 400) return { ok: false, error: `WATCH_${status}` };
    return { ok: true, canal: datos.id, recurso: datos.resourceId, expira: Number(datos.expiration) || null };
  }
}

/* Ofrecer las tres primeras franjas libres da tres horas seguidas
   del mismo día. Se reparten por día para que el paciente elija de
   verdad, que es lo que hace una recepcionista. */
function repartir(franjas, limite) {
  const porDia = new Map();
  for (const f of franjas) {
    const dia = f.inicio.slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(f);
  }
  const dias = [...porDia.values()];
  const out = [];
  for (let i = 0; out.length < limite && i < 40; i++) {
    let avanzo = false;
    for (const d of dias) {
      if (out.length >= limite) break;
      if (d[i]) { out.push(d[i]); avanzo = true; }
    }
    if (!avanzo) break;
  }
  return out;
}

/* ------------------------------------------------------------ */
/* Autenticación: service account con JWT RS256                   */
/* ------------------------------------------------------------ */
/* Se eligió service account y no OAuth de usuario porque nadie va
   a estar reautorizando una pantalla de consentimiento a las 3 de
   la mañana. La cuenta de servicio no posee calendarios útiles por
   sí sola: se crea un calendario por sede en la cuenta de Workspace
   de Open Side y se comparte con el correo de la cuenta de servicio
   con permiso de "hacer cambios en los eventos".

   GCAL_SA_PRIVATE_KEY es un secreto. Va en el entorno, nunca en el
   repositorio, y se rota como se rota una contraseña. */
const b64url = b => Buffer.from(b).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function crearTokenServiceAccount(env = process.env, deps = {}) {
  const email = env.GCAL_SA_EMAIL;
  const clave = (env.GCAL_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const sujeto = env.GCAL_SA_SUBJECT || null;      // solo con delegación de dominio
  if (!email || !clave) return null;

  const f = deps.fetch || globalThis.fetch;
  const ahora = deps.ahora || (() => Math.floor(Date.now() / 1000));
  let cache = null;

  return async () => {
    const t = ahora();
    /* 60 s de margen: un token que caduca en vuelo produce un 401
       intermitente imposible de diagnosticar desde los logs. */
    if (cache && cache.expira > t + 60) return cache.token;

    const cabecera = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const carga = b64url(JSON.stringify({
      iss: email,
      scope: SCOPES,
      aud: OAUTH,
      iat: t,
      exp: t + 3600,
      ...(sujeto ? { sub: sujeto } : {})
    }));
    const firma = crypto.createSign('RSA-SHA256').update(`${cabecera}.${carga}`).sign(clave);
    const assertion = `${cabecera}.${carga}.${b64url(firma)}`;

    const res = await f(OAUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      }).toString()
    });
    const datos = JSON.parse(await res.text() || '{}');
    if (res.status !== 200 || !datos.access_token) {
      throw new Error(`OAUTH_${res.status}${datos.error ? '_' + datos.error : ''}`);
    }
    cache = { token: datos.access_token, expira: t + (Number(datos.expires_in) || 3600) };
    return cache.token;
  };
}

/* ------------------------------------------------------------ */
/* Fábrica: el servidor pide "un calendario" y no decide cuál     */
/* ------------------------------------------------------------ */
export function crearCalendario(env = process.env, deps = {}) {
  const calendarios = calendariosDeEntorno(env);
  const token = deps.token || crearTokenServiceAccount(env, deps);
  /* Falta configuración → calendario en memoria. Nunca a medias: un
     sistema que escribe en una sede y no en la otra es peor que uno
     que no escribe en ninguna. */
  if (!Object.keys(calendarios).length || !token) return new CalendarioMemoria();
  return new CalendarioGoogle({ calendarios, ...deps, token });
}

/* ------------------------------------------------------------ */
/* Métodos de agenda en el calendario en memoria                  */
/* ------------------------------------------------------------ */
/* Existen para que la interfaz sea una sola. El servidor nunca
   pregunta "¿hay Google?": pregunta `conectado`, y si no lo está,
   el agente usa sus herramientas locales como siempre. */
Object.assign(CalendarioMemoria.prototype, {
  async listarEventos() { return { ok: false, error: 'SIN_CALENDARIO', eventos: [] }; },
  async disponibilidad() { return { ok: false, error: 'SIN_CALENDARIO', cupos: [] }; },
  async reservar() { return { ok: false, error: 'SIN_CALENDARIO' }; },
  async liberar() { return { ok: true, existia: false }; },
  async confirmarReserva() { return { ok: false, error: 'SIN_CALENDARIO' }; },
  async citasEntre() { return []; }
});

/* ============================================================
   El calendario dentro del turno del agente
   ------------------------------------------------------------
   Dos enganches alrededor del ejecutor, y el orden entre ellos es
   la parte importante:

     antes  · agendar_cita → se toma la franja en Calendar. Si ya
              está tomada, el ejecutor ni siquiera llega a correr y
              el modelo recibe un error que sabe manejar.
     después· buscar_cupos → los cupos ofrecidos son los de Calendar
              agendar_cita → la reserva se convierte en la cita, o
              se libera si una precondición rechazó el agendamiento.

   Reservar antes y confirmar después es lo que evita el caso feo:
   una cita creada en nuestro sistema para una hora que otro acababa
   de ocupar. Y liberar en el camino de rechazo es lo que evita el
   otro: una franja retenida por una cita que nunca existió.
   ============================================================ */

export async function antesDeCalendario(nombre, input, st, calendario, trace) {
  if (!calendario || !calendario.conectado) return null;
  if (nombre !== 'agendar_cita') return null;

  const cupo = (st.cupos || []).find(c => c.cupo_id === input.cupo_id);
  /* Un cupo_id que no salió de buscar_cupos no se reserva: de eso
     ya se encarga la precondición del ejecutor, y duplicarla aquí
     solo serviría para escribir en Calendar por una alucinación. */
  if (!cupo) return null;

  const r = await calendario.reservar({
    sede: cupo.sede, inicio: cupo.inicio,
    duracionMin: cupo.duracion_min, estudioId: input.estudio_id
  }).catch(err => ({ ok: false, error: err.message }));

  if (!r.ok) {
    if (trace) trace.tools.push({ nombre: 'calendario.reservar', resultado: r.error + (r.motivo ? ' · ' + r.motivo : '') });
    if (r.error === 'FRANJA_TOMADA') {
      st.cupos = (st.cupos || []).filter(c => c.cupo_id !== input.cupo_id);
      return { ok: false, error: 'CUPO_NO_VIGENTE',
               mensaje: 'Ese horario lo tomaron mientras conversaban. Vuelve a consultar disponibilidad y ofrece otro.' };
    }
    return { ok: false, error: 'AGENDA_NO_DISPONIBLE',
             mensaje: 'No se pudo confirmar el horario contra la agenda del centro. Escala a una persona.' };
  }

  st.reserva = { sede: cupo.sede, inicio: cupo.inicio, reserva_id: r.reserva_id };
  if (trace) trace.tools.push({ nombre: 'calendario.reservar', resultado: 'franja retenida · ' + r.reserva_id });
  return null;
}

export async function despuesDeCalendario(nombre, input, res, st, calendario, trace) {
  if (!calendario || !calendario.conectado || !res) return res;

  /* --- La disponibilidad sale de Calendar, no del generador --- */
  if (nombre === 'buscar_cupos') {
    const duracion = (st.cupos && st.cupos[0] && st.cupos[0].duracion_min) || 30;
    const d = await calendario.disponibilidad({
      duracionMin: duracion, sede: input.sede, preferencia: input.preferencia_horario,
      estudioId: input.estudio_id, limite: 3
    }).catch(err => ({ ok: false, error: err.message, cupos: [] }));

    if (!d.ok) {
      if (trace) trace.guardrails.push({ nombre: 'agenda_calendar', resultado: 'no disponible · ' + d.error });
      st.cupos = [];
      return { ok: false, error: 'AGENDA_NO_DISPONIBLE',
               mensaje: 'La agenda del centro no responde. No ofrezcas horarios: escala a una persona.' };
    }

    st.cupos = d.cupos.map(c => ({
      ...c,
      etiqueta: etiquetaPanama(c.inicio),
      sede_nombre: ((SEDES[c.sede] && SEDES[c.sede].nombre) || c.sede)
    }));
    registrarCupos(st.cupos);
    if (trace) trace.tools.push({ nombre: 'calendario.disponibilidad', resultado: `${st.cupos.length} cupo(s) reales` });

    if (!st.cupos.length) {
      return { ok: true, cupos: [],
               nota: 'La agenda del centro no tiene hueco en las próximas dos semanas con esa preferencia. Pregunta por otra franja horaria o por la otra sede.' };
    }
    return { ok: true, estudio: res.estudio, cupos: st.cupos.map(c => ({
      cupo_id: c.cupo_id, cuando: c.etiqueta, sede: c.sede_nombre,
      corto: etiquetaCortaPanama(c.inicio)
    })) };
  }

  /* --- La reserva se vuelve cita, o se suelta --- */
  if (nombre === 'agendar_cita' && st.reserva) {
    const reserva = st.reserva;
    st.reserva = null;

    if (res.ok === false) {
      /* Una precondición rechazó el agendamiento: consentimiento,
         screening o cupo. La franja no puede quedarse retenida. */
      await calendario.liberar(reserva).catch(() => {});
      if (trace) trace.tools.push({ nombre: 'calendario.liberar', resultado: 'franja devuelta tras rechazo' });
      return res;
    }

    const c = await calendario.confirmarReserva({
      sede: reserva.sede, inicio: reserva.inicio, cita: res
    }).catch(err => ({ ok: false, error: err.message }));

    if (!c.ok) {
      /* La cita existe en nuestro sistema y la franja sigue retenida
         en Calendar: nadie más la puede tomar. Lo que falta es
         completar el evento, y eso se reintenta fuera del turno. */
      if (trace) trace.guardrails.push({ nombre: 'confirmar_reserva', resultado: 'pendiente · ' + c.error });
      if (st.cita) st.cita.espejoPendiente = true;
      return { ...res, espejo_pendiente: true };
    }
    if (st.cita) st.cita.googleEventoId = c.evento_id;
    if (trace) trace.tools.push({ nombre: 'calendario.confirmarReserva', resultado: c.evento_id });
    return { ...res, google_evento_id: c.evento_id };
  }

  return res;
}
