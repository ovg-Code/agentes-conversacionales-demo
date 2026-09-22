/* ============================================================
   Secciones del CRM: Pacientes, Informes y Ajustes
   ------------------------------------------------------------
   Todo se calcula sobre las conversaciones reales del bus.
   Nada de datos de ejemplo: si no hay conversaciones, lo dice.
   ============================================================ */

import { listarConversaciones, estadoEfectivo } from './bus.js';
import { AGENTES, EQUIPOS, LABELS, RESPUESTAS_RAPIDAS, agentePorId, tonoLabel } from './crm-data.js';

/* Paleta de estados, validada con el script de la skill de visualización
   en ambos modos (banda de luminosidad, croma, separación CVD y contraste).
   El modo oscuro tiene sus propios pasos: no es un volteo automático. */
export const COLOR_ESTADO = {
  claro:  { pending: '#7A4FE0', open: '#C9821B', resolved: '#0B6E47', snoozed: '#5E78C4' },
  oscuro: { pending: '#9C7EEC', open: '#C9821B', resolved: '#23A472', snoozed: '#5E78C4' }
};

const NOMBRE_ESTADO = { pending: 'Agente virtual', open: 'Con una persona', resolved: 'Resueltas', snoozed: 'Pospuestas' };

function paleta() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return COLOR_ESTADO.oscuro;
  if (attr === 'light') return COLOR_ESTADO.claro;
  // Sin elección explícita manda la preferencia del sistema.
  const oscuro = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return oscuro ? COLOR_ESTADO.oscuro : COLOR_ESTADO.claro;
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ============================================================
   Pacientes
   ============================================================ */
export function agruparPacientes() {
  const mapa = new Map();
  for (const c of listarConversaciones()) {
    const ced = c.crm?.contacto?.paciente_cedula;
    const tel = c.contacto?.telefono;
    const clave = ced || tel || c.id;
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        clave,
        nombre: c.crm?.contacto?.paciente_nombre || c.contacto?.nombre || 'Paciente sin identificar',
        cedula: ced || null,
        telefono: tel || null,
        aseguradora: c.crm?.contacto?.aseguradora || null,
        conversaciones: [],
        citas: [],
        ultima: 0
      });
    }
    const p = mapa.get(clave);
    p.conversaciones.push(c);
    p.ultima = Math.max(p.ultima, c.actualizado || 0);
    if (!p.nombre || p.nombre === 'Paciente sin identificar') {
      p.nombre = c.crm?.contacto?.paciente_nombre || p.nombre;
    }
    p.cedula = p.cedula || ced;
    p.aseguradora = p.aseguradora || c.crm?.contacto?.aseguradora;
    const cita = c.crm?.conversacion;
    if (cita?.cita_id) p.citas.push({ id: cita.cita_id, estudio: cita.estudio_solicitado, fecha: cita.cita_fecha, sede: cita.sede_preferida });
  }
  return [...mapa.values()].sort((a, b) => b.ultima - a.ultima);
}

export function renderPacientes(contenedor, filtro, alAbrir) {
  const q = (filtro || '').trim().toLowerCase();
  const pacientes = agruparPacientes().filter(p =>
    !q || [p.nombre, p.cedula, p.telefono, p.aseguradora].filter(Boolean).join(' ').toLowerCase().includes(q));

  if (!pacientes.length) {
    contenedor.innerHTML = `<div class="vacio">${q ? 'Ningún paciente coincide.' : 'Todavía no ha escrito nadie. Abre el <a href="index.html">simulador de chat</a>.'}</div>`;
    return;
  }

  contenedor.innerHTML = `<div class="tabla">
    <div class="tabla-head">
      <span>Paciente</span><span>Cédula</span><span>Aseguradora</span>
      <span>Conversaciones</span><span>Citas</span><span>Última</span>
    </div>
    ${pacientes.map(p => `
      <button class="tabla-fila" type="button" data-conv="${esc(p.conversaciones[0].id)}">
        <span class="celda-persona">
          <span class="conv-avatar" aria-hidden="true">${iniciales(p.nombre)}</span>
          <span class="persona-txt">
            <span class="persona-nombre">${esc(p.nombre)}</span>
            <span class="persona-sub">${p.telefono ? esc(p.telefono) : 'sin teléfono'}</span>
          </span>
        </span>
        <span class="mono">${p.cedula ? esc(p.cedula) : '<span class="empty">sin dato</span>'}</span>
        <span>${p.aseguradora ? esc(p.aseguradora) : '<span class="empty">privado</span>'}</span>
        <span class="mono">${p.conversaciones.length}</span>
        <span>${p.citas.length ? `<span class="pill ok">${p.citas.length}</span>` : '<span class="empty">—</span>'}</span>
        <span class="mono">${relativa(p.ultima)}</span>
      </button>`).join('')}
  </div>`;

  contenedor.querySelectorAll('.tabla-fila').forEach(f =>
    f.addEventListener('click', () => alAbrir(f.dataset.conv)));
}

/* ============================================================
   Informes
   ============================================================ */
export function calcularMetricas() {
  const todas = listarConversaciones();
  const porEstado = { pending: 0, open: 0, snoozed: 0, resolved: 0 };
  const porLabel = new Map();
  const porAgente = new Map();
  let conCita = 0, escaladas = 0, resueltasPorBot = 0;
  const tiemposPrimeraRespuesta = [];

  for (const c of todas) {
    porEstado[estadoEfectivo(c)]++;
    for (const l of c.crm?.labels || []) porLabel.set(l, (porLabel.get(l) || 0) + 1);
    if (c.asignadoA) porAgente.set(c.asignadoA, (porAgente.get(c.asignadoA) || 0) + 1);
    if (c.crm?.conversacion?.cita_id) conCita++;
    if ((c.crm?.labels || []).includes('escalado-humano')) escaladas++;
    if ((c.crm?.labels || []).includes('resuelto-por-bot')) resueltasPorBot++;
    if (c.primeraRespuesta && c.mensajes?.length) {
      tiemposPrimeraRespuesta.push(c.primeraRespuesta - c.mensajes[0].ts);
    }
  }

  const total = todas.length;
  const mensajes = todas.reduce((n, c) => n + (c.mensajes || []).filter(m => !m.privado).length, 0);
  const media = tiemposPrimeraRespuesta.length
    ? tiemposPrimeraRespuesta.reduce((a, b) => a + b, 0) / tiemposPrimeraRespuesta.length : null;

  return {
    total, porEstado, conCita, escaladas, resueltasPorBot, mensajes,
    contencion: total ? Math.round(((total - escaladas) / total) * 100) : null,
    mensajesPorConversacion: total ? (mensajes / total) : null,
    primeraRespuestaMedia: media,
    porLabel: [...porLabel.entries()].sort((a, b) => b[1] - a[1]),
    porAgente: [...porAgente.entries()].sort((a, b) => b[1] - a[1])
  };
}

export function renderInformes(contenedor) {
  const m = calcularMetricas();
  if (!m.total) {
    contenedor.innerHTML = '<div class="vacio">Sin conversaciones todavía. Abre el <a href="index.html">simulador de chat</a> para generar datos.</div>';
    return;
  }
  const col = paleta();

  /* Una cifra principal: la tasa de contención. Es el número que decide
     si el agente aporta, así que va sola y grande. */
  const hero = `
    <div class="hero-bloque">
      <div class="hero-num">${m.contencion}<span class="hero-pct">%</span></div>
      <div class="hero-lab">Conversaciones resueltas sin intervención humana</div>
    </div>`;

  const tile = (valor, etiqueta, nota) => `
    <div class="tile">
      <div class="tile-val">${valor}</div>
      <div class="tile-lab">${etiqueta}</div>
      ${nota ? `<div class="tile-nota">${nota}</div>` : ''}
    </div>`;

  const kpis = `<div class="tiles">
    ${tile(m.total, 'Conversaciones')}
    ${tile(m.conCita, 'Citas agendadas', m.total ? `${Math.round(m.conCita / m.total * 100)}% del total` : '')}
    ${tile(m.escaladas, 'Escaladas a una persona')}
    ${tile(m.mensajesPorConversacion != null ? m.mensajesPorConversacion.toFixed(1) : '—', 'Mensajes por conversación', 'objetivo ≤ 6')}
    ${tile(m.primeraRespuestaMedia != null ? duracion(m.primeraRespuestaMedia) : '—', 'Tiempo a 1ª respuesta humana')}
  </div>`;

  /* Parte-a-todo: barra apilada horizontal con separación de 2px en el
     color de la superficie y etiquetas directas, nunca solo color. */
  const totalEstados = Object.values(m.porEstado).reduce((a, b) => a + b, 0) || 1;
  const orden = ['pending', 'open', 'snoozed', 'resolved'];
  const apilada = `
    <section class="grafico">
      <h3>Estado de la bandeja</h3>
      <div class="apilada" role="img" aria-label="${orden.map(e => `${NOMBRE_ESTADO[e]}: ${m.porEstado[e]}`).join(', ')}">
        ${orden.filter(e => m.porEstado[e]).map(e =>
          `<span class="seg" style="flex:${m.porEstado[e]};background:${col[e]}" title="${NOMBRE_ESTADO[e]}: ${m.porEstado[e]}"></span>`).join('')}
      </div>
      <div class="leyenda">
        ${orden.map(e => `<span class="ley"><span class="punto" style="background:${col[e]}"></span>${NOMBRE_ESTADO[e]}<b>${m.porEstado[e]}</b></span>`).join('')}
      </div>
    </section>`;

  /* Magnitud por categoría: una sola serie, así que un solo tono.
     Barras de 14px, extremo redondeado 4px, cuadrado en la base. */
  const barras = (titulo, filas, etiquetar) => {
    if (!filas.length) return '';
    const max = Math.max(...filas.map(f => f[1])) || 1;
    return `
    <section class="grafico">
      <h3>${titulo}</h3>
      <div class="barras">
        ${filas.map(([k, v]) => `
          <div class="barra-fila">
            <span class="barra-lab">${etiquetar(k)}</span>
            <span class="barra-pista"><span class="barra" style="width:${Math.max(4, v / max * 100)}%"></span></span>
            <span class="barra-val">${v}</span>
          </div>`).join('')}
      </div>
    </section>`;
  };

  contenedor.innerHTML = hero + kpis + apilada +
    barras('Volumen por label', m.porLabel, k => `<span class="pill ${tonoLabel(k)}">${esc(k)}</span>`) +
    barras('Carga por agente', m.porAgente, k => esc(agentePorId(k)?.nombre || k)) +
    `<p class="nota-pie">Calculado sobre las ${m.total} conversaciones de esta sesión. En producción vendría del almacén de datos, con rangos de fecha.</p>`;
}

/* ============================================================
   Ajustes
   ============================================================ */
export function renderAjustes(contenedor) {
  contenedor.innerHTML = `
    <section class="bloque">
      <h3>Equipo</h3>
      <div class="tabla">
        <div class="tabla-head equipo"><span>Agente</span><span>Rol</span><span>Equipos</span></div>
        ${AGENTES.map(a => `
          <div class="tabla-fila equipo">
            <span class="celda-persona">
              <span class="conv-avatar" style="background:${a.color}" aria-hidden="true">${iniciales(a.nombre)}</span>
              <span>${esc(a.nombre)}</span>
            </span>
            <span>${esc(a.rol)}</span>
            <span>${a.equipos.map(e => `<span class="pill muted">${esc(e)}</span>`).join(' ')}</span>
          </div>`).join('')}
      </div>
    </section>

    <section class="bloque">
      <h3>Equipos y enrutamiento</h3>
      <div class="cards">
        ${EQUIPOS.map(e => `<div class="card">
          <strong>${esc(e.nombre)}</strong>
          <span>${esc(e.descripcion)}</span>
        </div>`).join('')}
      </div>
    </section>

    <section class="bloque">
      <h3>Labels</h3>
      <div class="labels">${LABELS.map(l => `<span class="pill ${l.tono}">${esc(l.id)}</span>`).join('')}</div>
    </section>

    <section class="bloque">
      <h3>Respuestas rápidas <span class="contador">${RESPUESTAS_RAPIDAS.length}</span></h3>
      <div class="cards">
        ${RESPUESTAS_RAPIDAS.map(r => `<div class="card">
          <strong>${esc(r.titulo)} <code>/${esc(r.atajo)}</code></strong>
          <span>${esc(r.texto.split('\n')[0])}</span>
        </div>`).join('')}
      </div>
    </section>

    <p class="nota-pie">En esta demostración los ajustes son de solo lectura: viven en <code>demo/src/crm-data.js</code>. En producción serían editables y se guardarían en la base de datos.</p>`;
}

/* ---------- Utilidades ---------- */
function iniciales(nombre) {
  const p = String(nombre || '?').trim().split(/\s+/);
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase();
}
function relativa(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
function duracion(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
