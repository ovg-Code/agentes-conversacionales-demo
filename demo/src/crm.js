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
  YO, AGENTES, EQUIPOS, PRIORIDADES, LABELS, RESPUESTAS_RAPIDAS, POSPONER, MACROS, leerAjustes,
  agentePorId, equipoPorId, prioridadPorId, tonoLabel, rellenar
} from './crm-data.js';
import { formatearTexto } from './ui.js';
import { pintarIconos, icono } from './iconos.js';
import { enlazarHermanas } from './hermanas.js';
import { renderPacientes, renderInformes, renderAjustes } from './crm-secciones.js';
import { ejecutarMacro, ejecutarEnBloque, ejecutarAccion } from './crm-acciones.js';
import {
  renderDia, renderSemana, renderLista, renderFicha,
  ocupacionDia, citasDelDia, citasDeSemana, inicioDeSemana,
  diaLargo, diaCorto, esHoy, listarCitas, sincronizarAgenda, estadoAgendaRemota,
  renderEsqueletoAgenda
} from './crm-agenda.js';
import { renderResultados, buscar } from './crm-buscador.js';
import { filtrarGrupos, renderPaleta } from './command.js';
import {
  renderEntrenamiento, listarCorrecciones, anotarCorreccion, MOTIVOS
} from './crm-entrenamiento.js';
import { createAgent } from './agent.js';
import { toast, toastOk, toastError } from './sonner.js';
import {
  ATRIBUTOS, OPERADORES, atributoPorClave, cumple, describir,
  listarVistas, guardarVista, borrarVista, vistaPorId
} from './crm-filtros.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let vista = 'todas';           // todas | mias | sin_asignar | pending | snoozed | resolved
let orden = 'reciente';        // reciente | espera | prioridad
let busqueda = '';
let seleccionada = null;
let modoComposer = 'responder';
let menuAbierto = null;
let seccion = 'conversaciones';
let filtroPacientes = '';
let seleccion = new Set();       // ids marcados para acciones en bloque
let citando = null;              // mensaje al que se está respondiendo
let buscadorActivo = 0;
let resultadosBusqueda = [];
let agVista = 'semana';
let agFecha = new Date();
let agSede = 'todas';
let agCita = null;
let condiciones = [];            // filtro avanzado en construcción
let union = 'y';
let vistaActiva = null;          // id de la vista guardada aplicada
let adjuntoPendiente = null;     // archivo listo para enviarse con el mensaje
let mencionesAbiertas = false;
let mencionActiva = 0;
let rapidasAbiertas = false;
let rapidaActiva = 0;

/* ============================================================
   Selección y orden de la bandeja
   ============================================================ */
function conversacionesVisibles() {
  const todas = listarConversaciones();
  const q = busqueda.trim().toLowerCase();

  const hayFiltro = condiciones.some(c => c.atributo && c.operador);
  let lista = todas.filter(c => {
    const estado = estadoEfectivo(c);
    // Con un filtro avanzado activo manda el filtro: la vista dejaría fuera
    // resultados que el usuario acaba de pedir explícitamente.
    if (hayFiltro) { if (!cumple(c, condiciones, union)) return false; }
    else switch (vista) {
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
    fila.className = 'conv-row' + (noLeidos ? ' no-leida' : '') + (seleccion.has(c.id) ? ' marcada' : '');
    fila.type = 'button';
    fila.dataset.id = c.id;
    if (c.id === seleccionada) fila.setAttribute('aria-current', 'true');
    fila.innerHTML = `
      <span class="conv-check" role="checkbox" aria-checked="${seleccion.has(c.id)}" tabindex="-1"
            title="Seleccionar para acciones en bloque">${seleccion.has(c.id) ? icono('check', { size: 13 }) : ''}</span>
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
          ${estado === 'snoozed' ? `<span class="pill muted">${icono('campana-dormir', { size: 11 })}${horaRelativaFutura(c.pospuestoHasta)}</span>` : ''}
          ${agente ? `<span class="pill human">${escapar(agente.nombre.split(' ')[0])}</span>`
                   : (estado !== 'pending' ? '<span class="pill muted">sin asignar</span>' : '')}
          ${(c.crm?.labels || []).slice(0, 2).map(l => `<span class="pill ${tonoLabel(l)}">${escapar(l)}</span>`).join('')}
          ${espera(c) ? `<span class="espera ${nivelEspera(c)}" title="Lleva esperando respuesta">${icono('reloj', { size: 11 })}${espera(c)}</span>` : ''}
        </div>
      </div>`;
    // El recuadro alterna la selección sin abrir la conversación.
    fila.querySelector('.conv-check').addEventListener('click', ev => {
      ev.stopPropagation();
      alternarSeleccion(c.id);
    });
    fila.addEventListener('click', ev => {
      // Ctrl/⌘ o mayúsculas seleccionan en vez de abrir, como en cualquier bandeja.
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey) { ev.preventDefault(); alternarSeleccion(c.id); return; }
      seleccionar(c.id);
    });
    fila.addEventListener('contextmenu', ev => { ev.preventDefault(); abrirMenuContextual(ev, c); });
    lista.appendChild(fila);
  }
}

function alternarSeleccion(id) {
  seleccion.has(id) ? seleccion.delete(id) : seleccion.add(id);
  renderBandeja();
  renderBarraBloque();
}

function limpiarSeleccion() {
  seleccion.clear();
  renderBandeja();
  renderBarraBloque();
}

function renderBarraBloque() {
  const barra = $('#bloque');
  if (!seleccion.size) { barra.hidden = true; return; }
  barra.hidden = false;
  $('#bloque-conteo').textContent = seleccion.size;
  $('#bloque-plural').textContent = seleccion.size === 1 ? 'conversación' : 'conversaciones';
}

function aplicarEnBloque(accion, descripcion) {
  const ids = [...seleccion];
  ejecutarEnBloque(ids, accion);
  limpiarSeleccion();
  avisar(`${descripcion} · ${ids.length} ${ids.length === 1 ? 'conversación' : 'conversaciones'}`, 'ok');
  refrescar();
}

/* ---------- Menú contextual ---------- */
function abrirMenuContextual(ev, c) {
  cerrarMenus();
  const m = $('#contextual');
  const estado = estadoEfectivo(c);
  const opciones = [
    { label: 'Abrir', icono: 'mensajes', fn: () => seleccionar(c.id) },
    { label: seleccion.has(c.id) ? 'Quitar de la selección' : 'Añadir a la selección', icono: 'check', fn: () => alternarSeleccion(c.id) },
    { sep: true },
    { label: 'Asignármela', icono: 'usuario-mas', fn: () => tomar(c.id) },
    { label: 'Marcar urgente', icono: 'circulo-alerta', fn: () => { ejecutarAccion(c.id, { tipo: 'prioridad', valor: 'urgent' }); refrescar(); } },
    { label: 'Posponer 1 hora', icono: 'campana-dormir', fn: () => { ejecutarAccion(c.id, { tipo: 'posponer', valor: 60 }); refrescar(); } },
    { sep: true },
    ...(estado !== 'resolved' ? [{ label: 'Resolver', icono: 'check', fn: () => resolver(c.id) }] : []),
    ...(estado !== 'pending' ? [{ label: 'Devolver al agente virtual', icono: 'bot', fn: () => { ejecutarAccion(c.id, { tipo: 'devolver_bot' }); refrescar(); } }] : [])
  ];

  m.innerHTML = opciones.map((o, i) => o.sep
    ? '<div class="menu-sep"></div>'
    : `<button class="menu-item" type="button" data-i="${i}">${icono(o.icono, { size: 15 })}<span>${escapar(o.label)}</span></button>`).join('');
  $$('.menu-item', m).forEach(b => b.addEventListener('click', ev2 => {
    ev2.stopPropagation();
    m.hidden = true;
    opciones[+b.dataset.i].fn();
  }));

  // Se sitúa donde está el puntero, sin salirse de la ventana.
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(ev.clientX, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(ev.clientY, innerHeight - r.height - 8) + 'px';
  menuAbierto = m;
}

/* ---------- Aviso efímero ----------
   Era una píldora centrada abajo, que tapaba el compositor justo
   después de escribir. Ahora es un toast a la derecha, apilable. */
function avisar(texto, tono = 'info') { toast(texto, { tono }); }

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
  renderCita();
  renderAdjuntoPendiente();
  actualizarPistaComposer(estado);
  renderContexto(c, estado);

  marcarLeida(c.id);
}

function renderAcciones(c, estado) {
  const cont = $('#conv-actions');
  cont.innerHTML = '';

  if (estado === 'pending') {
    cont.appendChild(boton('Tomar', 'primary', () => tomar(c.id), 'El bot deja de responder (A)', 'usuario-mas'));
  } else {
    if (c.asignadoA !== YO) cont.appendChild(boton('Asignarme', 'primary', () => tomar(c.id), 'Asignártela (A)', 'usuario-mas'));
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
    })), 'campana-dormir'));
  }

  if (estado === 'open' || estado === 'snoozed') {
    cont.appendChild(botonIcono('Devolver al bot', 'warn', 'bot', () => {
      cambiarEstado(c.id, 'pending'); actualizarCampos(c.id, { asignadoA: null, pospuestoHasta: null });
      nota(c.id, 'Devuelta al agente virtual.'); refrescar();
    }));
  }
  cont.appendChild(menu('Macros', MACROS.map(m => ({
    label: m.nombre, detalle: m.descripcion,
    fn: () => {
      const r = ejecutarMacro(c.id, m.id);
      if (r) toastOk(`Macro «${r.macro.nombre}»`, { detalle: r.hechos.join(' · ') });
      refrescar();
    }
  })), 'rayo'));

  if (estado !== 'resolved') {
    cont.appendChild(boton('Resolver', 'ok', () => resolver(c.id), 'Marcar como resuelta (E)', 'check'));
  } else {
    cont.appendChild(boton('Reabrir', '', () => { cambiarEstado(c.id, 'open'); refrescar(); }, null, 'rotar'));
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
    const quien = m.privado ? 'Nota privada'
      : m.autor === 'paciente' ? 'Paciente'
      : m.autor === 'bot' ? 'Sofía · asistente virtual'
      : `${agentePorId(c.asignadoA)?.nombre || 'Agente'} · Open Side`;
    const tono = m.privado ? 'warn' : m.autor === 'bot' ? 'ai' : m.autor === 'humano' ? 'human' : 'muted';
    el.innerHTML = `
      ${cambio ? `<div class="msg-meta"><span class="pill ${tono}">${m.privado ? icono('nota', { size: 11 }) : ''}${escapar(quien)}</span><span>${hora(m.ts)}</span></div>` : ''}
      <div class="msg-bubble" title="${hora(m.ts)}">${m.privado ? '' : ''}${m.responde ? `<span class="respuesta-a"><b>${escapar(m.responde.autor === 'paciente' ? 'Paciente' : m.responde.autor === 'bot' ? 'Sofía' : 'Agente')}</b>${escapar(m.responde.texto.replace(/\*/g, ''))}</span>` : ''}${m.privado ? resaltarMenciones(m.texto || '') : formatearTexto(m.texto || '')}${m.adjunto ? renderAdjunto(m.adjunto) : ''}</div>
      ${m.privado ? '' : `<span class="msg-acciones">
        <button class="msg-citar" type="button" title="Responder a este mensaje">${icono('atras', { size: 13 })}Responder</button>
        ${m.autor === 'bot' ? `<button class="msg-marcar" type="button" title="Marcar esta respuesta para entrenamiento">${icono('chispa', { size: 13 })}Marcar</button>` : ''}
      </span>`}`;
    const btnCitar = el.querySelector('.msg-citar');
    if (btnCitar) btnCitar.addEventListener('click', () => citar(m));
    const btnMarcar = el.querySelector('.msg-marcar');
    if (btnMarcar) btnMarcar.addEventListener('click', () => abrirMarcar(m, c.id));
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
      ${espera(c) ? `<div class="attr"><span class="k">esperando</span><span class="v"><span class="espera ${nivelEspera(c)}">${icono('reloj', { size: 11 })}${espera(c)}</span></span></div>` : ''}
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
        <button class="btn block" id="btn-exportar" type="button">Exportar transcripción</button>
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
  $('#btn-exportar')?.addEventListener('click', () => exportar(c));
  $('#btn-eliminar')?.addEventListener('click', () => {
    if (!confirm('¿Descartar esta conversación de la bandeja? Solo afecta a esta demostración.')) return;
    eliminarConversacion(seleccionada);
    seleccionada = null;
    refrescar();
  });
}

/** Descarga la conversación como texto plano, notas incluidas. */
function exportar(c) {
  const lineas = [
    `Conversación · Open Side`,
    `Paciente: ${nombreDe(c)}`,
    `Teléfono: ${c.contacto?.telefono || '—'}`,
    `Cédula: ${c.crm?.contacto?.paciente_cedula || '—'}`,
    `Estudio: ${c.crm?.conversacion?.estudio_solicitado || '—'}`,
    `Estado: ${estadoEfectivo(c)}`,
    `Exportada: ${new Date().toLocaleString('es-PA')}`,
    '',
    '─'.repeat(60),
    ''
  ];
  for (const m of c.mensajes || []) {
    const quien = m.privado ? '[NOTA PRIVADA]'
      : m.autor === 'paciente' ? 'Paciente'
      : m.autor === 'bot' ? 'Sofía (asistente virtual)'
      : 'Agente';
    lineas.push(`[${new Date(m.ts).toLocaleString('es-PA')}] ${quien}:`);
    lineas.push((m.texto || '').replace(/\*/g, ''));
    if (m.adjunto) lineas.push(`   (adjunto: ${m.adjunto.nombre})`);
    lineas.push('');
  }
  lineas.push('─'.repeat(60));
  lineas.push('Documento de demostración con datos ficticios.');

  const blob = new Blob([lineas.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `conversacion-${(nombreDe(c) || 'paciente').replace(/\s+/g, '-').toLowerCase()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  avisar('Transcripción descargada', 'ok');
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
  if ((!texto && !adjuntoPendiente) || !seleccionada) return;

  if (modoComposer === 'nota') {
    agregarNota(seleccionada, texto, 'humano');
  } else {
    const c = obtenerConversacion(seleccionada);
    const estado = estadoEfectivo(c);
    if (estado === 'pending' || estado === 'snoozed') {
      cambiarEstado(seleccionada, 'open', YO);
      actualizarCampos(seleccionada, { asignadoA: c.asignadoA || YO, pospuestoHasta: null });
    }
    publicarMensaje(seleccionada, {
      autor: 'humano', texto, privado: false,
      adjunto: adjuntoPendiente,
      responde: citando ? { texto: (citando.texto || '').slice(0, 140), autor: citando.autor } : null
    });
    citando = null;
    adjuntoPendiente = null;
    renderCita();
    renderAdjuntoPendiente();
  }
  ta.value = '';
  ta.style.height = 'auto';
  cerrarRapidas();
  refrescar();
}

async function elegirAdjunto(archivo) {
  if (!archivo) return;
  const maxKB = leerAjustes().adjuntoMaxKB;
  if (archivo.size > maxKB * 1024) {
    toastError('El adjunto es demasiado grande', { detalle: `Pesa ${tamano(archivo.size)} y el límite de la demo son ${maxKB} KB, porque todo se guarda en el navegador.` });
    return;
  }
  const datos = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(archivo);
  }).catch(() => null);
  if (!datos) { toastError('No pude leer el archivo.'); return; }
  adjuntoPendiente = { nombre: archivo.name, tipo: archivo.type, tamano: archivo.size, datos };
  renderAdjuntoPendiente();
}

function renderAdjuntoPendiente() {
  const caja = $('#adjunto-pendiente');
  if (!adjuntoPendiente) { caja.hidden = true; return; }
  const a = adjuntoPendiente;
  caja.hidden = false;
  caja.innerHTML = `
    ${(a.tipo || '').startsWith('image/') ? `<img class="adjunto-mini" src="${a.datos}" alt="">` : icono('archivo', { size: 16 })}
    <span class="adjunto-txt"><b>${escapar(a.nombre)}</b><span>${tamano(a.tamano)}</span></span>
    <button class="cita-cerrar" type="button" aria-label="Quitar el adjunto">${icono('cerrar', { size: 14 })}</button>`;
  caja.querySelector('.cita-cerrar').addEventListener('click', () => { adjuntoPendiente = null; renderAdjuntoPendiente(); });
}

function citar(m) {
  citando = { id: m.id, texto: m.texto, autor: m.autor };
  cambiarModo('responder');
  renderCita();
  $('#composer-texto').focus();
}

function renderCita() {
  const caja = $('#cita');
  if (!citando) { caja.hidden = true; return; }
  const quien = citando.autor === 'paciente' ? 'Paciente'
    : citando.autor === 'bot' ? 'Sofía' : 'Agente';
  caja.hidden = false;
  caja.innerHTML = `
    <div class="cita-cuerpo">
      <span class="cita-quien">${escapar(quien)}</span>
      <span class="cita-txt">${escapar((citando.texto || '').replace(/\*/g, '').slice(0, 120))}</span>
    </div>
    <button class="cita-cerrar" type="button" aria-label="Quitar la cita">${icono('cerrar', { size: 14 })}</button>`;
  caja.querySelector('.cita-cerrar').addEventListener('click', () => { citando = null; renderCita(); });
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
/* ---------- Menciones @ en notas privadas ---------- */
function agentesMencionables(fragmento) {
  const q = normalizarTexto(fragmento);
  return AGENTES.filter(a => !q || normalizarTexto(a.nombre).includes(q) || normalizarTexto(a.rol).includes(q));
}

/** Devuelve el @fragmento que hay justo antes del cursor, si lo hay. */
function mencionEnCurso(ta) {
  const hasta = ta.value.slice(0, ta.selectionStart);
  const m = hasta.match(/@([\p{L}]*)$/u);
  return m ? { fragmento: m[1], inicio: hasta.length - m[0].length } : null;
}

function renderMenciones(ta) {
  const cont = $('#menciones');
  const ctx = mencionEnCurso(ta);
  if (!ctx || modoComposer !== 'nota') { cerrarMenciones(); return; }
  const lista = agentesMencionables(ctx.fragmento);
  if (!lista.length) { cerrarMenciones(); return; }
  mencionActiva = Math.min(mencionActiva, lista.length - 1);
  cont.innerHTML = lista.map((a, i) => `
    <button class="mencion${i === mencionActiva ? ' activa' : ''}" type="button" data-i="${i}">
      <span class="conv-avatar" style="background:${a.color}" aria-hidden="true">${iniciales(a.nombre)}</span>
      <span class="mencion-txt"><b>${escapar(a.nombre)}</b><span>${escapar(a.rol)}</span></span>
    </button>`).join('');
  $$('.mencion', cont).forEach(b => b.addEventListener('click', () => insertarMencion(ta, lista[+b.dataset.i])));
  cont.hidden = false;
  mencionesAbiertas = true;
}

function insertarMencion(ta, agente) {
  const ctx = mencionEnCurso(ta);
  if (!ctx) return;
  const antes = ta.value.slice(0, ctx.inicio);
  const despues = ta.value.slice(ta.selectionStart);
  const texto = `@${agente.nombre} `;
  ta.value = antes + texto + despues;
  const pos = (antes + texto).length;
  ta.setSelectionRange(pos, pos);
  cerrarMenciones();
  ta.focus();
}

function cerrarMenciones() {
  $('#menciones').hidden = true;
  mencionesAbiertas = false;
  mencionActiva = 0;
}

/** Una imagen se enseña; cualquier otro archivo se ofrece para descargar. */
function renderAdjunto(a) {
  const esImagen = (a.tipo || '').startsWith('image/');
  if (esImagen) {
    return `<a class="adjunto-img" href="${a.datos}" target="_blank" rel="noopener" title="${escapar(a.nombre)}">
      <img src="${a.datos}" alt="${escapar(a.nombre)}" loading="lazy">
    </a>`;
  }
  return `<a class="adjunto-archivo" href="${a.datos}" download="${escapar(a.nombre)}">
    ${icono('archivo', { size: 15 })}
    <span class="adjunto-txt"><b>${escapar(a.nombre)}</b><span>${tamano(a.tamano)}</span></span>
  </a>`;
}

function tamano(bytes) {
  if (!bytes) return '';
  return bytes < 1024 ? `${bytes} B`
    : bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
}

/** En una nota, @Nombre se destaca para que el mencionado lo vea. */
function resaltarMenciones(texto) {
  let html = escapar(texto);
  for (const a of AGENTES) {
    html = html.split('@' + escapar(a.nombre)).join(`<span class="mencion-chip">@${escapar(a.nombre)}</span>`);
  }
  return html.replace(/\n/g, '<br>');
}

function normalizarTexto(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

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
function menu(etiqueta, opciones, iconoNombre) {
  const wrap = document.createElement('div');
  wrap.className = 'menu-wrap';
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  btn.innerHTML = (iconoNombre ? icono(iconoNombre, { size: 15 }) : '')
    + `<span>${escapar(etiqueta)}</span>` + icono('chevron-abajo', { size: 13, clase: 'caret' });
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

function boton(txt, clase, fn, titulo, nombreIcono) {
  const b = document.createElement('button');
  b.className = 'btn ' + clase; b.type = 'button';
  b.innerHTML = (nombreIcono ? icono(nombreIcono, { size: 15 }) : '') + `<span>${escapar(txt)}</span>`;
  if (titulo) b.title = titulo;
  b.addEventListener('click', fn);
  return b;
}

function botonIcono(txt, clase, nombreIcono, fn, titulo) {
  return boton(txt, clase, fn, titulo, nombreIcono);
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
  ['⌘K / Ctrl+K', 'Buscador global'],
  ['f', 'Filtros avanzados'],
  ['x', 'Marcar o desmarcar la conversación'],
  ['m', 'Aplicar una macro'],
  ['clic derecho', 'Menú de acciones rápidas'],
  ['/', 'Buscar en la bandeja'],
  ['?', 'Esta ayuda'],
  ['Esc', 'Cerrar menús y ayuda']
];

function manejarAtajo(ev) {
  // El buscador captura las flechas mientras está abierto.
  if (!$('#buscador').hidden) {
    const n = resultadosBusqueda.length;
    if (ev.key === 'ArrowDown') { buscadorActivo = (buscadorActivo + 1) % Math.max(1, n); actualizarBuscador(); desplazarAlActivo(); ev.preventDefault(); return; }
    if (ev.key === 'ArrowUp')   { buscadorActivo = (buscadorActivo - 1 + n) % Math.max(1, n); actualizarBuscador(); desplazarAlActivo(); ev.preventDefault(); return; }
    if (ev.key === 'Enter' && n) { ejecutarComando(resultadosBusqueda[buscadorActivo]); ev.preventDefault(); return; }
  }
  const enCampo = /input|textarea/i.test(ev.target.tagName);
  if ((ev.key === 'k' || ev.key === 'K') && (ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault(); abrirBuscador(); return;
  }
  if (ev.key === 'Escape') {
    cerrarMenus(); cerrarRapidas(); cerrarMenciones(); cerrarBuscador(); cerrarFiltros(); cerrarMarcar();
    $('#ayuda').hidden = true; $('#contextual').hidden = true;
    if (seleccion.size) limpiarSeleccion();
    if (citando) { citando = null; renderCita(); }
    ev.target.blur?.(); return;
  }
  if (enCampo) return;
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (seccion !== 'conversaciones' && ev.key !== '?') return;

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
    case 'f': abrirFiltros(); ev.preventDefault(); break;
    case 'x': if (seleccionada) { alternarSeleccion(seleccionada); ev.preventDefault(); } break;
    case 'm': if (seleccionada) {
        const btn = $$('.menu-wrap .btn').find(b => b.textContent.includes('Macros'));
        if (btn) { btn.click(); ev.preventDefault(); }
      } break;
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
    actualizarBadgeRail();
    if (seccion !== 'conversaciones') { renderSeccion(); return; }
    renderBandeja();
    renderConversacion();
  });
}

/* ============================================================
   Agenda
   ============================================================ */
function renderAgenda() {
  $$('.agenda-vistas .inbox-filter').forEach(b => b.setAttribute('aria-selected', String(b.dataset.agvista === agVista)));
  $('#ag-titulo').textContent = tituloAgenda();
  renderFuenteAgenda();
  renderMetricasAgenda();

  const cont = $('#ag-vista');
  const alClic = cita => { agCita = cita; renderFicha($('#ag-ficha'), cita, abrirConversacionDesdeAgenda); marcarCitaActiva(); };
  if (agVista === 'dia')         renderDia(cont, agFecha, agSede, alClic);
  else if (agVista === 'semana') renderSemana(cont, agFecha, agSede, alClic);
  else                           renderLista(cont, agFecha, agSede, alClic);

  renderFicha($('#ag-ficha'), agCita, abrirConversacionDesdeAgenda);
  marcarCitaActiva();
}

/* De dónde sale la agenda. Importa decirlo: una agenda que parece
   la del centro y no lo es hace que alguien prometa una hora. */
function renderFuenteAgenda() {
  const el = $('#ag-fuente');
  if (!el) return;
  const e = estadoAgendaRemota();
  /* El aviso de fallo solo tiene sentido si alguna vez estuvo
     conectado. Sin servidor detrás —la demo publicada— no hay nada
     que haya dejado de responder: simplemente es local. */
  if (e.conectado && !e.error) { el.className = 'agenda-fuente ok'; el.textContent = 'Google Calendar'; }
  else if (e.conectado)        { el.className = 'agenda-fuente warn'; el.textContent = 'Calendar sin responder'; }
  else                         { el.className = 'agenda-fuente'; el.textContent = 'Datos locales · demo'; }
}

function marcarCitaActiva() {
  $$('[data-cita]').forEach(b => b.classList.toggle('activa', agCita && b.dataset.cita === agCita.id));
}

function abrirConversacionDesdeAgenda(idConversacion) {
  if (!idConversacion) return;
  irA('conversaciones');
  // Puede estar en una vista que ahora no se muestra.
  if (!conversacionesVisibles().some(c => c.id === idConversacion)) {
    vista = 'todas';
    condiciones = [];
    $$('.inbox-filter[data-vista]').forEach(x => x.setAttribute('aria-selected', String(x.dataset.vista === 'todas')));
    renderChipFiltro();
  }
  seleccionar(idConversacion);
}

function tituloAgenda() {
  if (agVista === 'dia') return (esHoy(agFecha) ? 'Hoy · ' : '') + diaLargo(agFecha);
  if (agVista === 'lista') return 'Próximas citas desde ' + diaLargo(agFecha);
  const lunes = inicioDeSemana(agFecha);
  const sabado = new Date(lunes); sabado.setDate(lunes.getDate() + 5);
  return `${lunes.getDate()} – ${diaLargo(sabado)}`;
}

function renderMetricasAgenda() {
  const cont = $('#ag-metricas');
  const ocup = ocupacionDia(agFecha, agSede);

  if (agVista === 'semana') {
    const dias = citasDeSemana(agFecha, agSede).filter(d => d.horario);
    const total = dias.reduce((n, d) => n + d.citas.length, 0);
    const porAgente = dias.reduce((n, d) => n + d.citas.filter(c => c.origen === 'agente').length, 0);
    const pendientes = dias.reduce((n, d) => n + d.citas.filter(c => c.estado === 'sin_autorizar' || c.estado === 'sin_orden').length, 0);
    const media = dias.length
      ? Math.round(dias.reduce((n, d) => n + (ocupacionDia(d.fecha, agSede)?.porcentaje || 0), 0) / dias.length) : 0;
    cont.innerHTML = tiles([
      [total, 'Citas esta semana'],
      [media + '%', 'Ocupación media'],
      [pendientes, 'Con algo pendiente', pendientes ? 'autorización u orden' : ''],
      [porAgente, 'Agendadas por el agente']
    ]);
    return;
  }

  if (!ocup) { cont.innerHTML = ''; return; }
  const citas = citasDelDia(agFecha, agSede);
  const porAgente = citas.filter(c => c.origen === 'agente').length;
  const pendientes = citas.filter(c => c.estado === 'sin_autorizar' || c.estado === 'sin_orden').length;
  cont.innerHTML = tiles([
    [ocup.citas, 'Citas'],
    [ocup.porcentaje + '%', 'Ocupación', `${Math.round(ocup.ocupados / 60)} h de ${Math.round(ocup.disponibles / 60)} h`],
    [pendientes, 'Con algo pendiente'],
    [porAgente, 'Agendadas por el agente']
  ]);
}

function tiles(filas) {
  return `<div class="tiles">${filas.map(([v, l, n]) => `
    <div class="tile"><div class="tile-val">${escapar(String(v))}</div>
      <div class="tile-lab">${escapar(l)}</div>
      ${n ? `<div class="tile-nota">${escapar(n)}</div>` : ''}</div>`).join('')}</div>`;
}

function moverAgenda(pasos) {
  const d = new Date(agFecha);
  if (agVista === 'semana') d.setDate(d.getDate() + pasos * 7);
  else if (agVista === 'lista') d.setDate(d.getDate() + pasos * 7);
  else d.setDate(d.getDate() + pasos);
  agFecha = d;
  renderAgenda();
}

/* ============================================================
   Filtros avanzados
   ============================================================ */
function abrirFiltros() {
  if (!condiciones.length) condiciones = [nuevaCondicion()];
  $('#filtros').hidden = false;
  renderFiltros();
}
function cerrarFiltros() { $('#filtros').hidden = true; }

function nuevaCondicion() { return { atributo: 'estado', operador: 'es', valor: 'pending' }; }

function renderFiltros() {
  const cont = $('#filtros-condiciones');
  cont.innerHTML = condiciones.map((c, i) => {
    const attr = atributoPorClave(c.atributo);
    const ops = OPERADORES[attr?.tipo || 'texto'] || [];
    const sinValor = c.operador === 'existe' || c.operador === 'no_existe';
    let campoValor;
    if (sinValor) {
      campoValor = '<span class="filtro-sinvalor">—</span>';
    } else if (attr?.opciones) {
      campoValor = `<select class="f-valor" data-i="${i}">${attr.opciones()
        .map(([k, et]) => `<option value="${escapar(k)}"${String(k) === String(c.valor) ? ' selected' : ''}>${escapar(et)}</option>`).join('')}</select>`;
    } else if (attr?.tipo === 'numero' || attr?.tipo === 'fecha') {
      campoValor = `<input class="f-valor" type="number" min="0" data-i="${i}" value="${escapar(c.valor ?? '')}" placeholder="0">`;
    } else {
      campoValor = `<input class="f-valor" type="text" data-i="${i}" value="${escapar(c.valor ?? '')}" placeholder="texto">`;
    }
    return `<div class="filtro-fila">
      ${i ? `<span class="filtro-union">${union === 'o' ? 'o' : 'y'}</span>` : '<span class="filtro-union">donde</span>'}
      <select class="f-attr" data-i="${i}">${ATRIBUTOS
        .map(a => `<option value="${a.clave}"${a.clave === c.atributo ? ' selected' : ''}>${escapar(a.nombre)}</option>`).join('')}</select>
      <select class="f-op" data-i="${i}">${ops
        .map(([k, et]) => `<option value="${k}"${k === c.operador ? ' selected' : ''}>${escapar(et)}</option>`).join('')}</select>
      ${campoValor}
      <button class="f-quitar" type="button" data-i="${i}" aria-label="Quitar condición">${icono('cerrar', { size: 14 })}</button>
    </div>`;
  }).join('');

  // Cambiar de atributo puede invalidar el operador y el valor anteriores.
  $$('.f-attr', cont).forEach(sel => sel.addEventListener('change', () => {
    const i = +sel.dataset.i;
    const attr = atributoPorClave(sel.value);
    condiciones[i] = {
      atributo: sel.value,
      operador: (OPERADORES[attr.tipo] || [['es']])[0][0],
      valor: attr.opciones ? attr.opciones()[0][0] : ''
    };
    renderFiltros();
  }));
  $$('.f-op', cont).forEach(sel => sel.addEventListener('change', () => {
    condiciones[+sel.dataset.i].operador = sel.value;
    renderFiltros();
  }));
  $$('.f-valor', cont).forEach(campo => {
    // El resumen se refresca al teclear, pero sin repintar la fila:
    // volver a montarla haría perder el foco a cada pulsación.
    const alCambiar = () => {
      condiciones[+campo.dataset.i].valor = campo.value;
      $('#filtros-resumen').textContent = describir(condiciones, union);
    };
    campo.addEventListener('input', alCambiar);
    campo.addEventListener('change', alCambiar);
  });
  $$('.f-quitar', cont).forEach(b => b.addEventListener('click', () => {
    condiciones.splice(+b.dataset.i, 1);
    if (!condiciones.length) condiciones = [nuevaCondicion()];
    renderFiltros();
  }));

  $$('.filtro-union-btn').forEach(b => b.setAttribute('aria-selected', String(b.dataset.union === union)));
  $('#filtros-resumen').textContent = describir(condiciones, union);
}

function aplicarFiltros() {
  vistaActiva = null;
  cerrarFiltros();
  limpiarSeleccion();
  renderChipFiltro();
  refrescar();
  const n = conversacionesVisibles().length;
  avisar(`Filtro aplicado · ${n} ${n === 1 ? 'conversación' : 'conversaciones'}`, 'ok');
}

function limpiarFiltros() {
  condiciones = [];
  vistaActiva = null;
  cerrarFiltros();
  renderChipFiltro();
  refrescar();
}

function renderChipFiltro() {
  const chip = $('#filtro-activo');
  const hay = condiciones.some(c => c.atributo && c.operador);
  if (!hay) { chip.hidden = true; return; }
  chip.hidden = false;
  const v = vistaActiva ? vistaPorId(vistaActiva) : null;
  chip.innerHTML = `${icono('filtro', { size: 13 })}
    <span class="chip-txt">${escapar(v ? v.nombre : describir(condiciones, union))}</span>
    <button class="chip-x" type="button" aria-label="Quitar filtro">${icono('cerrar', { size: 13 })}</button>`;
  chip.querySelector('.chip-x').addEventListener('click', limpiarFiltros);
}

/* ---------- Vistas guardadas ---------- */
function renderVistasGuardadas() {
  const cont = $('#vistas-guardadas');
  const vistas = listarVistas();
  if (!vistas.length) { cont.hidden = true; return; }
  cont.hidden = false;
  cont.innerHTML = `<div class="vistas-titulo">Vistas guardadas</div>` + vistas.map(v => `
    <div class="vista-fila${v.id === vistaActiva ? ' activa' : ''}">
      <button class="vista-btn" type="button" data-id="${v.id}" title="${escapar(describir(v.condiciones, v.union))}">
        ${icono('filtro', { size: 13 })}<span>${escapar(v.nombre)}</span>
      </button>
      <button class="vista-borrar" type="button" data-id="${v.id}" aria-label="Borrar vista">${icono('papelera', { size: 13 })}</button>
    </div>`).join('');

  $$('.vista-btn', cont).forEach(b => b.addEventListener('click', () => {
    const v = vistaPorId(b.dataset.id);
    if (!v) return;
    condiciones = JSON.parse(JSON.stringify(v.condiciones));
    union = v.union || 'y';
    vistaActiva = v.id;
    limpiarSeleccion();
    renderChipFiltro();
    renderVistasGuardadas();
    refrescar();
  }));
  $$('.vista-borrar', cont).forEach(b => b.addEventListener('click', () => {
    if (!confirm('¿Borrar esta vista guardada?')) return;
    borrarVista(b.dataset.id);
    if (vistaActiva === b.dataset.id) limpiarFiltros();
    renderVistasGuardadas();
  }));
}

function guardarVistaActual() {
  const validas = condiciones.filter(c => c.atributo && c.operador);
  if (!validas.length) { avisar('Añade al menos una condición antes de guardar.', 'warn'); return; }
  const nombre = prompt('Nombre de la vista', describir(validas, union).slice(0, 40));
  if (!nombre) return;
  vistaActiva = guardarVista(nombre.trim(), validas, union);
  renderVistasGuardadas();
  renderChipFiltro();
  cerrarFiltros();
  avisar(`Vista «${nombre.trim()}» guardada`, 'ok');
}

/* ============================================================
   Buscador global
   ============================================================ */
function abrirBuscador() {
  const caja = $('#buscador');
  caja.hidden = false;
  const campo = $('#buscador-campo');
  campo.value = '';
  buscadorActivo = 0;
  actualizarBuscador();
  campo.focus();
}

function cerrarBuscador() { $('#buscador').hidden = true; }

/* ------------------------------------------------------------
   Los comandos disponibles
   ------------------------------------------------------------
   Las acciones se calculan en cada apertura porque dependen del
   contexto: sin conversación abierta, las suyas no aparecen. Una
   paleta que ofrece lo que no se puede hacer enseña a ignorarla.
   ------------------------------------------------------------ */
function comandosDisponibles() {
  const acciones = [];
  const c = seleccionada ? obtenerConversacion(seleccionada) : null;
  if (c) {
    /* Muchas conversaciones llegan sin nombre: el paciente aún no se
       ha identificado. Decir "de la conversación" sería absurdo. */
    const nombre = c.crm?.contacto?.paciente_nombre || c.contacto?.nombre || null;
    const de = nombre ? ` de ${nombre}` : ' abierta';
    const detalle = nombre || 'paciente sin identificar';
    if (estadoEfectivo(c) !== 'resolved') {
      acciones.push({ titulo: `Tomar la conversación${de}`, claves: 'asignar atender mia',
                      icono: 'pacientes', atajo: 'A', hacer: () => { tomar(c.id); toastOk('Conversación tomada', { detalle }); } });
      acciones.push({ titulo: `Resolver la conversación${de}`, claves: 'cerrar listo terminar',
                      icono: 'check', atajo: 'R', hacer: () => { resolver(c.id); toastOk('Conversación resuelta', { detalle }); } });
    }
    acciones.push({ titulo: `Exportar la transcripción${de}`, claves: 'descargar txt copia',
                    icono: 'informes', hacer: () => { exportar(c); toastOk('Transcripción descargada', { detalle }); } });
  }
  acciones.push({ titulo: 'Filtros avanzados', claves: 'buscar condiciones vista', icono: 'filtro', atajo: 'F',
                  hacer: () => { if (seccion !== 'conversaciones') irA('conversaciones'); abrirFiltros(); } });
  acciones.push({ titulo: 'Cambiar de tema', claves: 'oscuro claro dark light modo', icono: 'luna',
                  hacer: () => $('#theme').click() });
  acciones.push({ titulo: 'Abrir el simulador de chat', claves: 'whatsapp paciente agente', icono: 'mensajes',
                  hacer: () => { location.href = $('#link-chat').getAttribute('href'); } });

  const navegacion = [
    ['conversaciones', 'Conversaciones', 'mensajes',   'bandeja inbox chats'],
    ['agenda',         'Agenda',         'calendario', 'citas horarios calendario'],
    ['pacientes',      'Pacientes',      'pacientes',  'contactos personas'],
    ['informes',       'Informes',       'informes',   'metricas estadisticas datos'],
    ['entrenamiento',  'Entrenamiento',  'chispa',     'evaluaciones correcciones conocimiento evals calidad'],
    ['ajustes',        'Ajustes',        'ajustes',    'equipo macros sla configuracion']
  ].map(([id, titulo, ico, claves]) => ({
    titulo: `Ir a ${titulo}`, claves, icono: ico,
    pista: seccion === id ? 'aquí' : null,
    hacer: () => irA(id)
  }));

  return { acciones, navegacion };
}

function actualizarBuscador() {
  const q = $('#buscador-campo').value;
  const { acciones, navegacion } = comandosDisponibles();

  /* La búsqueda de contenido necesita dos caracteres; los comandos
     no, porque la lista ya está acotada y sirve de menú. */
  const encontrados = q.trim().length >= 2 ? buscar(q) : [];
  const resultados = encontrados.map(r => ({
    titulo: r.titulo.replace(/<[^>]*>/g, ''),
    html: `<span class="cmd-titulo">${r.titulo}</span><span class="cmd-detalle">${r.detalle}</span>`,
    icono: r.icono, pista: r.tipo, _res: r,
    hacer: () => irAResultado(r)
  }));

  const grupos = [
    ...filtrarGrupos([{ titulo: 'Acciones', items: acciones },
                      { titulo: 'Navegación', items: navegacion }], q),
    { titulo: 'Resultados', items: resultados }
  ];
  const total = grupos.reduce((n, g) => n + g.items.length, 0);
  buscadorActivo = Math.max(0, Math.min(buscadorActivo, total - 1));

  resultadosBusqueda = renderPaleta($('#buscador-resultados'), grupos, buscadorActivo);
  $$('#buscador-resultados .cmd-item').forEach(b =>
    b.addEventListener('click', () => ejecutarComando(resultadosBusqueda[+b.dataset.i])));

  const pie = $('#buscador-pie-n');
  if (pie) pie.textContent = q.trim().length >= 2 && !encontrados.length
    ? 'sin coincidencias en mensajes'
    : `${total} ${total === 1 ? 'opción' : 'opciones'}`;
}

/* Mantener a la vista el elemento activo al navegar con flechas. */
function desplazarAlActivo() {
  const el = $('#buscador-resultados .cmd-item[aria-selected="true"]');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function ejecutarComando(cmd) {
  if (!cmd) return;
  cerrarBuscador();
  cmd.hacer();
}

function irAResultado(r) {
  if (!r) return;
  cerrarBuscador();
  if (seccion !== 'conversaciones') irA('conversaciones');
  // El resultado puede estar en una vista que ahora mismo no se muestra.
  const c = obtenerConversacion(r.idConversacion);
  if (c && !conversacionesVisibles().some(x => x.id === r.idConversacion)) {
    vista = 'todas';
    $$('.inbox-filter').forEach(x => x.setAttribute('aria-selected', String(x.dataset.vista === 'todas')));
    const estado = estadoEfectivo(c);
    if (estado === 'resolved' || estado === 'snoozed') {
      vista = estado;
      $$('.inbox-filter').forEach(x => x.setAttribute('aria-selected', String(x.dataset.vista === estado)));
    }
  }
  seleccionar(r.idConversacion);
}

/* ============================================================
   Marcar una respuesta del agente
   ------------------------------------------------------------
   El punto de entrada del entrenamiento está donde se ve el
   problema: dentro de la conversación, bajo la respuesta que no
   sirvió. Pedirle a alguien que abra otra pantalla para reportar
   algo es garantizar que no lo reporte.
   ============================================================ */
let marcando = null;
let motivoElegido = null;

function abrirMarcar(mensaje, idConversacion) {
  marcando = { mensaje, idConversacion };
  motivoElegido = null;
  $('#marcar-cita').textContent = (mensaje.texto || '').replace(/\*([^*]+)\*/g, '$1');
  $('#marcar-texto').value = '';
  $('#marcar-donde').textContent = '';
  $('#marcar-guardar').disabled = true;
  $('#marcar-motivos').innerHTML = Object.entries(MOTIVOS).map(([id, m]) => `
    <button class="marcar-motivo" type="button" role="radio" aria-checked="false" data-motivo="${id}">
      <strong>${m.nombre}</strong><span>${m.donde}</span>
    </button>`).join('');
  $$('#marcar-motivos .marcar-motivo').forEach(b => b.addEventListener('click', () => {
    motivoElegido = b.dataset.motivo;
    $$('#marcar-motivos .marcar-motivo').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    $('#marcar-donde').textContent = MOTIVOS[motivoElegido].detalle;
    $('#marcar-guardar').disabled = false;
  }));
  $('#marcar').hidden = false;
  $('#marcar-texto').focus();
}

function cerrarMarcar() { $('#marcar').hidden = true; marcando = null; }

function guardarMarcar() {
  if (!marcando || !motivoElegido) return;
  anotarCorreccion({
    idConversacion: marcando.idConversacion,
    textoBot: marcando.mensaje.texto,
    motivo: motivoElegido,
    correccion: $('#marcar-texto').value.trim(),
    autor: YO
  });
  cerrarMarcar();
  actualizarBadgeRail();
  toastOk('Corrección guardada', {
    detalle: `Se arregla en: ${MOTIVOS[motivoElegido].donde.toLowerCase()}.`,
    accion: { texto: 'Ver en Entrenamiento', alPulsar: () => irA('entrenamiento') }
  });
}

/* ============================================================
   Navegación entre secciones
   ============================================================ */
function irA(nueva) {
  seccion = nueva;
  $$('.seccion').forEach(el => { el.hidden = el.id !== 'seccion-' + nueva; });
  $$('.rail-btn').forEach(b => b.setAttribute('aria-current', String(b.dataset.seccion === nueva)));
  $('#crm-titulo').textContent = {
    conversaciones: 'Bandeja de conversaciones',
    agenda: 'Agenda de citas',
    pacientes: 'Pacientes',
    informes: 'Informes',
    entrenamiento: 'Entrenamiento del agente',
    ajustes: 'Ajustes'
  }[nueva];
  // La búsqueda del encabezado solo tiene sentido en la bandeja.
  $('.crm-search').hidden = nueva !== 'conversaciones';
  renderSeccion();
}

function renderSeccion() {
  if (seccion === 'conversaciones') { refrescar(); return; }
  if (seccion === 'agenda') {
    actualizarBadgeRail();
    const ya = estadoAgendaRemota();
    /* Si el servidor tiene Google Calendar, la agenda de verdad está
       allí. La primera vez se enseña un esqueleto; a partir de ahí ya
       hay datos y repintar de golpe no parpadea. */
    if (ya.cargado) renderAgenda();
    else renderEsqueletoAgenda($('#ag-vista'));
    sincronizarAgenda().then(e => {
      renderAgenda();
      if (e.error && e.conectado) toastError('El calendario del centro no responde', { detalle: e.error });
    });
    return;
  }
  if (seccion === 'pacientes') {
    renderPacientes($('#lista-pacientes'), filtroPacientes, id => { irA('conversaciones'); seleccionar(id); });
  } else if (seccion === 'informes') {
    renderInformes($('#informes'));
  } else if (seccion === 'entrenamiento') {
    renderEntrenamiento($('#entrenamiento'), {
      /* La suite corre contra el motor de reglas local: no gasta
         tokens y es determinista, así que un fallo es un fallo y no
         una tirada mala. Con ANTHROPIC_API_KEY, los mismos casos se
         corren contra el modelo desde server/tests-loop.mjs. */
      crearAgente: createAgent,
      alCambiar: estado => {
        toastOk(estado === 'convertida' ? 'Corrección convertida en caso' : 'Corrección descartada');
        actualizarBadgeRail();
      }
    });
  } else if (seccion === 'ajustes') {
    renderAjustes($('#ajustes'), () => { toastOk('Ajustes guardados', { detalle: 'Los umbrales de SLA se aplican ya a la bandeja.' }); renderBandeja(); });
  }
  actualizarBadgeRail();
}

function actualizarBadgeRail() {
  const sinRevisar = listarCorrecciones().filter(c => c.estado === 'pendiente').length;
  const badgeEnt = $('#rail-badge-ent');
  if (badgeEnt) { badgeEnt.textContent = sinRevisar; badgeEnt.hidden = !sinRevisar; }

  const pendientes = listarConversaciones().filter(c => sinLeer(c) > 0).length;
  const badge = $('#rail-badge');
  if (!badge) return;
  badge.textContent = pendientes;
  badge.hidden = pendientes === 0;
}

/* ============================================================
   Montaje
   ============================================================ */
function montar() {
  pintarIconos();
  enlazarHermanas();

  // Diálogo de marcado
  $('#marcar-cerrar').addEventListener('click', cerrarMarcar);
  $('#marcar-guardar').addEventListener('click', guardarMarcar);
  $('#marcar').addEventListener('click', ev => { if (ev.target.id === 'marcar') cerrarMarcar(); });
  // Vistas de la bandeja
  $$('.inbox-filter').forEach(b => b.addEventListener('click', () => {
    vista = b.dataset.vista;
    $$('.inbox-filter').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    // Las pestañas y el filtro avanzado compiten por lo mismo: elegir una
    // pestaña descarta el filtro en vez de dejar dos criterios peleando.
    if (condiciones.length) { condiciones = []; vistaActiva = null; renderChipFiltro(); renderVistasGuardadas(); }
    limpiarSeleccion();
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
    if (ta.value.startsWith('/')) { renderRapidas(ta.value); cerrarMenciones(); }
    else { cerrarRapidas(); renderMenciones(ta); }
  });
  ta.addEventListener('keydown', ev => {
    if (rapidasAbiertas) {
      const lista = filtrarRapidas(ta.value);
      if (ev.key === 'ArrowDown') { rapidaActiva = Math.min(rapidaActiva + 1, lista.length - 1); renderRapidas(ta.value); ev.preventDefault(); return; }
      if (ev.key === 'ArrowUp')   { rapidaActiva = Math.max(rapidaActiva - 1, 0); renderRapidas(ta.value); ev.preventDefault(); return; }
      if (ev.key === 'Enter' && !ev.shiftKey) { insertarRapida(lista[rapidaActiva]); ev.preventDefault(); return; }
      if (ev.key === 'Escape') { cerrarRapidas(); ev.preventDefault(); return; }
    }
    if (mencionesAbiertas) {
      const lista = agentesMencionables(mencionEnCurso(ta)?.fragmento || '');
      if (ev.key === 'ArrowDown') { mencionActiva = Math.min(mencionActiva + 1, lista.length - 1); renderMenciones(ta); ev.preventDefault(); return; }
      if (ev.key === 'ArrowUp')   { mencionActiva = Math.max(mencionActiva - 1, 0); renderMenciones(ta); ev.preventDefault(); return; }
      if (ev.key === 'Enter' && !ev.shiftKey) { insertarMencion(ta, lista[mencionActiva]); ev.preventDefault(); return; }
      if (ev.key === 'Escape') { cerrarMenciones(); ev.preventDefault(); return; }
    }
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); enviar(); }
  });

  // Ayuda de atajos
  $('#ayuda-cerrar').addEventListener('click', () => { $('#ayuda').hidden = true; });
  $('#ayuda-lista').innerHTML = ATAJOS.map(([k, d]) =>
    `<div class="atajo"><kbd>${escapar(k)}</kbd><span>${escapar(d)}</span></div>`).join('');
  document.addEventListener('keydown', manejarAtajo);
  document.addEventListener('click', () => { cerrarMenus(); $('#contextual').hidden = true; });

  // Adjuntos
  $('#adjuntar').addEventListener('click', () => $('#archivo').click());
  $('#archivo').addEventListener('change', ev => {
    elegirAdjunto(ev.target.files[0]);
    ev.target.value = '';
  });

  // Agenda
  $$('.agenda-vistas .inbox-filter').forEach(b => b.addEventListener('click', () => {
    agVista = b.dataset.agvista;
    renderAgenda();
  }));
  $('#ag-anterior').addEventListener('click', () => moverAgenda(-1));
  $('#ag-siguiente').addEventListener('click', () => moverAgenda(1));
  $('#ag-hoy').addEventListener('click', () => { agFecha = new Date(); renderAgenda(); });
  $('#ag-sede').addEventListener('change', e => { agSede = e.target.value; renderAgenda(); });

  // Filtros avanzados
  $('#abrir-filtros').addEventListener('click', abrirFiltros);
  $('#filtros-cerrar').addEventListener('click', cerrarFiltros);
  $('#filtros-aplicar').addEventListener('click', aplicarFiltros);
  $('#filtros-limpiar').addEventListener('click', limpiarFiltros);
  $('#filtros-guardar').addEventListener('click', guardarVistaActual);
  $('#filtros-anadir').addEventListener('click', () => { condiciones.push(nuevaCondicion()); renderFiltros(); });
  $$('.filtro-union-btn').forEach(b => b.addEventListener('click', () => { union = b.dataset.union; renderFiltros(); }));
  $('#filtros').addEventListener('click', ev => { if (ev.target.id === 'filtros') cerrarFiltros(); });
  renderVistasGuardadas();

  // Buscador global
  $('#buscador-campo').addEventListener('input', () => { buscadorActivo = 0; actualizarBuscador(); });
  $('#buscador').addEventListener('click', ev => { if (ev.target.id === 'buscador') cerrarBuscador(); });
  $('#abrir-buscador').addEventListener('click', abrirBuscador);

  // Acciones en bloque
  $('#bloque-cancelar').addEventListener('click', limpiarSeleccion);
  $('#bloque-resolver').addEventListener('click', () => aplicarEnBloque({ tipo: 'resolver' }, 'Resueltas'));
  $('#bloque-asignarme').addEventListener('click', () => aplicarEnBloque({ tipo: 'asignar_agente', valor: YO }, 'Asignadas a ti'));
  $('#bloque-posponer').addEventListener('click', () => aplicarEnBloque({ tipo: 'posponer', valor: 60 }, 'Pospuestas 1 hora'));
  $('#bloque-urgente').addEventListener('click', () => aplicarEnBloque({ tipo: 'prioridad', valor: 'urgent' }, 'Marcadas urgentes'));

  // Rail de navegación
  $$('.rail-btn').forEach(b => b.addEventListener('click', () => irA(b.dataset.seccion)));
  $('#buscar-pacientes').addEventListener('input', e => {
    filtroPacientes = e.target.value;
    if (seccion === 'pacientes') renderSeccion();
  });

  // Identidad del agente
  const yo = agentePorId(YO);
  $('#yo-nombre').textContent = yo.nombre;
  $('#yo-rol').textContent = yo.rol;
  $('#yo-avatar').textContent = iniciales(yo.nombre);
  $('#yo-avatar').style.background = yo.color;
  $('#rail-yo').textContent = iniciales(yo.nombre);
  $('#rail-yo').style.background = yo.color;
  $('#rail-yo').title = yo.nombre;

  // Tema
  const btnTema = $('#theme');
  const aplicar = t => {
    document.documentElement.setAttribute('data-theme', t);
    btnTema.innerHTML = icono(t === 'dark' ? 'sol' : 'luna', { size: 15 })
      + `<span>${t === 'dark' ? 'Claro' : 'Oscuro'}</span>`;
    try { localStorage.setItem('os-theme', t); } catch (e) { /* sin almacenamiento */ }
  };
  let inicial = 'light';
  try { inicial = localStorage.getItem('os-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { /* ignorar */ }
  aplicar(inicial);
  btnTema.addEventListener('click', () => {
    aplicar(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    // Los gráficos tienen pasos propios por modo, no un volteo automático.
    if (seccion === 'informes') renderSeccion();
  });

  // En vivo
  suscribir(ev => {
    if (!seleccionada && ev.tipo === 'conversacion_actualizada') seleccionada = ev.conversacion.id;
    refrescar();
  });
  window.addEventListener('storage', refrescar);

  // El reloj de espera y las posposiciones vencidas necesitan repintado periódico
  setInterval(renderBandeja, 30000);

  irA('conversaciones');
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
/** Semáforo de espera, con los umbrales que estén configurados en Ajustes. */
function nivelEspera(c) {
  const min = (Date.now() - (c.esperaDesde || Date.now())) / 60000;
  const { aviso, critico } = leerAjustes().sla;
  return min < aviso ? 'ok' : min < critico ? 'warn' : 'danger';
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
