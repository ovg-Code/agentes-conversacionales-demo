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

const BASE = 'https://www.googleapis.com/calendar/v3';
const OAUTH = 'https://oauth2.googleapis.com/token';

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
  ZONA, idEventoDesdeCita, tituloEvento, eventoDesdeCita, citaDesdeEvento, filtrarCuposOcupados
} from '../demo/src/calendario-mapeo.js';

import {
  ZONA, idEventoDesdeCita, eventoDesdeCita, citaDesdeEvento, filtrarCuposOcupados
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
/* Pegamento: el espejo dentro del turno del agente               */
/* ------------------------------------------------------------ */
/* Se llama justo después del ejecutor, donde el loop ya es async.
   Dos únicos puntos de contacto, que son los dos que importan:

     buscar_cupos  → resta la ocupación real antes de ofrecer
     agendar_cita  → escribe el espejo una vez que la cita existe

   El orden no es negociable. Primero la cita en nuestro sistema,
   después el evento en Google. Si se invierte, un fallo de red deja
   un evento sin cita: una hora bloqueada que nadie reclama. */
export async function espejarEnCalendario(nombre, res, st, calendario, trace) {
  if (!calendario || !calendario.conectado || !res || res.ok === false) return res;

  if (nombre === 'buscar_cupos' && Array.isArray(st.cupos) && st.cupos.length) {
    const marcas = st.cupos.map(c => new Date(c.inicio).getTime());
    const desde = new Date(Math.min(...marcas));
    const hasta = new Date(Math.max(...marcas) + 4 * 3600 * 1000);
    const sedes = [...new Set(st.cupos.map(c => c.sede))];
    let ocupacion;
    try {
      ocupacion = await calendario.libreOcupado({ desde, hasta, sedes });
    } catch (err) {
      /* Sin poder consultar el calendario no se afirma disponibilidad.
         Se ofrece el cupo, pero sujeto a confirmación: en un centro de
         imagen, prometer una hora que el equipo tiene en mantenimiento
         cuesta más que pedir una confirmación. */
      if (trace) trace.guardrails.push({ nombre: 'freebusy', resultado: 'no disponible · ' + err.message });
      return { ...res, verificacion_externa: 'no_disponible',
               nota: 'La disponibilidad no pudo verificarse contra el calendario del centro. Ofrece el horario como sujeto a confirmación.' };
    }

    const antes = st.cupos.length;
    st.cupos = st.cupos.filter(c => {
      const o = ocupacion[c.sede];
      if (!o || !o.busy) return true;                 // sede sin dato: no se descarta a ciegas
      return filtrarCuposOcupados([c], o.busy).length === 1;
    });
    if (trace && st.cupos.length !== antes) {
      trace.tools.push({ nombre: 'calendario.freeBusy', resultado: `${antes - st.cupos.length} cupo(s) descartado(s) por ocupación real` });
    }
    if (!st.cupos.length) {
      return { ok: true, cupos: [], verificacion_externa: 'sin_disponibilidad',
               nota: 'El calendario del centro no tiene hueco en ese rango. Pregunta por otra fecha o preferencia de horario.' };
    }
    return { ...res, verificacion_externa: 'ok',
             cupos: res.cupos.filter(c => st.cupos.some(s => s.cupo_id === c.cupo_id)) };
  }

  if (nombre === 'agendar_cita' && res.cita_id) {
    const r = await calendario.crearEvento(res).catch(err => ({ ok: false, error: err.message }));
    if (!r.ok) {
      /* La cita es válida: existe en nuestro sistema, que es la verdad.
         Lo que queda pendiente es el espejo, y se reintenta fuera del
         turno. Al paciente no se le dice nada de esto. */
      if (trace) trace.guardrails.push({ nombre: 'espejo_calendario', resultado: 'pendiente · ' + r.error });
      if (st.cita) st.cita.espejoPendiente = true;
      return { ...res, espejo_pendiente: true };
    }
    if (st.cita) st.cita.googleEventoId = r.evento_id;
    if (trace) trace.tools.push({ nombre: 'calendario.events.insert', resultado: r.duplicado ? 'ya existía (idempotente)' : r.evento_id });
    return { ...res, google_evento_id: r.evento_id };
  }

  return res;
}
