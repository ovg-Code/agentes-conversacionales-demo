/* ============================================================
   CRM de Open Side · versión propia
   ------------------------------------------------------------
   Aplicación independiente del chat. Recibe las conversaciones
   por el bus (demo/src/bus.js), que hace de sustituto local del
   webhook de Chatwoot, y permite al equipo humano tomar el
   control, responder, dejar notas privadas y devolver la
   conversación al bot.

   Modelo de estados, igual que en el diseño:
     pending  → la atiende el agente virtual
     open     → la tiene una persona
     resolved → cerrada
   ============================================================ */

import {
  listarConversaciones, obtenerConversacion, suscribir,
  publicarMensaje, cambiarEstado, agregarNota, limpiarTodo
} from './bus.js';
// El agente escribe con el formato de WhatsApp (*negrita*). El CRM muestra
// el mismo texto, así que lo renderiza igual en vez de enseñar los asteriscos.
import { formatearTexto } from './ui.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let filtro = 'todas';
let busqueda = '';
let seleccionada = null;
let modoComposer = 'responder';

/* ============================================================
   Render de la bandeja
   ============================================================ */
function renderBandeja() {
  const todas = listarConversaciones();

  const contadores = { todas: todas.length, pending: 0, open: 0, resolved: 0 };
  for (const c of todas) {
    const s = c.crm?.status || 'pending';
    if (contadores[s] != null) contadores[s]++;
  }
  for (const k of Object.keys(contadores)) {
    const el = $('#c-' + k);
    if (el) el.textContent = contadores[k];
  }

  const q = busqueda.trim().toLowerCase();
  const visibles = todas.filter(c => {
    if (filtro !== 'todas' && (c.crm?.status || 'pending') !== filtro) return false;
    if (!q) return true;
    const heno = [
      c.contacto?.nombre, c.crm?.contacto?.paciente_nombre, c.crm?.contacto?.paciente_cedula,
      c.crm?.conversacion?.estudio_solicitado, ...(c.crm?.labels || [])
    ].filter(Boolean).join(' ').toLowerCase();
    return heno.includes(q);
  });

  const lista = $('#lista');
  if (!visibles.length) {
    lista.innerHTML = `<div class="thread-empty" style="padding:var(--sp-8) var(--sp-4)">
      ${todas.length ? 'Ninguna conversación con ese filtro.' : 'Sin conversaciones todavía.'}
    </div>`;
    return;
  }

  lista.innerHTML = '';
  for (const c of visibles) {
    const estado = c.crm?.status || 'pending';
    const nombre = c.crm?.contacto?.paciente_nombre || c.contacto?.nombre || 'Paciente sin identificar';
    const ultimo = [...(c.mensajes || [])].reverse().find(m => !m.privado);
    const preview = ultimo ? (ultimo.autor === 'paciente' ? '' : '↩ ') + (ultimo.texto || '').replace(/\*/g, '').slice(0, 64) : 'Sin mensajes';

    const fila = document.createElement('button');
    fila.className = 'conv-row';
    fila.type = 'button';
    fila.setAttribute('role', 'listitem');
    if (c.id === seleccionada) fila.setAttribute('aria-current', 'true');
    fila.innerHTML = `
      <div class="conv-avatar" aria-hidden="true">${iniciales(nombre)}</div>
      <div class="conv-body">
        <div class="conv-head">
          <span class="dot ${estado}" title="${etiquetaEstado(estado)}"></span>
          <span class="conv-name">${escapar(nombre)}</span>
          <span class="conv-time">${horaRelativa(c.actualizado)}</span>
        </div>
        <div class="conv-preview">${escapar(preview)}</div>
        ${(c.crm?.labels || []).length ? `<div class="conv-tags">${
          c.crm.labels.slice(0, 3).map(l => `<span class="pill ${tonoLabel(l)}">${escapar(l)}</span>`).join('')
        }</div>` : ''}
      </div>`;
    fila.addEventListener('click', () => seleccionar(c.id));
    lista.appendChild(fila);
  }
}

/* ============================================================
   Render de la conversación
   ============================================================ */
function renderConversacion() {
  const c = seleccionada ? obtenerConversacion(seleccionada) : null;
  const thread = $('#thread');

  if (!c) {
    $('#conv-header').hidden = true;
    $('#composer').hidden = true;
    thread.innerHTML = `<div class="thread-empty">
      <p><strong>Ninguna conversación seleccionada.</strong></p>
      <p>Abre el <a href="index.html">simulador de chat</a> en otra pestaña y escribe un mensaje: la conversación aparecerá aquí en vivo, igual que llegaría desde WhatsApp.</p>
    </div>`;
    $('#ctx').innerHTML = '<div class="thread-empty">Selecciona una conversación para ver los datos del paciente.</div>';
    return;
  }

  const estado = c.crm?.status || 'pending';
  const nombre = c.crm?.contacto?.paciente_nombre || c.contacto?.nombre || 'Paciente sin identificar';

  $('#conv-header').hidden = false;
  $('#conv-avatar').textContent = iniciales(nombre);
  $('#conv-nombre').textContent = nombre;
  $('#conv-sub').innerHTML = `WhatsApp · ${escapar(c.contacto?.telefono || '+507 ····')} · atiende <strong>${estado === 'pending' ? 'el agente virtual' : (c.asignado === 'bot' ? 'el agente virtual' : 'una persona')}</strong>`;

  // Acciones según estado
  const acciones = $('#conv-actions');
  acciones.innerHTML = '';
  const boton = (txt, clase, fn, titulo) => {
    const b = document.createElement('button');
    b.className = 'btn ' + clase; b.type = 'button'; b.textContent = txt;
    if (titulo) b.title = titulo;
    b.addEventListener('click', fn);
    acciones.appendChild(b);
  };
  if (estado === 'pending') {
    boton('Tomar conversación', 'primary', () => accionEstado('open'), 'El bot deja de responder y la atiendes tú');
  }
  if (estado === 'open') {
    boton('Devolver al bot', 'warn', () => accionEstado('pending'), 'El agente virtual retoma la conversación');
  }
  if (estado !== 'resolved') {
    boton('Resolver', 'ok', () => accionEstado('resolved'));
  } else {
    boton('Reabrir', '', () => accionEstado('open'));
  }

  // Hilo
  thread.innerHTML = '';
  if (!(c.mensajes || []).length) {
    thread.innerHTML = '<div class="thread-empty">Sin mensajes todavía.</div>';
  }
  // Se agrupan los mensajes consecutivos del mismo autor: repetir la
  // etiqueta en cada burbuja es ruido, y el cambio de autor es
  // justamente lo que el ojo necesita ver.
  let autorPrevio = null;
  for (const m of c.mensajes || []) {
    const clave = m.autor + (m.privado ? ':nota' : '');
    const cambio = clave !== autorPrevio;
    autorPrevio = clave;

    const el = document.createElement('div');
    el.className = `msg ${m.autor}${m.privado ? ' privado' : ''}${cambio ? ' cambio-autor' : ''}`;
    const quien = m.privado ? '🔒 Nota privada'
      : m.autor === 'paciente' ? 'Paciente'
      : m.autor === 'bot' ? 'Sofía · asistente virtual'
      : 'Agente · Open Side';
    const tono = m.privado ? 'warn' : m.autor === 'bot' ? 'ai' : m.autor === 'humano' ? 'human' : 'muted';
    el.innerHTML = `
      ${cambio ? `<div class="msg-meta"><span class="pill ${tono}">${escapar(quien)}</span><span>${hora(m.ts)}</span></div>` : ''}
      <div class="msg-bubble" title="${hora(m.ts)}">${formatearTexto(m.texto || '')}</div>`;
    thread.appendChild(el);
  }
  requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });

  // Composer
  $('#composer').hidden = estado === 'resolved';
  actualizarPistaComposer(estado);

  renderContexto(c);
}

/* ============================================================
   Panel de contexto
   ============================================================ */
function renderContexto(c) {
  const contacto = c.crm?.contacto || {};
  const conv = c.crm?.conversacion || {};
  const nombre = contacto.paciente_nombre || c.contacto?.nombre || 'Paciente sin identificar';

  const attr = (k, v, titulo) => `<div class="attr" ${titulo ? `title="${escapar(titulo)}"` : ''}>
      <span class="k">${k}</span>
      <span class="v${v == null || v === '' ? ' empty' : ''}" title="${v == null ? '' : escapar(String(v))}">${v == null || v === '' ? 'sin dato' : escapar(String(v))}</span>
    </div>`;
  const attrMulti = (k, v) => `<div class="attr">
      <span class="k">${k}</span>
      <span class="v multi${v == null || v === '' ? ' empty' : ''}">${v == null || v === '' ? 'sin dato' : escapar(String(v))}</span>
    </div>`;

  const screening = conv.screening_rm_estado || 'pendiente';
  const tonoScreening = screening === 'aprobado' ? 'ok' : screening === 'pendiente' ? 'muted' : 'danger';

  $('#ctx').innerHTML = `
    <div class="ctx-person">
      <div class="conv-avatar" aria-hidden="true">${iniciales(nombre)}</div>
      <div>
        <strong>${escapar(nombre)}</strong>
        <span>${escapar(c.contacto?.telefono || 'WhatsApp')}</span>
      </div>
    </div>

    <div class="ctx-block">
      <h3>Estado</h3>
      <div class="attr"><span class="k">conversación</span>
        <span class="v"><span class="pill ${c.crm?.status === 'open' ? 'warn' : c.crm?.status === 'resolved' ? 'ok' : 'ai'}">${escapar(c.crm?.status || 'pending')}</span></span></div>
      <div class="attr"><span class="k">screening_rm</span>
        <span class="v"><span class="pill ${tonoScreening}">${escapar(screening)}</span></span></div>
    </div>

    ${conv.cita_id ? `<div class="ctx-block">
      <h3>Cita confirmada</h3>
      <div class="crm-card" style="border-left:3px solid var(--sem-success)">
        ${attr('cita_id', conv.cita_id)}
        ${attr('estudio', conv.estudio_solicitado)}
        ${attr('fecha', conv.cita_fecha)}
        ${attr('sede', conv.sede_preferida)}
      </div>
    </div>` : ''}

    <div class="ctx-block">
      <h3>Contacto</h3>
      ${attr('paciente_cedula', contacto.paciente_cedula)}
      ${attr('aseguradora', contacto.aseguradora)}
      ${attr('consentimiento', contacto.consentimiento_datos ? 'otorgado' : 'no otorgado',
             'Ley 81 de 2019 · el consentimiento queda registrado con fecha y hora')}
      ${attr('registrado', fechaLegible(contacto.consentimiento_ts))}
    </div>

    <div class="ctx-block">
      <h3>Conversación</h3>
      ${attrMulti('estudio_solicitado', conv.estudio_solicitado)}
      ${attr('sede_preferida', conv.sede_preferida)}
      ${attr('requiere_contraste', conv.requiere_contraste == null ? null : String(conv.requiere_contraste))}
      ${attr('autorizacion_seguro', conv.autorizacion_seguro)}
    </div>

    ${(c.crm?.labels || []).length ? `<div class="ctx-block">
      <h3>Labels</h3>
      <div class="labels">${c.crm.labels.map(l => `<span class="pill ${tonoLabel(l)}">${escapar(l)}</span>`).join('')}</div>
    </div>` : ''}

    <div class="ctx-block">
      <h3>Acciones</h3>
      <div class="stack">
        <button class="btn block" id="btn-nota" type="button">Añadir nota privada</button>
        <button class="btn block" id="btn-eliminar" type="button">Descartar conversación</button>
      </div>
    </div>`;

  const bNota = $('#btn-nota');
  if (bNota) bNota.addEventListener('click', () => {
    cambiarModo('nota');
    $('#composer-texto').focus();
  });
  const bDel = $('#btn-eliminar');
  if (bDel) bDel.addEventListener('click', () => {
    if (!confirm('¿Descartar esta conversación de la bandeja? Solo afecta a esta demostración.')) return;
    import('./bus.js').then(m => { m.eliminarConversacion(seleccionada); seleccionada = null; refrescar(); });
  });
}

/* ============================================================
   Acciones
   ============================================================ */
function seleccionar(id) {
  seleccionada = id;
  refrescar();
}

function accionEstado(estado) {
  if (!seleccionada) return;
  cambiarEstado(seleccionada, estado, 'humano');
  const textos = {
    open: 'Un agente de Open Side tomó la conversación.',
    pending: 'La conversación volvió al agente virtual.',
    resolved: 'Conversación resuelta.'
  };
  agregarNota(seleccionada, textos[estado], 'sistema');
  refrescar();
}

function enviar() {
  const ta = $('#composer-texto');
  const texto = ta.value.trim();
  if (!texto || !seleccionada) return;

  if (modoComposer === 'nota') {
    agregarNota(seleccionada, texto, 'humano');
  } else {
    // Responder implica tomar la conversación: el bot deja de contestar.
    const c = obtenerConversacion(seleccionada);
    if ((c?.crm?.status || 'pending') === 'pending') cambiarEstado(seleccionada, 'open', 'humano');
    publicarMensaje(seleccionada, { autor: 'humano', texto, privado: false });
  }
  ta.value = '';
  ta.style.height = 'auto';
  refrescar();
}

function cambiarModo(modo) {
  modoComposer = modo;
  $$('.composer-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.modo === modo)));
  $('#composer').classList.toggle('modo-nota', modo === 'nota');
  $('#composer-texto').placeholder = modo === 'nota'
    ? 'Nota visible solo para el equipo…'
    : 'Escribe tu respuesta…';
  const c = seleccionada ? obtenerConversacion(seleccionada) : null;
  actualizarPistaComposer(c?.crm?.status || 'pending');
}

function actualizarPistaComposer(estado) {
  const hint = $('#composer-hint');
  if (!hint) return;
  if (modoComposer === 'nota') {
    hint.innerHTML = 'Las notas privadas <strong>no las ve el paciente</strong>. Úsalas para dejar contexto al siguiente agente.';
  } else if (estado === 'pending') {
    hint.innerHTML = 'El paciente recibirá este mensaje en WhatsApp. Al responder, la conversación pasa a <strong>open</strong> y el bot deja de contestar.';
  } else {
    hint.innerHTML = 'El paciente recibirá este mensaje en WhatsApp.';
  }
}

function refrescar() {
  renderBandeja();
  renderConversacion();
}

/* ============================================================
   Montaje
   ============================================================ */
function montar() {
  $$('.inbox-filter').forEach(b => b.addEventListener('click', () => {
    filtro = b.dataset.filtro;
    $$('.inbox-filter').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    renderBandeja();
  }));

  $('#buscar').addEventListener('input', e => { busqueda = e.target.value; renderBandeja(); });

  $$('.composer-tab').forEach(t => t.addEventListener('click', () => cambiarModo(t.dataset.modo)));
  $('#enviar').addEventListener('click', enviar);

  const ta = $('#composer-texto');
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; });
  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); enviar(); }
  });

  // Tema
  const btnTema = $('#theme');
  const aplicar = t => {
    document.documentElement.setAttribute('data-theme', t);
    btnTema.textContent = t === 'dark' ? '☀ Claro' : '🌙 Oscuro';
    try { localStorage.setItem('os-theme', t); } catch (e) { /* sin almacenamiento */ }
  };
  let inicial = 'light';
  try {
    inicial = localStorage.getItem('os-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch (e) { /* ignorar */ }
  aplicar(inicial);
  btnTema.addEventListener('click', () =>
    aplicar(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

  // En vivo: cualquier cambio en el bus repinta
  suscribir(ev => {
    if (!seleccionada && ev.tipo === 'conversacion_actualizada') seleccionada = ev.conversacion.id;
    refrescar();
  });

  // Entre pestañas distintas, localStorage también avisa
  window.addEventListener('storage', refrescar);

  const primeras = listarConversaciones();
  if (primeras.length) seleccionada = primeras[0].id;
  refrescar();
}

/* ---------- Utilidades ---------- */
function escapar(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function iniciales(nombre) {
  const p = String(nombre || '?').trim().split(/\s+/);
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase();
}
function hora(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'a.m.' : 'p.m.'}`;
}
function horaRelativa(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
function fechaLegible(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()];
  return `${dia} ${mes} · ${hora(d.getTime())}`;
}
function etiquetaEstado(e) {
  return { pending: 'Atiende el agente virtual', open: 'La tiene una persona', resolved: 'Resuelta' }[e] || e;
}
function tonoLabel(l) {
  if (l === 'urgente') return 'danger';
  if (l === 'escalado-humano' || l === 'screening-bloqueado') return 'warn';
  if (l === 'resuelto-por-bot') return 'ok';
  return 'info';
}

document.addEventListener('DOMContentLoaded', montar);
