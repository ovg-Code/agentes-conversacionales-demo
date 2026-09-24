/* ============================================================
   Agenda de citas
   ------------------------------------------------------------
   Es el módulo que justifica el sistema: el agente agenda, y
   aquí el centro ve lo que se llenó. Las citas salen de las
   conversaciones que llegaron a crear una, más una semilla de
   demostración para que la vista no esté vacía al abrirla.

   Horario real de Open Side:
     lunes a viernes 7:00–20:00 · sábados 7:00–14:00 · domingo cerrado
   ============================================================ */

import { listarConversaciones } from './bus.js';
import { SEDES, HORARIO, ESTUDIOS } from './kb.js';
import { icono } from './iconos.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const ESTADOS_CITA = {
  confirmada:   { nombre: 'Confirmada',           tono: 'ok' },
  sin_autorizar:{ nombre: 'Falta autorización',   tono: 'warn' },
  sin_orden:    { nombre: 'Falta orden médica',   tono: 'warn' },
  bloqueada:    { nombre: 'Screening pendiente',  tono: 'danger' },
  completada:   { nombre: 'Realizada',            tono: 'muted' },
  no_asistio:   { nombre: 'No asistió',           tono: 'danger' }
};

/* ============================================================
   Semilla de demostración
   ------------------------------------------------------------
   Sin citas la agenda no se puede enseñar. Se genera una vez y
   queda guardada, para que no cambie en cada recarga.
   ============================================================ */
const CLAVE_SEMILLA = 'openside:agenda-demo:v1';

const NOMBRES_DEMO = [
  'María Elena Pérez', 'Carlos Domínguez', 'Rosa Batista', 'Luis Ernesto Caballero',
  'Yarielis Moreno', 'Ricardo Him', 'Ana Sofía Vargas', 'Juan Carlos Tejada',
  'Elsa Rodríguez', 'Gabriel Sánchez', 'Mireya Castillo', 'Omar Jaén',
  'Katherine Ríos', 'Fernando Ortega', 'Lucía Bernal', 'Pedro Quintero'
];
const ASEGURADORAS_DEMO = ['ASSA', 'PALIG', 'MAPFRE', 'Internacional de Seguros', 'Privado', 'Privado'];

/** Franjas de atención de un día concreto, o null si está cerrado. */
export function horarioDe(fecha) {
  const rango = HORARIO.dias[fecha.getDay()];
  return rango ? { desde: rango[0], hasta: rango[1] } : null;
}

function generarSemilla() {
  const citas = [];
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  let n = 0;

  // Dos semanas: la pasada (para ver realizadas) y la que viene.
  for (let d = -7; d <= 7; d++) {
    const dia = new Date(hoy);
    dia.setDate(hoy.getDate() + d);
    const horario = horarioDe(dia);
    if (!horario) continue;

    // Un centro con dos equipos hace del orden de 15-20 estudios al día.
    // Menos los sábados, y variando para que no parezca una rejilla.
    const cuantas = dia.getDay() === 6 ? 6 + (dia.getDate() % 3) : 14 + ((dia.getDate() + d) % 6);
    const usadas = new Set();

    for (let i = 0; i < cuantas; i++) {
      const estudio = ESTUDIOS[(n * 5 + i * 3) % ESTUDIOS.length];
      // Se reparten en franjas de media hora a lo largo de todo el horario.
      const franjas = (horario.hasta - horario.desde) * 2;
      const franja = (i * 2 + (n % 3)) % franjas;
      let hora = horario.desde + Math.floor(franja / 2);
      const minutos = franja % 2 ? 30 : 0;
      let clave = `${hora}:${minutos}`;
      if (usadas.has(clave)) { hora = Math.min(hora + 1, horario.hasta - 1); clave = `${hora}:${minutos}`; }
      if (usadas.has(clave)) continue;
      usadas.add(clave);

      const inicio = new Date(dia);
      inicio.setHours(hora, minutos, 0, 0);
      const aseguradora = ASEGURADORAS_DEMO[n % ASEGURADORAS_DEMO.length];

      let estado;
      if (d < 0) estado = (n % 7 === 0) ? 'no_asistio' : 'completada';
      else if (aseguradora !== 'Privado' && n % 4 === 0) estado = 'sin_autorizar';
      else if (n % 9 === 0) estado = 'sin_orden';
      else estado = 'confirmada';

      citas.push({
        id: `OS-2026-0${4900 + n}`,
        paciente: NOMBRES_DEMO[n % NOMBRES_DEMO.length],
        telefono: `+507 6${(100 + n * 7) % 900}-${(1000 + n * 13) % 9000}`,
        estudioId: estudio.id,
        estudio: estudio.nombre,
        modalidad: estudio.modalidad,
        inicio: inicio.toISOString(),
        duracion: estudio.duracion,
        sede: n % 3 === 0 ? '76E' : '75E',
        aseguradora,
        estado,
        origen: 'demo'
      });
      n++;
    }
  }
  return citas;
}

function semilla() {
  try {
    const guardada = localStorage.getItem(CLAVE_SEMILLA);
    if (guardada) return JSON.parse(guardada);
    const nueva = generarSemilla();
    localStorage.setItem(CLAVE_SEMILLA, JSON.stringify(nueva));
    return nueva;
  } catch (e) {
    return generarSemilla();
  }
}

export function regenerarSemilla() {
  try { localStorage.removeItem(CLAVE_SEMILLA); } catch (e) { /* ignorar */ }
  return semilla();
}

/* ============================================================
   Citas reales: las que creó el agente
   ============================================================ */
function citasDeConversaciones() {
  const out = [];
  for (const c of listarConversaciones()) {
    const conv = c.crm?.conversacion;
    if (!conv?.cita_id || !conv.cita_inicio) continue;
    // El identificador es más fiable que el nombre, que puede variar.
    const estudio = ESTUDIOS.find(e => e.id === conv.cita_estudio_id)
                 || ESTUDIOS.find(e => e.nombre === conv.estudio_solicitado);
    const aseguradora = c.crm?.contacto?.aseguradora || 'Privado';

    let estado = 'confirmada';
    if (conv.autorizacion_seguro === 'pendiente' && aseguradora !== 'Privado') estado = 'sin_autorizar';
    if (conv.screening_rm_estado && !['aprobado', 'pendiente'].includes(conv.screening_rm_estado)) estado = 'bloqueada';
    if (new Date(conv.cita_inicio) < Date.now()) estado = 'completada';

    out.push({
      id: conv.cita_id,
      paciente: c.crm?.contacto?.paciente_nombre || c.contacto?.nombre || 'Paciente sin identificar',
      telefono: c.contacto?.telefono || '',
      estudioId: estudio?.id || conv.cita_estudio_id || null,
      estudio: conv.estudio_solicitado || 'Estudio',
      modalidad: estudio?.modalidad || '—',
      inicio: conv.cita_inicio,
      duracion: conv.cita_duracion || estudio?.duracion || 30,
      sede: conv.cita_sede || conv.sede_preferida || '75E',
      aseguradora,
      estado,
      origen: 'agente',
      idConversacion: c.id
    });
  }
  return out;
}

/** Todas las citas, las del agente primero por si repiten identificador. */
export function listarCitas() {
  const reales = citasDeConversaciones();
  const ids = new Set(reales.map(c => c.id));
  return [...reales, ...semilla().filter(c => !ids.has(c.id))]
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
}

export function citasDelDia(fecha, sede = 'todas') {
  const dia = new Date(fecha); dia.setHours(0, 0, 0, 0);
  const fin = new Date(dia); fin.setDate(dia.getDate() + 1);
  return listarCitas().filter(c => {
    const t = new Date(c.inicio);
    return t >= dia && t < fin && (sede === 'todas' || c.sede === sede);
  });
}

export function citasDeSemana(fecha, sede = 'todas') {
  const dias = [];
  const lunes = inicioDeSemana(fecha);
  for (let i = 0; i < 7; i++) {
    const d = new Date(lunes); d.setDate(lunes.getDate() + i);
    dias.push({ fecha: d, citas: citasDelDia(d, sede), horario: horarioDe(d) });
  }
  return dias;
}

export function inicioDeSemana(fecha) {
  const d = new Date(fecha); d.setHours(0, 0, 0, 0);
  const dow = d.getDay();                     // 0 domingo … 6 sábado
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));   // la semana empieza el lunes
  return d;
}

/* ============================================================
   Ocupación
   ------------------------------------------------------------
   Minutos ocupados sobre los minutos que el centro abre. Es la
   cifra que dice si el agente está llenando la agenda.
   ============================================================ */
export function ocupacionDia(fecha, sede = 'todas') {
  const horario = horarioDe(fecha);
  if (!horario) return null;
  const citas = citasDelDia(fecha, sede).filter(c => c.estado !== 'no_asistio');
  const salas = sede === 'todas' ? 2 : 1;      // una sala por sede
  const disponibles = (horario.hasta - horario.desde) * 60 * salas;
  const ocupados = citas.reduce((n, c) => n + (c.duracion || 30), 0);
  return { ocupados, disponibles, porcentaje: Math.round((ocupados / disponibles) * 100), citas: citas.length };
}

/* ============================================================
   Formato
   ============================================================ */
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function horaCorta(iso) {
  const d = new Date(iso);
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() < 12 ? 'am' : 'pm'}`;
}
export function diaLargo(fecha) {
  return `${DIAS[fecha.getDay()]} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`;
}
export function diaCorto(fecha) { return DIAS_CORTO[fecha.getDay()]; }
export function esHoy(fecha) { return new Date().toDateString() === fecha.toDateString(); }
export function mismaFecha(a, b) { return a.toDateString() === b.toDateString(); }

export { esc, SEDES };

/* ============================================================
   Vistas
   ============================================================ */
const ALTO_FRANJA = 30;      // píxeles por media hora

/**
 * Reparte el ancho entre las citas que se pisan en el tiempo.
 * Sin esto, dos estudios a la misma hora se tapan el uno al otro y la
 * columna del día deja de ser legible.
 */
function repartirSolapes(citas) {
  const ordenadas = [...citas].sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  const fin = c => new Date(c.inicio).getTime() + (c.duracion || 30) * 60000;
  const colocadas = [];
  let grupo = [];
  let finGrupo = 0;

  const cerrarGrupo = () => {
    // Dentro de un grupo, cada cita va a la primera columna libre.
    const columnas = [];
    for (const c of grupo) {
      let col = columnas.findIndex(ultima => fin(ultima) <= new Date(c.inicio).getTime());
      if (col === -1) { columnas.push(c); col = columnas.length - 1; }
      else columnas[col] = c;
      c._col = col;
    }
    const total = columnas.length;
    for (const c of grupo) { c._cols = total; colocadas.push(c); }
    grupo = []; finGrupo = 0;
  };

  for (const c of ordenadas) {
    if (grupo.length && new Date(c.inicio).getTime() >= finGrupo) cerrarGrupo();
    grupo.push(c);
    finGrupo = Math.max(finGrupo, fin(c));
  }
  if (grupo.length) cerrarGrupo();
  return colocadas;
}

function bloqueCita(c, horario) {
  const t = new Date(c.inicio);
  const desdeMin = (t.getHours() - horario.desde) * 60 + t.getMinutes();
  const top = (desdeMin / 30) * ALTO_FRANJA;
  const alto = Math.max(ALTO_FRANJA - 2, (c.duracion / 30) * ALTO_FRANJA - 2);
  const est = ESTADOS_CITA[c.estado] || ESTADOS_CITA.confirmada;
  const cols = c._cols || 1;
  const col = c._col || 0;
  const ancho = 100 / cols;
  // Un estudio de 25 minutos ocupa 25 px: ahí no caben tres líneas, y
  // recortarlas a la mitad se ve peor que enseñar menos.
  const clase = alto < 34 ? ' baja' : alto < 52 ? ' media' : '';
  return `<button class="cita-bloque tono-${est.tono}${cols > 1 ? ' estrecha' : ''}${clase}" type="button" data-cita="${esc(c.id)}"
      style="top:${top}px;height:${alto}px;left:calc(${col * ancho}% + 3px);width:calc(${ancho}% - 6px)"
      title="${esc(c.paciente)} · ${esc(c.estudio)} · ${horaCorta(c.inicio)} · ${cita_duracion(c)} · ${esc(est.nombre)}">
      <span class="cb-hora">${horaCorta(c.inicio)}</span>
      <span class="cb-paciente">${esc(c.paciente)}</span>
      <span class="cb-estudio">${esc(c.estudio)}</span>
    </button>`;
}

function cita_duracion(c) { return `${c.duracion} min`; }

function columnaHoras(horario) {
  let html = '<div class="col-horas">';
  for (let h = horario.desde; h < horario.hasta; h++) {
    html += `<div class="franja-hora" style="height:${ALTO_FRANJA * 2}px"><span>${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}</span></div>`;
  }
  return html + '</div>';
}

function rejillaFondo(horario) {
  let html = '';
  for (let h = horario.desde; h < horario.hasta; h++) {
    html += `<div class="linea-hora" style="height:${ALTO_FRANJA * 2}px"></div>`;
  }
  return `<div class="rejilla">${html}</div>`;
}

/** Marca dónde está el reloj ahora, si el día es hoy y está abierto. */
function lineaAhora(fecha, horario) {
  if (!esHoy(fecha)) return '';
  const ahora = new Date();
  const h = ahora.getHours() + ahora.getMinutes() / 60;
  if (h < horario.desde || h > horario.hasta) return '';
  const top = ((h - horario.desde) * 60 / 30) * ALTO_FRANJA;
  return `<div class="linea-ahora" style="top:${top}px" aria-hidden="true"><span></span></div>`;
}

/* ---------- Vista día: una columna por sede ---------- */
export function renderDia(contenedor, fecha, sede, alClic) {
  const horario = horarioDe(fecha);
  if (!horario) {
    contenedor.innerHTML = `<div class="vacio">El centro no abre el ${diaLargo(fecha)}.<br>${esc(HORARIO.texto)}</div>`;
    return;
  }
  const sedes = sede === 'todas' ? ['75E', '76E'] : [sede];
  contenedor.innerHTML = `
    <div class="calendario dia" style="--cols:${sedes.length}">
      ${columnaHoras(horario)}
      ${sedes.map(s => {
        const citas = citasDelDia(fecha, s);
        return `<div class="col-dia">
          <div class="col-cabecera"><strong>${esc(SEDES[s].nombre.replace('Sede ', ''))}</strong><span>${citas.length} citas</span></div>
          <div class="col-cuerpo" style="height:${(horario.hasta - horario.desde) * ALTO_FRANJA * 2}px">
            ${rejillaFondo(horario)}
            ${lineaAhora(fecha, horario)}
            ${repartirSolapes(citas).map(c => bloqueCita(c, horario)).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  enlazar(contenedor, alClic);
}

/* ---------- Vista semana ---------- */
export function renderSemana(contenedor, fecha, sede, alClic) {
  const dias = citasDeSemana(fecha, sede).filter(d => d.horario);
  if (!dias.length) { contenedor.innerHTML = '<div class="vacio">Sin días de atención esta semana.</div>'; return; }
  // Se usa el horario más amplio para que todas las columnas cuadren.
  const desde = Math.min(...dias.map(d => d.horario.desde));
  const hasta = Math.max(...dias.map(d => d.horario.hasta));
  const horario = { desde, hasta };

  contenedor.innerHTML = `
    <div class="calendario semana" style="--cols:${dias.length}">
      ${columnaHoras(horario)}
      ${dias.map(d => `<div class="col-dia${esHoy(d.fecha) ? ' hoy' : ''}">
        <div class="col-cabecera">
          <strong>${diaCorto(d.fecha)} ${d.fecha.getDate()}</strong>
          <span>${d.citas.length} citas</span>
        </div>
        <div class="col-cuerpo" style="height:${(hasta - desde) * ALTO_FRANJA * 2}px">
          ${rejillaFondo(horario)}
          ${d.horario.hasta < hasta ? `<div class="cerrado" style="top:${(d.horario.hasta - desde) * ALTO_FRANJA * 2}px;height:${(hasta - d.horario.hasta) * ALTO_FRANJA * 2}px" title="Cerrado"></div>` : ''}
          ${lineaAhora(d.fecha, horario)}
          ${repartirSolapes(d.citas).map(c => bloqueCita(c, horario)).join('')}
        </div>
      </div>`).join('')}
    </div>`;
  enlazar(contenedor, alClic);
}

/* ---------- Vista lista ---------- */
export function renderLista(contenedor, fecha, sede, alClic) {
  const desde = new Date(fecha); desde.setHours(0, 0, 0, 0);
  const citas = listarCitas().filter(c => {
    const t = new Date(c.inicio);
    return t >= desde && (sede === 'todas' || c.sede === sede);
  }).slice(0, 60);

  if (!citas.length) { contenedor.innerHTML = '<div class="vacio">No hay citas a partir de esta fecha.</div>'; return; }

  let diaPrevio = null;
  const filas = citas.map(c => {
    const t = new Date(c.inicio);
    const cabecera = t.toDateString() !== diaPrevio;
    diaPrevio = t.toDateString();
    const est = ESTADOS_CITA[c.estado] || ESTADOS_CITA.confirmada;
    return `${cabecera ? `<div class="lista-dia">${esHoy(t) ? 'Hoy · ' : ''}${diaLargo(t)}</div>` : ''}
      <button class="lista-cita" type="button" data-cita="${esc(c.id)}">
        <span class="lc-hora">${horaCorta(c.inicio)}</span>
        <span class="lc-datos">
          <span class="lc-paciente">${esc(c.paciente)}${c.origen === 'agente' ? '<span class="lc-bot" title="Agendada por el agente virtual">bot</span>' : ''}</span>
          <span class="lc-estudio">${esc(c.estudio)} · ${c.duracion} min</span>
        </span>
        <span class="lc-sede">${esc(c.sede)}</span>
        <span class="lc-aseg">${esc(c.aseguradora)}</span>
        <span class="pill ${est.tono}">${esc(est.nombre)}</span>
      </button>`;
  }).join('');
  contenedor.innerHTML = `<div class="lista-citas">${filas}</div>`;
  enlazar(contenedor, alClic);
}

function enlazar(contenedor, alClic) {
  if (!alClic) return;
  for (const b of contenedor.querySelectorAll('[data-cita]')) {
    b.addEventListener('click', () => {
      const cita = listarCitas().find(c => c.id === b.dataset.cita);
      if (cita) alClic(cita);
    });
  }
}

/* ---------- Ficha de una cita ---------- */
export function renderFicha(contenedor, cita, alAbrirConversacion) {
  if (!cita) {
    contenedor.innerHTML = '<div class="vacio">Selecciona una cita para ver su detalle.</div>';
    return;
  }
  const est = ESTADOS_CITA[cita.estado] || ESTADOS_CITA.confirmada;
  const t = new Date(cita.inicio);
  const estudio = ESTUDIOS.find(e => e.id === cita.estudioId);
  const fila = (k, v) => `<div class="attr"><span class="k">${k}</span><span class="v">${esc(v ?? '—')}</span></div>`;

  contenedor.innerHTML = `
    <div class="ficha-cabecera">
      <div>
        <strong>${esc(cita.paciente)}</strong>
        <span>${esc(cita.telefono || 'sin teléfono')}</span>
      </div>
      <span class="pill ${est.tono}">${esc(est.nombre)}</span>
    </div>

    <div class="ficha-cuando">
      ${icono('calendario', { size: 15 })}
      <div>
        <strong>${diaLargo(t)}</strong>
        <span>${horaCorta(cita.inicio)} · ${cita.duracion} minutos</span>
      </div>
    </div>

    <div class="ctx-block">
      <h3>Estudio</h3>
      ${fila('estudio', cita.estudio)}
      ${fila('modalidad', cita.modalidad)}
      ${fila('sede', SEDES[cita.sede]?.nombre || cita.sede)}
      ${fila('cita_id', cita.id)}
    </div>

    <div class="ctx-block">
      <h3>Cobertura</h3>
      ${fila('aseguradora', cita.aseguradora)}
      ${cita.estado === 'sin_autorizar'
        ? '<p class="ficha-aviso">Falta la autorización previa de la aseguradora. Conviene avisar antes de la cita.</p>' : ''}
      ${cita.estado === 'sin_orden'
        ? '<p class="ficha-aviso">El paciente no ha entregado la orden médica.</p>' : ''}
    </div>

    ${estudio ? `<div class="ctx-block">
      <h3>Preparación</h3>
      <p class="ficha-prep">${estudio.ayuno ? 'Requiere <strong>ayuno de 4 a 6 horas</strong>. ' : 'No requiere ayuno. '}${estudio.contrasteFrecuente ? 'Puede necesitar medio de contraste.' : ''}</p>
    </div>` : ''}

    <div class="ctx-block">
      <h3>Origen</h3>
      <p class="ficha-origen">${cita.origen === 'agente'
        ? 'Agendada por el <strong>agente virtual</strong> en una conversación de WhatsApp.'
        : 'Cita de demostración, no procede de una conversación.'}</p>
      ${cita.idConversacion ? '<button class="btn block" id="ficha-ir">Abrir la conversación</button>' : ''}
    </div>`;

  const ir = contenedor.querySelector('#ficha-ir');
  if (ir && alAbrirConversacion) ir.addEventListener('click', () => alAbrirConversacion(cita.idConversacion));
}
