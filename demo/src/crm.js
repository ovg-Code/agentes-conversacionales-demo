/* ============================================================
   CRM de Open Side · versión propia
   ------------------------------------------------------------
   Modelo tomado de Chatwoot (estados, asignación, equipos,
   prioridad, posposición, labels, SLA) con código e interfaz
   propios. Recibe las conversaciones por el bus, que hace de
   sustituto local del webhook.

   Estados:  pending (bot) · open (humano) · snoozed · resolved
   ============================================================ */

import {
  listarConversaciones, obtenerConversacion, suscribir,
  publicarMensaje, cambiarEstado, agregarNota, eliminarConversacion,
  actualizarCampos, marcarLeida, posponer, alternarLabel,
  estadoEfectivo, sinLeer
} from './bus.js';
import {
  YO, AGENTES, EQUIPOS, PRIORIDADES, LABELS, RESPUESTAS_RAPIDAS, POSPONER,
  agentePorId, equipoPorId, prioridadPorId, tonoLabel, rellenar
} from './crm-data.js';
import { formatearTexto } from './ui.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let vista = 'todas';           // todas | mias | sin_asignar | pending | snoozed | resolved
let orden = 'reciente';        // reciente | espera | prioridad
let busqueda = '';
let seleccionada = null;
let modoComposer = 'responder';
let menuAbierto = null;
let rapidasAbiertas = false;
let rapidaActiva = 0;

/* ============================================================
   Selección y orden de la bandeja
   ============================================================ */
function conversacionesVisibles() {
  const todas = listarConversaciones();
  const q = busqueda.trim().toLowerCase();

  let lista = todas.filter(c => {
    const estado = estadoEfectivo(c);
    switch (vista) {
      case 'mias':        if (c.asignadoA !== YO || estado === 'resolved') return false; break;
      case 'sin_asignar': if (c.asignadoA || estado === 'resolved' || estado === 'pending') return false; break;
      case 'pending':     if (estado !== 'pending') return false; break;
      case 'snoozed':     if (estado !== 'snoozed') return false; break;
      case 'resolved':    if (estado !== 'resolved') return false; break;
      default:            if (estado === 'resolved' || estado === 'snoozed') return false;
    }
    if (!q) return true;
    const heno = [
      c.contacto?.nombre, c.crm?.contacto?.paciente_nombre, c.crm?.contacto?.paciente_cedula,
      c.crm?.conversacion?.estudio_solicitado, agentePorId(c.asignadoA)?.nombre,
      ...(c.crm?.labels || [])
    ].filter(Boolean).join(' ').toLowerCase();
    return heno.includes(q);
  });

  const pesoPrioridad = c => (prioridadPorId(c.prioridad)?.orden ?? 9);
  lista.sort((a, b) => {
    if (orden === 'prioridad') {
      const d = pesoPrioridad(a) - pesoPrioridad(b);
      if (d) return d;
    }
    if (orden === 'espera') {
      const ea = a.esperaDesde || Infinity, eb = b.esperaDesde || Infinity;
      if (ea !== eb) return ea - eb;     // el que lleva más esperando, primero
    }
    return (b.actualizado || 0) - (a.actualizado || 0);
  });
  return lista;
}

function contadores() {
  const todas = listarConversaciones();
  const c = { todas: 0, mias: 0, sin_asignar: 0, pending: 0, snoozed: 0, resolved: 0 };
  for (const conv of todas) {
    const e = estadoEfectivo(conv);
    if (e === 'resolved') { c.resolved++; continue; }
    if (e === 'snoozed') { c.snoozed++; continue; }
    c.todas++;
    if (e === 'pending') c.pending++;
    if (conv.asignadoA === YO) c.mias++;
    if (!conv.asignadoA && e !== 'pending') c.sin_asignar++;
  }
  return c;
}

/* ============================================================
   Bandeja
   ============================================================ */
function renderBandeja() {
  const cont = contadores();
  for (const [k, v] of Object.entries(cont)) {
    const el = $('#c-' + k);
    if (el) { el.textContent = v; el.hidden = v === 0 && k !== 'todas'; }
  }

  const visibles = conversacionesVisibles();
  const lista = $('#lista');

  if (!visibles.length) {
    lista.innerHTML = `<div class="vacio">
      ${busqueda ? 'Nada coincide con la búsqueda.' : textoVacio()}
    </div>`;
    return;
  }

  lista.innerHTML = '';
  for (const c of visibles) {
    const estado = estadoEfectivo(c);
    const nombre = nombreDe(c);
    const noLeidos = sinLeer(c);
    const ultimo = [...(c.mensajes || [])].reverse().find(m => !m.privado);
    const preview = ultimo
      ? (ultimo.autor === 'paciente' ? '' : '↩ ') + (ultimo.texto || '').replace(/\*/g, '').slice(0, 70)
      : 'Sin mensajes';
    const prio = prioridadPorId(c.prioridad);
    const agente = agentePorId(c.asignadoA);

    const fila = document.createElement('button');
    fila.className = 'conv-row' + (noLeidos ? ' no-leida' : '');
    fila.type = 'button';
    fila.dataset.id = c.id;
    if (c.id === seleccionada) fila.setAttribute('aria-current', 'true');
    fila.innerHTML = `
      <div class="conv-avatar" aria-hidden="true" ${agente ? `style="background:${agente.color}"` : ''}>${iniciales(nombre)}</div>
      <div class="conv-body">
        <div class="conv-head">
          <span class="dot ${estado}" title="${etiquetaEstado(estado)}"></span>
          <span class="conv-name">${escapar(nombre)}</span>
          ${noLeidos ? `<span class="sin-leer" title="${noLeidos} sin leer">${noLeidos}</span>` : ''}
          <span class="conv-time">${horaRelativa(c.actualizado)}</span>
        </div>
        <div class="conv-preview">${escapar(preview)}</div>
        <div class="conv-tags">
          ${prio ? `<span class="pill ${prio.tono}">${prio.nombre}</span>` : ''}
          ${estado === 'snoozed' ? `<span class="pill muted">💤 ${horaRelativaFutura(c.pospuestoHasta)}</span>` : ''}
          ${agente ? `<span class="pill human">${escapar(agente.nombre.split(' ')[0])}</span>`
                   : (estado !== 'pending' ? '<span class="pill muted">sin asignar</span>' : '')}
          ${(c.crm?.labels || []).slice(0, 2).map(l => `<span class="pill ${tonoLabel(l)}">${escapar(l)}</span>`).join('')}
          ${espera(c) ? `<span class="espera ${nivelEspera(c)}" title="Lleva esperando respuesta">⏱ ${espera(c)}</span>` : ''}
        </div>
      </div>`;
    fila.addEventListener('click', () => seleccionar(c.id));
    lista.appendChild(fila);
  }
}

function textoVacio() {
  return {
    mias: 'No tienes conversaciones asignadas.',
    sin_asignar: 'Todo está asignado.',
    pending: 'El agente virtual no está atendiendo a nadie ahora.',
    snoozed: 'Nada pospuesto.',
    resolved: 'Aún no hay conversaciones resueltas.'
  }[vista] || 'Sin conversaciones. Abre el <a href="index.html">simulador de chat</a> y escribe un mensaje.';
}

/* ============================================================
   Conversación
   ============================================================ */
function renderConversacion() {
  const c = seleccionada ? obtenerConversacion(seleccionada) : null;
  const thread = $('#thread');

  if (!c) {
    $('#conv-header').hidden = true;
    $('#composer').hidden = true;
    thread.innerHTML = `<div class="vacio">
      <p><strong>Ninguna conversación seleccionada.</strong></p>
      <p>Abre el <a href="index.html">simulador de chat</a> en otra pestaña y escribe un mensaje.</p>
      <p class="atajo-pista">Pulsa <kbd>?</kbd> para ver los atajos.</p>
    </div>`;
    $('#ctx').innerHTML = '<div class="vacio">Selecciona una conversación.</div>';
    return;
  }

  const estado = estadoEfectivo(c);
  const nombre = nombreDe(c);
  const agente = agentePorId(c.asignadoA);

  $('#conv-header').hidden = false;
  $('#conv-avatar').textContent = iniciales(nombre);
  $('#conv-nombre').textContent = nombre;
  $('#conv-sub').innerHTML = `WhatsApp · ${escapar(c.contacto?.telefono || '+507 ····')} · ` +
    (estado === 'pending' ? 'atiende <strong>el agente virtual</strong>'
     : agente ? `asignada a <strong>${escapar(agente.nombre)}</strong>`
     : '<strong>sin asignar</strong>');

  renderAcciones(c, estado);
  renderHilo(c, thread);

  $('#composer').hidden = estado === 'resolved';
  actualizarPistaComposer(estado);
  renderContexto(c, estado);

  marcarLeida(c.id);
}

function renderAcciones(c, estado) {
  const cont = $('#conv-actions');
  cont.innerHTML = '';

  if (estado === 'pending') {
    cont.appendChild(boton('Tomar', 'primary', () => tomar(c.id), 'El bot deja de responder (A)'));
  } else {
    if (c.asignadoA !== YO) cont.appendChild(boton('Asignarme', 'primary', () => tomar(c.id), 'Asignártela (A)'));
    cont.appendChild(menu('Asignar', AGENTES.map(a => ({
      label: a.nombre, detalle: a.rol, activo: c.asignadoA === a.id,
      fn: () => { actualizarCampos(c.id, { asignadoA: a.id }); nota(c.id, `Asignada a ${a.nombre}.`); refrescar(); }
    })).concat([{ label: 'Quitar asignación', fn: () => { actualizarCampos(c.id, { asignadoA: null }); refrescar(); } }])));
  }

  cont.appendChild(menu('Prioridad', PRIORIDADES.map(p => ({
    label: p.nombre, tono: p.tono, activo: c.prioridad === p.id,
    fn: () => { actualizarCampos(c.id, { prioridad: p.id }); refrescar(); }
  })).concat([{ label: 'Sin prioridad', fn: () => { actualizarCampos(c.id, { prioridad: null }); refrescar(); } }])));

  if (estado !== 'resolved') {
    cont.appendChild(menu('Posponer', POSPONER.map(o => ({
      label: o.nombre,
      fn: () => { posponer(c.id, Date.now() + o.minutos * 60000); nota(c.id, `Pospuesta ${o.nombre.toLowerCase()}.`); refrescar(); }
    })), '💤'));
  }

  if (estado === 'open' || estado === 'snoozed') {
    cont.appendChild(boton('Devolver al bot', 'warn', () => {
      cambiarEstado(c.id, 'pending'); actualizarCampos(c.id, { asignadoA: null, pospuestoHasta: null });
      nota(c.id, 'Devuelta al agente virtual.'); refrescar();
    }));
  }
  if (estado !== 'resolved') {
    cont.appendChild(boton('Resolver', 'ok', () => resolver(c.id), 'Marcar como resuelta (E)'));
  } else {
    cont.appendChild(boton('Reabrir', '', () => { cambiarEstado(c.id, 'open'); refrescar(); }));
  }
}

function renderHilo(c, thread) {
  thread.innerHTML = '';
  if (!(c.mensajes || []).length) {
    thread.innerHTML = '<div class="vacio">Sin mensajes todavía.</div>';
    return;
  }
  let autorPrevio = null;
  let diaPrevio = null;

  for (const m of c.mensajes) {
    const dia = new Date(m.ts).toDateString();
    if (dia !== diaPrevio) {
      diaPrevio = dia; autorPrevio = null;
      const sep = document.createElement('div');
      sep.className = 'dia-sep';
      sep.innerHTML = `<span>${diaLegible(m.ts)}</span>`;
      thread.appendChild(sep);
    }

    const clave = m.autor + (m.privado ? ':nota' : '');
    const cambio = clave !== autorPrevio;
    autorPrevio = clave;

    const el = document.createElement('div');
    el.className = `msg ${m.autor}${m.privado ? ' privado' : ''}${cambio ? ' cambio-autor' : ''}`;
    const quien = m.privado ? '🔒 Nota privada'
      : m.autor === 'paciente' ? 'Paciente'
      : m.autor === 'bot' ? 'Sofía · asistente virtual'
      : `${agentePorId(c.asignadoA)?.nombre || 'Agente'} · Open Side`;
    const tono = m.privado ? 'warn' : m.autor === 'bot' ? 'ai' : m.autor === 'humano' ? 'human' : 'muted';
    el.innerHTML = `
      ${cambio ? `<div class="msg-meta"><span class="pill ${tono}">${escapar(quien)}</span><span>${hora(m.ts)}</span></div>` : ''}
      <div class="msg-bubble" title="${hora(m.ts)}">${formatearTexto(m.texto || '')}</div>`;
    thread.appendChild(el);
  }
  requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
}

/* ============================================================
   Panel de contexto
   ============================================================ */
function renderContexto(c, estado) {
  const contacto = c.crm?.contacto || {};
  const conv = c.crm?.conversacion || {};
  const nombre = nombreDe(c);
  const agente = agentePorId(c.asignadoA);
  const prio = prioridadPorId(c.prioridad);

  const attr = (k, v, multi) => `<div class="attr">
      <span class="k">${k}</span>
      <span class="v${multi ? ' multi' : ''}${v == null || v === '' ? ' empty' : ''}" title="${v == null ? '' : escapar(String(v))}">${v == null || v === '' ? 'sin dato' : escapar(String(v))}</span>
    </div>`;

  const screening = conv.screening_rm_estado || 'pendiente';
  const tonoScreening = screening === 'aprobado' ? 'ok' : screening === 'pendiente' ? 'muted' : 'danger';
  const previas = historialDe(c);

  $('#ctx').innerHTML = `
    <div class="ctx-person">
      <div class="conv-avatar" aria-hidden="true" ${agente ? `style="background:${agente.color}"` : ''}>${iniciales(nombre)}</div>
      <div>
        <strong>${escapar(nombre)}</strong>
        <span>${escapar(c.contacto?.telefono || 'WhatsApp')}</span>
      </div>
    </div>

    <div class="ctx-block">
      <h3>Estado</h3>
      <div class="attr"><span class="k">conversación</span><span class="v"><span class="pill ${tonoEstado(estado)}">${estado}</span></span></div>
      <div class="attr"><span class="k">asignada a</span><span class="v${agente ? '' : ' empty'}">${agente ? escapar(agente.nombre) : 'sin asignar'}</span></div>
      <div class="attr"><span class="k">prioridad</span><span class="v">${prio ? `<span class="pill ${prio.tono}">${prio.nombre}</span>` : '<span class="empty">sin definir</span>'}</span></div>
      <div class="attr"><span class="k">screening_rm</span><span class="v"><span class="pill ${tonoScreening}">${escapar(screening)}</span></span></div>
      ${espera(c) ? `<div class="attr"><span class="k">esperando</span><span class="v"><span class="espera ${nivelEspera(c)}">⏱ ${espera(c)}</span></span></div>` : ''}
      ${c.primeraRespuesta ? attr('1ª respuesta', duracion(c.primeraRespuesta - (c.mensajes?.[0]?.ts || c.primeraRespuesta))) : ''}
    </div>

    ${conv.cita_id ? `<div class="ctx-block">
      <h3>Cita confirmada</h3>
      <div class="cita-card">
        ${attr('cita_id', conv.cita_id)}
        ${attr('estudio', conv.estudio_solicitado, true)}
        ${attr('fecha', conv.cita_fecha, true)}
        ${attr('sede', conv.sede_preferida)}
      </div>
    </div>` : ''}

    <div class="ctx-block">
      <h3>Contacto</h3>
      ${attr('paciente_cedula', contacto.paciente_cedula)}
      ${attr('aseguradora', contacto.aseguradora)}
      ${attr('consentimiento', contacto.consentimiento_datos ? 'otorgado' : 'no otorgado')}
      ${attr('registrado', fechaLegible(contacto.consentimiento_ts))}
    </div>

    <div class="ctx-block">
      <h3>Conversación</h3>
      ${attr('estudio_solicitado', conv.estudio_solicitado, true)}
      ${attr('sede_preferida', conv.sede_preferida)}
      ${attr('requiere_contraste', conv.requiere_contraste == null ? null : String(conv.requiere_contraste))}
      ${attr('autorizacion_seguro', conv.autorizacion_seguro)}
    </div>

    <div class="ctx-block">
      <h3>Labels <button class="mini" id="btn-labels" type="button">editar</button></h3>
      <div class="labels" id="labels-actuales">
        ${(c.crm?.labels || []).length
          ? c.crm.labels.map(l => `<span class="pill ${tonoLabel(l)}">${escapar(l)}</span>`).join('')
          : '<span class="empty">sin labels</span>'}
      </div>
      <div class="labels-editor" id="labels-editor" hidden>
        ${LABELS.map(l => `<button class="label-opt${(c.crm?.labels || []).includes(l.id) ? ' activo' : ''}" data-label="${l.id}" type="button">
          <span class="pill ${l.tono}">${l.id}</span></button>`).join('')}
      </div>
    </div>

    ${previas.length ? `<div class="ctx-block">
      <h3>Historial del paciente</h3>
      <div class="historial">
        ${previas.map(p => `<button class="hist-row" type="button" data-id="${p.id}">
          <span class="dot ${estadoEfectivo(p)}"></span>
          <span class="hist-txt">${escapar(p.crm?.conversacion?.estudio_solicitado || 'Consulta')}</span>
          <span class="hist-fecha">${horaRelativa(p.actualizado)}</span>
        </button>`).join('')}
      </div>
    </div>` : ''}

    <div class="ctx-block">
      <h3>Acciones</h3>
      <div class="stack">
        <button class="btn block" id="btn-nota" type="button">Añadir nota privada</button>
        <button class="btn block" id="btn-eliminar" type="button">Descartar conversación</button>
      </div>
    </div>`;

  // Editor de labels
  const btnLabels = $('#btn-labels');
  if (btnLabels) btnLabels.addEventListener('click', () => {
    const ed = $('#labels-editor');
    ed.hidden = !ed.hidden;
    btnLabels.textContent = ed.hidden ? 'editar' : 'listo';
  });
  $$('.label-opt').forEach(b => b.addEventListener('click', () => {
    alternarLabel(c.id, b.dataset.label);
    refrescar();
    const ed = $('#labels-editor');
    if (ed) { ed.hidden = false; $('#btn-labels').textContent = 'listo'; }
  }));

  $$('.hist-row').forEach(b => b.addEventListener('click', () => seleccionar(b.dataset.id)));

  $('#btn-nota')?.addEventListener('click', () => { cambiarModo('nota'); $('#composer-texto').focus(); });
  $('#btn-eliminar')?.addEventListener('click', () => {
    if (!confirm('¿Descartar esta conversación de la bandeja? Solo afecta a esta demostración.')) return;
    eliminarConversacion(seleccionada);
    seleccionada = null;
    refrescar();
  });
}

/** Otras conversaciones del mismo paciente (por cédula o teléfono). */
function historialDe(c) {
  const ced = c.crm?.contacto?.paciente_cedula;
  const tel = c.contacto?.telefono;
  if (!ced && !tel) return [];
  return listarConversaciones().filter(o =>
    o.id !== c.id &&
    ((ced && o.crm?.contacto?.paciente_cedula === ced) || (tel && o.contacto?.telefono === tel))
  ).slice(0, 5);
}

/* ============================================================
   Acciones
   ============================================================ */
function seleccionar(id) {
  if (id === seleccionada) return;
  seleccionada = id;
  cerrarMenus();
  cerrarRapidas();
  // Cambiar de conversación empieza de cero: el panel no hereda el scroll
  // de la anterior, que dejaba al agente mirando un campo a media altura.
  const ctx = $('#ctx');
  if (ctx) ctx.scrollTop = 0;
  refrescar();
}

function tomar(id) {
  cambiarEstado(id, 'open', YO);
  actualizarCampos(id, { asignadoA: YO, pospuestoHasta: null });
  nota(id, `${agentePorId(YO).nombre} tomó la conversación.`);
  refrescar();
}

function resolver(id) {
  cambiarEstado(id, 'resolved');
  nota(id, 'Conversación resuelta.');
  refrescar();
}

function nota(id, texto) { agregarNota(id, texto, 'sistema'); }

function enviar() {
  const ta = $('#composer-texto');
  const texto = ta.value.trim();
  if (!texto || !seleccionada) return;

  if (modoComposer === 'nota') {
    agregarNota(seleccionada, texto, 'humano');
  } else {
    const c = obtenerConversacion(seleccionada);
    const estado = estadoEfectivo(c);
    if (estado === 'pending' || estado === 'snoozed') {
      cambiarEstado(seleccionada, 'open', YO);
      actualizarCampos(seleccionada, { asignadoA: c.asignadoA || YO, pospuestoHasta: null });
    }
    publicarMensaje(seleccionada, { autor: 'humano', texto, privado: false });
  }
  ta.value = '';
  ta.style.height = 'auto';
  cerrarRapidas();
  refrescar();
}

function cambiarModo(modo) {
  modoComposer = modo;
  $$('.composer-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.modo === modo)));
  $('#composer').classList.toggle('modo-nota', modo === 'nota');
  $('#composer-texto').placeholder = modo === 'nota'
    ? 'Nota visible solo para el equipo…   (/ para respuestas rápidas)'
    : 'Escribe tu respuesta…   (/ para respuestas rápidas)';
  const c = seleccionada ? obtenerConversacion(seleccionada) : null;
  actualizarPistaComposer(estadoEfectivo(c));
}

function actualizarPistaComposer(estado) {
  const hint = $('#composer-hint');
  if (!hint) return;
  if (modoComposer === 'nota') {
    hint.innerHTML = 'Las notas privadas <strong>no las ve el paciente</strong>.';
  } else if (estado === 'pending') {
    hint.innerHTML = 'Al responder, la conversación pasa a <strong>open</strong>, se te asigna y el bot deja de contestar.';
  } else {
    hint.innerHTML = 'El paciente recibirá este mensaje en WhatsApp.';
  }
}

/* ============================================================
   Respuestas rápidas
   ============================================================ */
function filtrarRapidas(texto) {
  const q = texto.replace(/^\//, '').toLowerCase().trim();
  return RESPUESTAS_RAPIDAS.filter(r =>
    !q || r.atajo.includes(q) || r.titulo.toLowerCase().includes(q));
}

function renderRapidas(texto) {
  const cont = $('#rapidas');
  const lista = filtrarRapidas(texto);
  if (!lista.length) { cerrarRapidas(); return; }
  rapidaActiva = Math.min(rapidaActiva, lista.length - 1);
  cont.innerHTML = lista.map((r, i) => `
    <button class="rapida${i === rapidaActiva ? ' activa' : ''}" type="button" data-i="${i}">
      <span class="rapida-titulo">${escapar(r.titulo)}</span>
      <span class="rapida-atajo">/${escapar(r.atajo)}</span>
      <span class="rapida-texto">${escapar(r.texto.split('\n')[0].slice(0, 72))}…</span>
    </button>`).join('');
  $$('.rapida', cont).forEach(b => b.addEventListener('click', () => insertarRapida(lista[+b.dataset.i])));
  cont.hidden = false;
  rapidasAbiertas = true;
}

function insertarRapida(r) {
  const c = seleccionada ? obtenerConversacion(seleccionada) : null;
  $('#composer-texto').value = rellenar(r.texto, c);
  cerrarRapidas();
  const ta = $('#composer-texto');
  ta.focus();
  ta.style.height = 'auto';
  ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
}

function cerrarRapidas() {
  $('#rapidas').hidden = true;
  rapidasAbiertas = false;
  rapidaActiva = 0;
}

/* ============================================================
   Menús desplegables
   ============================================================ */
function menu(etiqueta, opciones, icono) {
  const wrap = document.createElement('div');
  wrap.className = 'menu-wrap';
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  btn.innerHTML = `${icono ? icono + ' ' : ''}${etiqueta} <span class="caret" aria-hidden="true">▾</span>`;
  const panel = document.createElement('div');
  panel.className = 'menu-panel';
  panel.hidden = true;
  for (const o of opciones) {
    const item = document.createElement('button');
    item.className = 'menu-item' + (o.activo ? ' activo' : '');
    item.type = 'button';
    item.innerHTML = `${o.tono ? `<span class="pill ${o.tono}">${escapar(o.label)}</span>` : escapar(o.label)}
      ${o.detalle ? `<span class="menu-detalle">${escapar(o.detalle)}</span>` : ''}`;
    item.addEventListener('click', ev => { ev.stopPropagation(); cerrarMenus(); o.fn(); });
    panel.appendChild(item);
  }
  btn.addEventListener('click', ev => {
    ev.stopPropagation();
    const abierto = !panel.hidden;
    cerrarMenus();
    if (!abierto) { panel.hidden = false; menuAbierto = panel; }
  });
  wrap.append(btn, panel);
  return wrap;
}

function boton(txt, clase, fn, titulo) {
  const b = document.createElement('button');
  b.className = 'btn ' + clase; b.type = 'button'; b.textContent = txt;
  if (titulo) b.title = titulo;
  b.addEventListener('click', fn);
  return b;
}

function cerrarMenus() {
  $$('.menu-panel').forEach(p => { p.hidden = true; });
  menuAbierto = null;
}

/* ============================================================
   Atajos de teclado
   ============================================================ */
const ATAJOS = [
  ['j / k', 'Conversación siguiente / anterior'],
  ['Enter', 'Abrir la conversación enfocada'],
  ['a', 'Asignármela'],
  ['e', 'Resolver'],
  ['p', 'Devolver al agente virtual'],
  ['n', 'Escribir nota privada'],
  ['r', 'Responder al paciente'],
  ['/', 'Buscar en la bandeja'],
  ['?', 'Esta ayuda'],
  ['Esc', 'Cerrar menús y ayuda']
];

function manejarAtajo(ev) {
  const enCampo = /input|textarea/i.test(ev.target.tagName);
  if (ev.key === 'Escape') { cerrarMenus(); cerrarRapidas(); $('#ayuda').hidden = true; ev.target.blur?.(); return; }
  if (enCampo) return;
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

  const visibles = conversacionesVisibles();
  const idx = visibles.findIndex(c => c.id === seleccionada);

  switch (ev.key) {
    case 'j': if (visibles.length) { seleccionar(visibles[Math.min(idx + 1, visibles.length - 1)].id); ev.preventDefault(); } break;
    case 'k': if (visibles.length) { seleccionar(visibles[Math.max(idx - 1, 0)].id); ev.preventDefault(); } break;
    case 'a': if (seleccionada) { tomar(seleccionada); ev.preventDefault(); } break;
    case 'e': if (seleccionada) { resolver(seleccionada); ev.preventDefault(); } break;
    case 'p': if (seleccionada) {
        cambiarEstado(seleccionada, 'pending');
        actualizarCampos(seleccionada, { asignadoA: null, pospuestoHasta: null });
        nota(seleccionada, 'Devuelta al agente virtual.');
        refrescar(); ev.preventDefault();
      } break;
    case 'n': if (seleccionada) { cambiarModo('nota'); $('#composer-texto').focus(); ev.preventDefault(); } break;
    case 'r': if (seleccionada) { cambiarModo('responder'); $('#composer-texto').focus(); ev.preventDefault(); } break;
    case '/': $('#buscar').focus(); ev.preventDefault(); break;
    case '?': $('#ayuda').hidden = !$('#ayuda').hidden; ev.preventDefault(); break;
  }
}

/* ============================================================
   Refresco
   ============================================================ */
let pendienteRefresco = false;
function refrescar() {
  if (pendienteRefresco) return;
  pendienteRefresco = true;
  requestAnimationFrame(() => {
    pendienteRefresco = false;
    renderBandeja();
    renderConversacion();
  });
}

/* ============================================================
   Montaje
   ============================================================ */
function montar() {
  // Vistas de la bandeja
  $$('.inbox-filter').forEach(b => b.addEventListener('click', () => {
    vista = b.dataset.vista;
    $$('.inbox-filter').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    renderBandeja();
  }));

  // Orden
  $('#orden').addEventListener('change', e => { orden = e.target.value; renderBandeja(); });
  $('#buscar').addEventListener('input', e => { busqueda = e.target.value; renderBandeja(); });

  // Composer
  $$('.composer-tab').forEach(t => t.addEventListener('click', () => cambiarModo(t.dataset.modo)));
  $('#enviar').addEventListener('click', enviar);

  const ta = $('#composer-texto');
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
    if (ta.value.startsWith('/')) renderRapidas(ta.value); else cerrarRapidas();
  });
  ta.addEventListener('keydown', ev => {
    if (rapidasAbiertas) {
      const lista = filtrarRapidas(ta.value);
      if (ev.key === 'ArrowDown') { rapidaActiva = Math.min(rapidaActiva + 1, lista.length - 1); renderRapidas(ta.value); ev.preventDefault(); return; }
      if (ev.key === 'ArrowUp')   { rapidaActiva = Math.max(rapidaActiva - 1, 0); renderRapidas(ta.value); ev.preventDefault(); return; }
      if (ev.key === 'Enter' && !ev.shiftKey) { insertarRapida(lista[rapidaActiva]); ev.preventDefault(); return; }
      if (ev.key === 'Escape') { cerrarRapidas(); ev.preventDefault(); return; }
    }
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); enviar(); }
  });

  // Ayuda de atajos
  $('#ayuda-cerrar').addEventListener('click', () => { $('#ayuda').hidden = true; });
  $('#ayuda-lista').innerHTML = ATAJOS.map(([k, d]) =>
    `<div class="atajo"><kbd>${escapar(k)}</kbd><span>${escapar(d)}</span></div>`).join('');
  document.addEventListener('keydown', manejarAtajo);
  document.addEventListener('click', () => cerrarMenus());

  // Identidad del agente
  const yo = agentePorId(YO);
  $('#yo-nombre').textContent = yo.nombre;
  $('#yo-rol').textContent = yo.rol;
  $('#yo-avatar').textContent = iniciales(yo.nombre);
  $('#yo-avatar').style.background = yo.color;

  // Tema
  const btnTema = $('#theme');
  const aplicar = t => {
    document.documentElement.setAttribute('data-theme', t);
    btnTema.textContent = t === 'dark' ? '☀ Claro' : '🌙 Oscuro';
    try { localStorage.setItem('os-theme', t); } catch (e) { /* sin almacenamiento */ }
  };
  let inicial = 'light';
  try { inicial = localStorage.getItem('os-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { /* ignorar */ }
  aplicar(inicial);
  btnTema.addEventListener('click', () => aplicar(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

  // En vivo
  suscribir(ev => {
    if (!seleccionada && ev.tipo === 'conversacion_actualizada') seleccionada = ev.conversacion.id;
    refrescar();
  });
  window.addEventListener('storage', refrescar);

  // El reloj de espera y las posposiciones vencidas necesitan repintado periódico
  setInterval(renderBandeja, 30000);

  const primeras = conversacionesVisibles();
  if (primeras.length) seleccionada = primeras[0].id;
  refrescar();
}

/* ============================================================
   Utilidades
   ============================================================ */
function escapar(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function nombreDe(c) {
  return c.crm?.contacto?.paciente_nombre || c.contacto?.nombre || 'Paciente sin identificar';
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
function horaRelativaFutura(ts) {
  if (!ts) return '';
  const s = Math.floor((ts - Date.now()) / 1000);
  if (s <= 0) return 'ya';
  if (s < 3600) return `${Math.ceil(s / 60)} min`;
  if (s < 86400) return `${Math.ceil(s / 3600)} h`;
  return `${Math.ceil(s / 86400)} d`;
}
function duracion(ms) {
  if (ms == null) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h`;
}
function espera(c) {
  if (!c.esperaDesde) return null;
  if (estadoEfectivo(c) === 'resolved') return null;
  return horaRelativa(c.esperaDesde);
}
/** Semáforo de espera: verde bajo 5 min, ámbar bajo 15, rojo por encima. */
function nivelEspera(c) {
  const min = (Date.now() - (c.esperaDesde || Date.now())) / 60000;
  return min < 5 ? 'ok' : min < 15 ? 'warn' : 'danger';
}
function fechaLegible(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const mes = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()];
  return `${String(d.getDate()).padStart(2, '0')} ${mes} · ${hora(d.getTime())}`;
}
function diaLegible(ts) {
  const d = new Date(ts), hoy = new Date();
  const mismoDia = (a, b) => a.toDateString() === b.toDateString();
  if (mismoDia(d, hoy)) return 'Hoy';
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  if (mismoDia(d, ayer)) return 'Ayer';
  const mes = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()];
  return `${d.getDate()} ${mes}`;
}
function etiquetaEstado(e) {
  return { pending: 'Atiende el agente virtual', open: 'La tiene una persona',
           snoozed: 'Pospuesta', resolved: 'Resuelta' }[e] || e;
}
function tonoEstado(e) {
  return { pending: 'ai', open: 'warn', snoozed: 'muted', resolved: 'ok' }[e] || 'muted';
}

document.addEventListener('DOMContentLoaded', montar);
