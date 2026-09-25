/* ============================================================
   Bus entre el chat y el CRM
   ------------------------------------------------------------
   El chat (lo que ve el paciente) y el CRM (lo que ve el equipo)
   son dos aplicaciones distintas, en pestañas distintas. Este
   módulo es el canal entre ellas, y hace de sustituto local de
   lo que en producción hacen Chatwoot y su webhook:

     chat  ──► publica conversación y mensajes ──►  CRM
     CRM   ──► responde como humano / cambia estado ──►  chat

   Transporte: BroadcastChannel para el tiempo real entre
   pestañas y localStorage para que el CRM encuentre las
   conversaciones al abrirse. Todo acceso a localStorage va
   envuelto: en modo privado o con el almacenamiento bloqueado
   lanza, y el CRM debe seguir funcionando.
   ============================================================ */

const CLAVE = 'openside:conversaciones:v1';
const CANAL = 'openside:crm';

const canal = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CANAL) : null;
const oyentes = new Set();

if (canal) {
  canal.onmessage = ev => { for (const cb of oyentes) { try { cb(ev.data); } catch (e) { /* un oyente roto no rompe al resto */ } } };
}

function leerTodo() {
  try {
    const crudo = localStorage.getItem(CLAVE);
    return crudo ? JSON.parse(crudo) : {};
  } catch (e) {
    return {};
  }
}

function escribirTodo(datos) {
  try { localStorage.setItem(CLAVE, JSON.stringify(datos)); } catch (e) { /* sin persistencia, seguimos en memoria */ }
}

function emitir(mensaje) {
  try { canal && canal.postMessage(mensaje); } catch (e) { /* ignorar */ }
  // La misma pestaña no recibe sus propios BroadcastChannel: se notifica a mano.
  for (const cb of oyentes) { try { cb(mensaje); } catch (e) { /* ignorar */ } }
}

/* ---------- Lectura ---------- */

export function listarConversaciones() {
  return Object.values(leerTodo()).sort((a, b) => (b.actualizado || 0) - (a.actualizado || 0));
}

export function obtenerConversacion(id) {
  return leerTodo()[id] || null;
}

/* ---------- Escritura desde el chat ---------- */

/** Crea o actualiza la conversación con el estado que dejó el agente. */
export function publicarConversacion(conv) {
  const datos = leerTodo();
  const previa = datos[conv.id] || {};
  const fusionada = normalizar({
    ...previa,
    ...conv,
    // El chat no manda los campos operativos: son del CRM y no debe pisarlos.
    asignadoA: previa.asignadoA ?? null,
    equipo: previa.equipo ?? null,
    prioridad: previa.prioridad ?? null,
    pospuestoHasta: previa.pospuestoHasta ?? null,
    esperaDesde: previa.esperaDesde ?? Date.now(),
    primeraRespuesta: previa.primeraRespuesta ?? null,
    agenteVistoEn: previa.agenteVistoEn ?? 0,
    mensajes: conv.mensajes || previa.mensajes || [],
    actualizado: Date.now()
  });
  datos[conv.id] = fusionada;
  escribirTodo(datos);
  emitir({ tipo: 'conversacion_actualizada', conversacion: fusionada });
  return fusionada;
}

/** Añade un mensaje al hilo. `autor` es 'paciente' | 'bot' | 'humano'. */
export function publicarMensaje(idConversacion, mensaje) {
  const datos = leerTodo();
  const conv = datos[idConversacion];
  if (!conv) return null;
  const completo = { id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6), ts: Date.now(), ...mensaje };
  conv.mensajes = [...(conv.mensajes || []), completo];
  conv.actualizado = Date.now();

  if (mensaje.autor === 'paciente') {
    // Vuelve a estar esperando respuesta.
    conv.esperaDesde = conv.esperaDesde || completo.ts;
    if (conv.pospuestoHasta) { conv.pospuestoHasta = null; conv.crm = { ...(conv.crm || {}), status: 'open' }; }
  } else if (!mensaje.privado) {
    if (!conv.primeraRespuesta && mensaje.autor === 'humano') conv.primeraRespuesta = completo.ts;
    conv.esperaDesde = null;        // respondida: deja de correr el reloj
    conv.agenteVistoEn = completo.ts;
  }
  escribirTodo(datos);
  emitir({ tipo: 'mensaje_nuevo', idConversacion, mensaje: completo });
  return completo;
}

/* ---------- Campos operativos (modelo tomado de Chatwoot) ---------- */

/**
 * Normaliza una conversación para que siempre tenga los campos que el CRM
 * espera. El modelo sigue al de Chatwoot: estado, asignación, equipo,
 * prioridad, posposición, y las marcas de tiempo que hacen falta para
 * calcular espera y no leídos.
 */
export function normalizar(conv) {
  const ahora = Date.now();
  return {
    asignadoA: null,          // id del agente humano, null = sin asignar
    equipo: null,
    prioridad: null,          // low | medium | high | urgent
    pospuestoHasta: null,     // marca temporal; mientras no llega, no aparece en la bandeja activa
    esperaDesde: ahora,       // desde cuándo espera respuesta (SLA)
    primeraRespuesta: null,   // para medir el tiempo a primera respuesta
    agenteVistoEn: 0,         // hasta dónde ha leído el equipo
    ...conv
  };
}

/** Estado efectivo: una conversación pospuesta cuyo plazo venció vuelve a la cola. */
export function estadoEfectivo(conv) {
  if (!conv) return 'pending';
  const estado = conv.crm?.status || 'pending';
  if (estado === 'snoozed' && conv.pospuestoHasta && conv.pospuestoHasta <= Date.now()) return 'open';
  return estado;
}

/** Mensajes del paciente que el equipo aún no ha visto. */
export function sinLeer(conv) {
  if (!conv) return 0;
  const visto = conv.agenteVistoEn || 0;
  return (conv.mensajes || []).filter(m => m.autor === 'paciente' && m.ts > visto).length;
}

/** Cambia campos operativos sueltos (asignación, prioridad, equipo…). */
export function actualizarCampos(idConversacion, campos, quien = 'humano') {
  const datos = leerTodo();
  const conv = datos[idConversacion];
  if (!conv) return null;
  Object.assign(conv, campos);
  conv.actualizado = Date.now();
  escribirTodo(datos);
  emitir({ tipo: 'campos_actualizados', idConversacion, campos, quien });
  return conv;
}

/* El consentimiento para ENTRENAR es una finalidad distinta de la
   de atender, así que vive en su propio campo y se otorga aparte.
   Mezclarlos sería justo lo que la Ley 81 no permite. */
export function marcarConsentimientoEntrenamiento(idConversacion, otorgado) {
  const datos = leerTodo();
  const conv = datos[idConversacion];
  if (!conv) return null;
  conv.crm = conv.crm || {};
  conv.crm.contacto = conv.crm.contacto || {};
  conv.crm.contacto.consentimiento_entrenamiento = Boolean(otorgado);
  conv.crm.contacto.consentimiento_entrenamiento_ts = otorgado ? new Date().toISOString() : null;
  conv.actualizado = Date.now();
  escribirTodo(datos);
  emitir({ tipo: 'campos_actualizados', idConversacion, campos: { consentimiento_entrenamiento: Boolean(otorgado) }, quien: 'humano' });
  return conv;
}

/** Marca como leída hasta ahora. */
export function marcarLeida(idConversacion) {
  const datos = leerTodo();
  const conv = datos[idConversacion];
  if (!conv) return null;
  if ((conv.agenteVistoEn || 0) >= (conv.actualizado || 0)) return conv;   // ya estaba al día
  conv.agenteVistoEn = Date.now();
  escribirTodo(datos);
  emitir({ tipo: 'leida', idConversacion });
  return conv;
}

/** Posponer: sale de la bandeja activa hasta la marca indicada. */
export function posponer(idConversacion, hasta, quien = 'humano') {
  const datos = leerTodo();
  const conv = datos[idConversacion];
  if (!conv) return null;
  conv.pospuestoHasta = hasta;
  conv.crm = { ...(conv.crm || {}), status: 'snoozed' };
  conv.actualizado = Date.now();
  escribirTodo(datos);
  emitir({ tipo: 'pospuesta', idConversacion, hasta, quien });
  return conv;
}

/** Añade o quita un label. */
export function alternarLabel(idConversacion, label) {
  const datos = leerTodo();
  const conv = datos[idConversacion];
  if (!conv) return null;
  const crm = conv.crm || (conv.crm = {});
  const actuales = new Set(crm.labels || []);
  actuales.has(label) ? actuales.delete(label) : actuales.add(label);
  crm.labels = [...actuales];
  conv.actualizado = Date.now();
  escribirTodo(datos);
  emitir({ tipo: 'labels_actualizados', idConversacion, labels: crm.labels });
  return conv;
}

/* ---------- Escritura desde el CRM ---------- */

/**
 * Cambia el estado de la conversación, igual que toggle_status en Chatwoot.
 * 'open' = la toma un humano · 'pending' = vuelve al bot · 'resolved' = cerrada.
 */
export function cambiarEstado(idConversacion, estado, quien = 'humano') {
  const datos = leerTodo();
  const conv = datos[idConversacion];
  if (!conv) return null;
  const anterior = conv.crm?.status;
  conv.crm = { ...(conv.crm || {}), status: estado };
  conv.asignado = estado === 'open' ? quien : (estado === 'pending' ? 'bot' : conv.asignado);
  conv.actualizado = Date.now();
  escribirTodo(datos);
  emitir({ tipo: 'estado_cambiado', idConversacion, estado, anterior, quien });
  return conv;
}

/** Nota privada: la ve el equipo, nunca el paciente. */
export function agregarNota(idConversacion, texto, autor = 'humano') {
  return publicarMensaje(idConversacion, { autor, texto, privado: true });
}

export function eliminarConversacion(id) {
  const datos = leerTodo();
  delete datos[id];
  escribirTodo(datos);
  emitir({ tipo: 'conversacion_eliminada', id });
}

export function limpiarTodo() {
  escribirTodo({});
  emitir({ tipo: 'limpiado' });
}

/* ---------- Suscripción ---------- */

export function suscribir(cb) {
  oyentes.add(cb);
  return () => oyentes.delete(cb);
}
