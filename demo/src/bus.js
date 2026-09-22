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
  const fusionada = {
    ...previa,
    ...conv,
    mensajes: conv.mensajes || previa.mensajes || [],
    actualizado: Date.now()
  };
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
  escribirTodo(datos);
  emitir({ tipo: 'mensaje_nuevo', idConversacion, mensaje: completo });
  return completo;
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
